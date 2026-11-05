"""Thin async client for Gnani Vachana APIs (Prisma STT + Timbre TTS).

All endpoints verified against https://docs.gnani.ai/llms.txt on 2026-11-04:
  STT REST      POST https://api.vachana.ai/stt/v3            (multipart)
  STT realtime  wss://api.vachana.ai/stt/v3/stream            (PCM16 frames)
  TTS REST      POST https://api.vachana.ai/api/v1/tts/inference (JSON -> raw audio)
Auth header: X-API-Key-ID

Some accounts allow only ONE active request at a time (429 RATE_LIMITED),
so every REST call goes through a global semaphore + retry with backoff.
"""

import asyncio
import os
import time

import httpx

STT_REST_URL = "https://api.vachana.ai/stt/v3"
STT_WS_URL = "wss://api.vachana.ai/stt/v3/stream"
TTS_REST_URL = "https://api.vachana.ai/api/v1/tts/inference"

_semaphore = asyncio.Semaphore(1)  # serialize: 1 active Gnani request
_RETRY_DELAYS = [0.6, 1.2, 2.4]    # backoff for 429 / 5xx (per docs)


def api_key() -> str:
    key = os.environ.get("GNANI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GNANI_API_KEY is not set. Copy .env.example to .env and add your key.")
    return key


class GnaniError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code
        self.message = message


def _parse_error(resp: httpx.Response) -> GnaniError:
    code, message = "UNKNOWN", resp.text[:300]
    try:
        body = resp.json()
        detail = body.get("detail")
        if isinstance(detail, dict):            # 401/402/403/429 envelope
            code = detail.get("error_code", code)
            message = detail.get("message", message)
        elif isinstance(detail, list):          # 422 validation
            code = "VALIDATION_ERROR"
            message = str(detail)[:300]
        elif isinstance(body.get("error"), dict):  # STT error envelope
            code = body["error"].get("type", code)
            message = body["error"].get("message", message)
        elif "message" in body:                 # TTS flat envelope
            message = body["message"]
    except Exception:
        pass
    return GnaniError(resp.status_code, code, message)


async def _request_with_retry(client: httpx.AsyncClient, build_request) -> httpx.Response:
    """Run a request under the global semaphore, retrying 429/5xx with backoff."""
    last_err: GnaniError | None = None
    async with _semaphore:
        for attempt, delay in enumerate([0.0] + _RETRY_DELAYS):
            if delay:
                await asyncio.sleep(delay)
            resp = await build_request(client)
            if resp.status_code < 400:
                return resp
            last_err = _parse_error(resp)
            if resp.status_code not in (429, 500, 503, 504):
                raise last_err  # 4xx (other than 429): retrying won't help
    raise last_err


async def transcribe(
    audio_bytes: bytes,
    filename: str = "audio.wav",
    language_code: str = "indic-auto",
    fmt: str = "codemix",
    model: str = "prisma-v3.0",
) -> dict:
    """STT REST. Returns the Gnani response JSON plus our round-trip time."""
    t0 = time.perf_counter()
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await _request_with_retry(
            client,
            lambda c: c.post(
                STT_REST_URL,
                headers={"X-API-Key-ID": api_key()},
                files={"audio_file": (filename, audio_bytes)},
                data={"model": model, "language_code": language_code, "format": fmt},
            ),
        )
    data = resp.json()
    data["round_trip_time"] = round(time.perf_counter() - t0, 3)
    return data


async def synthesize(
    text: str,
    voice: str = "Poorvi",
    model: str = "timbre-v2.5",
    language: str = "auto",
    speed: float = 1.0,
) -> tuple[bytes, float]:
    """TTS REST. Returns (wav bytes, round_trip_seconds)."""
    t0 = time.perf_counter()
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await _request_with_retry(
            client,
            lambda c: c.post(
                TTS_REST_URL,
                headers={"X-API-Key-ID": api_key(), "Content-Type": "application/json"},
                json={
                    "text": text,
                    "voice": voice,
                    "model": model,
                    "language": language,
                    "speed": speed,
                    "audio_config": {
                        "sample_rate": 24000,
                        "num_channels": 1,
                        "sample_width": 2,
                        "encoding": "linear_pcm",
                        "container": "wav",
                    },
                },
            ),
        )
    return resp.content, round(time.perf_counter() - t0, 3)

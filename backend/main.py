"""Samvaad backend — FastAPI proxy for Gnani Prisma (STT) + Timbre (TTS).

The API key lives ONLY here (loaded from .env). The browser never sees it.
Realtime STT is proxied because browsers cannot set custom WebSocket headers.
"""

import asyncio
import json
import logging
import urllib.parse
from pathlib import Path

import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import gnani

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("samvaad")

app = FastAPI(title="Samvaad")

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

ALLOWED_STT_LANGS = {
    "indic-auto", "hi-IN", "en-IN", "bn-IN", "gu-IN", "kn-IN",
    "ml-IN", "mr-IN", "pa-IN", "ta-IN", "te-IN", "hi-IN,en-IN",
}
ALLOWED_VOICES = {  # voice -> (model, language)
    "Poorvi": ("timbre-v2.5", "hi-en"),     # Hinglish, conversational (default)
    "Deepak": ("timbre-v2.5", "hi-IN"),     # Hindi, male professional
    "Kaveri": ("timbre-v2.5", "en-IN"),     # Indian English, female
    "Shivani": ("timbre-v3.0", "auto"),     # v3.0 warm, all languages
    "Avinash": ("timbre-v3.0", "auto"),     # v3.0 male professional
}


def _error_response(e: Exception) -> JSONResponse:
    if isinstance(e, gnani.GnaniError):
        return JSONResponse(status_code=e.status, content={
            "success": False, "code": e.code, "message": e.message,
        })
    log.exception("unexpected error")
    return JSONResponse(status_code=500, content={
        "success": False, "code": "INTERNAL", "message": str(e)[:200],
    })


# ---------- STT (REST, chunked fallback + test script) ----------

@app.post("/api/stt")
async def stt(
    audio_file: UploadFile = File(...),
    language_code: str = Form("indic-auto"),
    format: str = Form("codemix"),
):
    if language_code not in ALLOWED_STT_LANGS:
        language_code = "indic-auto"
    if format not in ("codemix", "verbatim", "transcribe", "transliterate"):
        format = "codemix"
    audio = await audio_file.read()
    if not audio:
        return JSONResponse(status_code=400, content={
            "success": False, "code": "EMPTY_AUDIO", "message": "No audio received.",
        })
    try:
        data = await gnani.transcribe(
            audio, filename=audio_file.filename or "audio.wav",
            language_code=language_code, fmt=format,
        )
        return data
    except Exception as e:  # noqa: BLE001
        return _error_response(e)


# ---------- TTS ----------

class TTSRequest(BaseModel):
    text: str
    voice: str = "Poorvi"
    speed: float = 1.0


@app.post("/api/tts")
async def tts(req: TTSRequest):
    text = req.text.strip()[:500]
    if not text:
        return JSONResponse(status_code=400, content={
            "success": False, "code": "EMPTY_TEXT", "message": "Nothing to speak.",
        })
    voice = req.voice if req.voice in ALLOWED_VOICES else "Poorvi"
    model, language = ALLOWED_VOICES[voice]
    speed = min(max(req.speed, 0.85), 1.15)
    try:
        audio, latency = await gnani.synthesize(text, voice=voice, model=model,
                                                language=language, speed=speed)
        return Response(content=audio, media_type="audio/wav",
                        headers={"X-TTS-Latency": str(latency)})
    except Exception as e:  # noqa: BLE001
        return _error_response(e)


# ---------- STT realtime proxy (browser WS <-> Gnani WS) ----------

FRAME_BYTES = 1024  # per docs: each binary frame is exactly 1024 bytes (512 samples)


@app.websocket("/ws/stt")
async def stt_realtime(ws: WebSocket):
    await ws.accept()
    qs = urllib.parse.parse_qs(ws.scope.get("query_string", b"").decode())
    language = qs.get("language_code", ["indic-auto"])[0]
    if language not in ALLOWED_STT_LANGS:
        language = "indic-auto"

    headers = {
        "x-api-key-id": gnani.api_key(),
        "language_code": language,
        "model": "prisma-v3.0",
        "format": "codemix",
        "x-sample-rate": "16000",
    }
    buffer = bytearray()
    try:
        async with websockets.connect(
            gnani.STT_WS_URL, additional_headers=headers, max_size=2**22,
        ) as upstream:

            async def pump_up():
                nonlocal buffer
                while True:
                    msg = await ws.receive()
                    if msg.get("type") == "websocket.disconnect":
                        break
                    if msg.get("bytes"):
                        buffer.extend(msg["bytes"])
                        while len(buffer) >= FRAME_BYTES:
                            await upstream.send(bytes(buffer[:FRAME_BYTES]))
                            del buffer[:FRAME_BYTES]
                    elif msg.get("text"):
                        # control frames from the browser (e.g. {"type":"commit"})
                        await upstream.send(msg["text"])

            async def pump_down():
                async for raw in upstream:
                    if isinstance(raw, (bytes, bytearray)):
                        continue
                    await ws.send_text(raw)

            up = asyncio.create_task(pump_up())
            down = asyncio.create_task(pump_down())
            done, pending = await asyncio.wait({up, down}, return_when=asyncio.FIRST_COMPLETED)
            for t in pending:
                t.cancel()
            for t in done:
                exc = t.exception()
                if exc and not isinstance(exc, (WebSocketDisconnect, websockets.ConnectionClosed)):
                    raise exc
    except WebSocketDisconnect:
        pass
    except websockets.InvalidStatus as e:
        code = e.response.status_code
        await _safe_send(ws, {"type": "error",
                              "message": f"Gnani handshake failed (HTTP {code}). "
                                         f"{'Check API key.' if code == 401 else 'Try REST mode.'}"})
    except Exception as e:  # noqa: BLE001
        log.exception("realtime proxy error")
        await _safe_send(ws, {"type": "error", "message": str(e)[:200]})
    finally:
        try:
            await ws.close()
        except Exception:  # noqa: BLE001
            pass


async def _safe_send(ws: WebSocket, obj: dict):
    try:
        await ws.send_text(json.dumps(obj))
    except Exception:  # noqa: BLE001
        pass


@app.get("/api/health")
async def health():
    try:
        gnani.api_key()
        return {"ok": True}
    except RuntimeError as e:
        return JSONResponse(status_code=500, content={"ok": False, "message": str(e)})


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

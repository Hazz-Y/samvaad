"""Stream a wav through the backend's realtime STT proxy (ws://.../ws/stt).

Usage: python tests/test_realtime.py [file.wav] [ws_base]
Defaults: tests/out/selftest_poorvi.wav, ws://127.0.0.1:8017
Resamples to 16 kHz mono PCM16 and paces frames in real time, like the browser.
"""

import asyncio
import audioop
import json
import sys
import wave
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parent.parent
WAV = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "tests/out/selftest_poorvi.wav"
WS_BASE = sys.argv[2] if len(sys.argv) > 2 else "ws://127.0.0.1:8017"


async def main():
    with wave.open(str(WAV), "rb") as w:
        rate, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        pcm = w.readframes(w.getnframes())
    if ch == 2:
        pcm = audioop.tomono(pcm, width, 0.5, 0.5)
    if width != 2:
        pcm = audioop.lin2lin(pcm, width, 2)
    if rate != 16000:
        pcm, _ = audioop.ratecv(pcm, 2, 1, rate, 16000, None)
    pcm += b"\x00" * 16000 * 2  # 1 s trailing silence so VAD can finalize

    print(f"streaming {WAV.name}: {len(pcm)/32000:.1f}s of 16k PCM")
    async with websockets.connect(f"{WS_BASE}/ws/stt?language_code=indic-auto") as ws:

        async def send():
            for i in range(0, len(pcm), 1024):
                await ws.send(pcm[i:i + 1024])
                await asyncio.sleep(0.032)  # real-time pacing
            await ws.send(json.dumps({"type": "commit"}))

        sender = asyncio.create_task(send())
        try:
            got = await asyncio.wait_for(recv_until_done(ws, sender), timeout=90)
        finally:
            sender.cancel()
        print("PASS" if got else "FAIL: no transcript received")


async def recv_until_done(ws, sender):
    got = False
    while True:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=20)
        except (asyncio.TimeoutError, websockets.ConnectionClosed):
            break
        m = json.loads(raw)
        t = m.get("type")
        if t == "transcript":
            got = True
            print(f"  transcript: {m['text']}")
            print(f"  language={m.get('detected_language_code')} latency={m.get('latency')}ms")
            if sender.done():
                break
        elif t == "error":
            print("  ERROR:", m.get("message"))
        else:
            print(f"  [{t}]")
    return got


if __name__ == "__main__":
    asyncio.run(main())

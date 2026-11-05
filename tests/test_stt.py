"""Send sample wav files to Gnani Prisma and print transcript + latency.

Usage:
    python tests/test_stt.py                 # all .wav/.mp3 in tests/samples/
    python tests/test_stt.py path/to/a.wav   # specific file(s)
    python tests/test_stt.py --selftest      # no samples needed: generates a
                                             # Hinglish wav with Timbre, then
                                             # round-trips it through Prisma

Audio must be <= 30 s (REST limit). Each run costs credits — keep samples short.
"""

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

import gnani  # noqa: E402

SAMPLES_DIR = ROOT / "tests" / "samples"
SELFTEST_TEXT = "Namaste! Main theek hoon, aap kaise hain? Office mein meeting hai kya aaj?"


async def transcribe_file(path: Path):
    audio = path.read_bytes()
    print(f"\n--- {path.name} ({len(audio)/1024:.0f} KB) ---")
    try:
        r = await gnani.transcribe(audio, filename=path.name)
    except gnani.GnaniError as e:
        print(f"  ERROR {e.status} {e.code}: {e.message}")
        return
    print(f"  transcript : {r.get('transcript') or '(empty — no speech detected)'}")
    print(f"  language   : {r.get('detected_language_code', '-')}")
    print(f"  processing_time    : {r.get('processing_time', '-')} s")
    print(f"  end_to_end_latency : {r.get('end_to_end_latency', '-')} s")
    print(f"  round trip (local) : {r.get('round_trip_time', '-')} s")


async def selftest():
    print(f"Timbre TTS: \"{SELFTEST_TEXT}\" (voice Poorvi, Hinglish)")
    audio, tts_latency = await gnani.synthesize(SELFTEST_TEXT)
    out = ROOT / "tests" / "out"
    out.mkdir(exist_ok=True)
    wav = out / "selftest_poorvi.wav"
    wav.write_bytes(audio)
    print(f"  got {len(audio)/1024:.0f} KB in {tts_latency} s -> {wav}")
    await transcribe_file(wav)


async def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        await selftest()
        return
    files = [Path(a) for a in args] if args else sorted(
        list(SAMPLES_DIR.glob("*.wav")) + list(SAMPLES_DIR.glob("*.mp3")))
    if not files:
        print(f"No samples found. Put .wav/.mp3 files in {SAMPLES_DIR} "
              f"or run with --selftest.")
        return
    for f in files:  # sequential on purpose: account allows 1 active request
        await transcribe_file(f)


if __name__ == "__main__":
    asyncio.run(main())

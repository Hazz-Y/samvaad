# Samvaad — project explanation (draft for submission)

## The problem

India has an estimated 60+ million people with hearing loss, and everyday
conversations — at a shop counter, a clinic, a government office — routinely
break down because the two sides have no shared channel. Interpreters are
scarce and expensive; writing notes back and forth is slow and assumes shared
literacy in one script. Crucially, most existing captioning tools fail exactly
where India lives linguistically: in **code-mixed speech** ("bill ka total
kitna hua?") and **noisy public spaces**.

## What Samvaad does

Samvaad (संवाद — dialogue) is a single web page that turns one laptop into a
two-way bridge. Both directions land in one shared conversation thread —
what was heard on the left, what was spoken back on the right — which can be
exported as a written record of the conversation.

1. **Listen (speech → captions).** The hearing person speaks in Hindi,
   Hinglish or any of 10 Indian languages. Audio streams to **Gnani Prisma
   v3.0**, whose `indic-auto` detection and `codemix` output format render
   Hinglish the way people actually read it — Devanagari for Hindi, Latin
   script for English words. Captions are very large, resizable, and each one
   carries the detected language and the API's measured latency (~0.3 s
   processing time in our tests).
2. **Speak (reply → voice).** The deaf user answers with one tap on a
   quick-phrase button, free-typed text, or a sign-built sentence. **Gnani
   Timbre** (voice *Poorvi*, its conversational Hinglish voice) speaks the
   reply aloud. Because Timbre is in beta, the reply text is always displayed
   on screen *before* the API is called — the conversation survives even if
   audio fails entirely. Synthesized phrases are cached, so repeats cost no
   credits.
3. **Sign studio (beta).** MediaPipe hand tracking runs fully on-device (no
   video ever uploaded) and extracts 21 hand keypoints per frame; a custom
   geometric classifier we wrote on top of it recognises **16 static signs**
   with temporal smoothing, a live confidence meter and a skeleton overlay.
   Held signs compose a sentence for Timbre. The UI labels this honestly as
   *limited vocabulary* — it demonstrates the sign→speech pipeline, it does
   not claim to translate Indian Sign Language.

## Gnani models and APIs used

| Capability | Endpoint | Options used |
|---|---|---|
| Realtime STT | `wss://api.vachana.ai/stt/v3/stream` | `model=prisma-v3.0`, `language_code=indic-auto`, `format=codemix`, 16 kHz PCM frames, server-VAD segments, per-segment latency |
| STT fallback | `POST https://api.vachana.ai/stt/v3` | same options; client-side silence detection cuts chunks at pauses; automatic mid-session fallback if the socket drops |
| TTS | `POST https://api.vachana.ai/api/v1/tts/inference` | `timbre-v2.5` (Poorvi/Deepak/Kaveri) and `timbre-v3.0` (Shivani/Avinash), WAV out |

The FastAPI backend holds the API key (never exposed to the browser), proxies
the realtime WebSocket (browsers cannot send the `x-api-key-id` upgrade
header), serialises all calls through a single queue (the account allows one
active request), and retries 429/5xx with exponential backoff per Gnani's
error reference. A client-side speech gate ensures silence is never billed.

## Who benefits

- Deaf and hard-of-hearing people in everyday one-on-one interactions where no
  interpreter will ever be present: shops, pharmacies, clinics, bank counters,
  auto-rickshaw negotiations.
- The hearing side benefits equally — the app gives them a voice they can
  hear and captions their counterpart can read, with zero learning curve.
- Because Prisma covers 10 Indian languages plus code-mixing, it works for the
  multilingual reality of Indian streets, not just English-first settings.

## My contribution

I designed and built the complete system: the product concept and the
single-thread, two-panel interaction model; the FastAPI proxy with key
security, request serialisation and backoff; the browser audio pipeline
(AudioWorklet capture, 16 kHz resampling, RMS speech gate with pre-buffer so
first words aren't clipped, WAV chunking and automatic realtime→REST
fallback); the sign engine (geometric classification over MediaPipe hand
landmarks, temporal smoothing, confidence metering, skeleton visualisation);
TTS caching; the accessibility-first UI (resizable captions, shape+text
status indicators that never rely on colour or sound, keyboard navigation,
WCAG-AA contrast); and the test harness that
verifies both STT paths and TTS against the live API with real audio.
Gnani's Prisma and Timbre provide the speech intelligence; everything around
them is my work.

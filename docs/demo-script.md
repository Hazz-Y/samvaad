# Samvaad — 60-second demo script (shot list)

Record at 1080p in Chrome, dark theme, window maximised. Server already
running; mic + camera permissions already granted (do a dry run first so no
permission popups appear on camera).

| # | Time | Shot | Action | What the viewer sees |
|---|------|------|--------|----------------------|
| 1 | 0–6 s | Hero + glance at **01 / The problem** story | Nothing — let the page breathe | "Two people. No interpreter in the room." + chip **Powered by Gnani Prisma + Timbre**; Ananya's pharmacy scene |
| 2 | 6–12 s | Scroll to **03 / Live conversation** | Click **Start listening** | Status pill flips to ● Listening, equalizer bars moving, session chip shows LIVE · REALTIME WSS |
| 3 | 12–24 s | Left panel close | Speak Hinglish, normal pace: *"Namaste! Aaj main thoda jaldi mein hoon, kya aap mujhe bill ka total bata sakte hain?"* | Big caption bubble appears on the left of the thread in codemix (Devanagari + "bill", "total" in Latin); language stat flips to HI; latency stat shows ~0.3 s |
| 4 | 24–32 s | Right panel | Tap quick phrase **"Thoda dheere boliye please."** | Reply appears as an amber bubble on the right of the SAME thread AND Poorvi's voice speaks it — the two-way thread is the money shot |
| 5 | 32–40 s | Right panel | Type *"Total kitna hua?"* → **Speak** | Typed Hinglish spoken aloud, text shown as fallback; TTS latency stat updates |
| 6 | 40–54 s | Scroll to **04 / Sign studio** | Camera already on; hold 👍 ~1 s, then ✌ ~1 s; click **Speak chain** | Teal hand skeleton tracks the hand, detected-sign readout + match % react live, matching vocab card lights up, sign chain fills: THUMBS UP → V SPREAD; Timbre speaks "Haan, theek hai. Sab badhiya hai!". "Limited vocabulary · 16 signs · beta" tag visible |
| 7 | 54–58 s | Stats row | Pause | Big numbers: STT latency, language, TTS latency, requests |
| 8 | 58–60 s | Footer | — | "Built with Gnani Prisma + Timbre" |

**Backup plan:** if realtime mode misbehaves on recording day, Samvaad
auto-falls back to chunked REST without stopping — or pre-select **Chunked
(REST)** in the mode dropdown.

**Noisy-room proof (optional 2nd take):** play café noise from a phone at
medium volume during shot 3 and say the same line — captions still correct.

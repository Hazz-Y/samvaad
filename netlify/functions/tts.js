// Netlify Function: Gnani Timbre TTS. Returns raw WAV (base64-encoded body).

const VOICES = {
  Poorvi: ["timbre-v2.5", "hi-en"],
  Deepak: ["timbre-v2.5", "hi-IN"],
  Kaveri: ["timbre-v2.5", "en-IN"],
  Shivani: ["timbre-v3.0", "auto"],
  Avinash: ["timbre-v3.0", "auto"],
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ success: false, message: "POST only" }) };
  }
  const key = process.env.GNANI_API_KEY;
  if (!key) {
    return { statusCode: 500, body: JSON.stringify({ success: false, message: "GNANI_API_KEY not configured" }) };
  }
  let raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "{}");
  raw = raw.replace(/^﻿/, ""); // strip BOM
  let req = {};
  try { req = JSON.parse(raw); } catch { /* fall through */ }
  const text = (req.text || "").trim().slice(0, 500);
  if (!text) {
    return { statusCode: 400, body: JSON.stringify({ success: false, message: "Nothing to speak." }) };
  }
  const voice = VOICES[req.voice] ? req.voice : "Poorvi";
  const [model, language] = VOICES[voice];

  const t0 = Date.now();
  let resp;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 600 * attempt));
    resp = await fetch("https://api.vachana.ai/api/v1/tts/inference", {
      method: "POST",
      headers: { "X-API-Key-ID": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text, voice, model, language, speed: 1.0,
        audio_config: { sample_rate: 24000, num_channels: 1, sample_width: 2, encoding: "linear_pcm", container: "wav" },
      }),
    });
    if (resp.status !== 429 && resp.status < 500) break;
  }
  if (!resp.ok) {
    const errText = await resp.text();
    return { statusCode: resp.status, headers: { "Content-Type": "application/json" }, body: errText };
  }
  const audio = Buffer.from(await resp.arrayBuffer());
  return {
    statusCode: 200,
    headers: { "Content-Type": "audio/wav", "X-TTS-Latency": ((Date.now() - t0) / 1000).toFixed(2) },
    body: audio.toString("base64"),
    isBase64Encoded: true,
  };
};

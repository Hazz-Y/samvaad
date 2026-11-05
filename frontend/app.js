/* Samvaad frontend. Talks only to the local backend — never to Gnani directly. */

const $ = (id) => document.getElementById(id);

/* ---------------- caption size + toast ---------------- */

const root = document.documentElement;

/* light / dark toggle */
function syncThemeIcon() {
  $("themeIcon").textContent = root.classList.contains("dark") ? "light_mode" : "dark_mode";
}
$("themeBtn").addEventListener("click", () => {
  root.classList.toggle("dark");
  try { localStorage.setItem("sv-theme", root.classList.contains("dark") ? "dark" : "light"); } catch { /* ignore */ }
  syncThemeIcon();
});
syncThemeIcon();

let captionRem = 1.5;
const setCaptionSize = (d) => {
  captionRem = Math.min(3.2, Math.max(1.0, captionRem + d));
  root.style.setProperty("--caption-size", captionRem + "rem");
};
$("sizeUp").addEventListener("click", () => setCaptionSize(0.25));
$("sizeDown").addEventListener("click", () => setCaptionSize(-0.25));

let toastTimer;
function toast(msg, kind = "info") {
  const el = $("toast");
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4200);
}

/* ---------------- stats + chips ---------------- */

let reqCount = 0;
const bumpReqs = () => { reqCount += 1; $("statReqs").textContent = String(reqCount); };
const fmtLang = (c) => (c ? c.replace("-IN", "").toUpperCase() : "–");

function setStatus(id, state, text) {
  const el = $(id);
  el.dataset.state = state;
  el.querySelector(".status-text").textContent = text;
}

function setSession(text, color) {
  $("sessionChip").textContent = text;
  $("sessionDot").style.background = color;
  $("sessionDot").classList.toggle("animate-pulse", color !== "var(--txt-dim)");
}

/* ---------------- two-way conversation thread ---------------- */

const conversation = []; // {role: "them"|"you", text, meta, at}

function addMessage(role, text, metaText) {
  if (!text) return;
  $("threadEmpty")?.remove();
  conversation.push({ role, text, meta: metaText || "", at: new Date() });
  const box = $("captions");
  const line = document.createElement("div");
  line.className = `msg msg-${role}`;
  const roleEl = document.createElement("span");
  roleEl.className = "role";
  roleEl.textContent = role === "them" ? "Heard · voice in" : "You · spoken aloud";
  const p = document.createElement("div");
  p.className = "caption-line";
  p.textContent = text;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = metaText || "";
  line.append(roleEl, p, meta);
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function addCaption(text, lang, latencySec) {
  const meta = [lang ? fmtLang(lang) : null, latencySec != null ? latencySec.toFixed(2) + " s" : null]
    .filter(Boolean).join(" · ");
  addMessage("them", text, meta);
  if (lang) $("statLang").textContent = fmtLang(lang);
  if (latencySec != null) $("statLatency").textContent = latencySec.toFixed(2);
}

$("exportBtn").addEventListener("click", () => {
  if (!conversation.length) { toast("Nothing to export yet — the thread is empty.", "info"); return; }
  const lines = conversation.map((m) =>
    `[${m.at.toLocaleTimeString()}] ${m.role === "them" ? "HEARD " : "SPOKEN"}  ${m.text}`);
  const blob = new Blob([`Samvaad conversation — ${new Date().toLocaleString()}\n\n` + lines.join("\n") + "\n"],
    { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "samvaad-conversation.txt";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("clearThreadBtn").addEventListener("click", () => {
  conversation.length = 0;
  const box = $("captions");
  box.innerHTML = '<div class="m-auto text-center text-on-surface-variant text-body-md" id="threadEmpty">Thread cleared. Press <strong class="text-on-surface">Start listening</strong> to begin again.</div>';
});

/* ---------------- mic engine (speech gate + two modes) ---------------- */

const GATE_RMS = 0.012;
const HANGOVER_MS = 1400;
const PREBUFFER_CHUNKS = 4;    // ~0.5 s kept so the first word isn't clipped
const REST_MAX_MS = 25000;     // REST chunks stay under the 30 s API limit

let audioCtx = null, workletNode = null, mediaStream = null;
let listening = false;
let activeMode = "realtime";
let ws = null;
let gateOpen = false, lastVoiceAt = 0;
let prebuffer = [];
let restChunks = [], restStartedAt = 0;

const VU_PROFILE = [5, 9, 12, 7, 11, 6, 8];
const vuBars = [...$("vuBars").children];
function setVu(rms) {
  for (let i = 0; i < vuBars.length; i++) {
    vuBars[i].style.transform = `scaleY(${Math.min(1, 0.12 + rms * VU_PROFILE[i] * 2.2)})`;
  }
}

$("micBtn").addEventListener("click", () => (listening ? stopListening() : startListening()));

async function startListening() {
  activeMode = $("modeSel").value;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    toast("Microphone access is needed for live captions — please allow it.", "error");
    return;
  }
  audioCtx = new AudioContext();
  await audioCtx.audioWorklet.addModule("worklet.js");
  workletNode = new AudioWorkletNode(audioCtx, "pcm-capture");
  audioCtx.createMediaStreamSource(mediaStream).connect(workletNode);
  workletNode.port.onmessage = (e) => onAudio(e.data);

  gateOpen = false; prebuffer = []; restChunks = [];
  listening = true;
  $("micBtn").innerHTML = '<span class="material-symbols-outlined text-lg">mic_off</span>Stop listening';
  $("langSel").disabled = $("modeSel").disabled = true;

  if (activeMode === "realtime") openRealtimeSocket();
  else {
    setStatus("sunoStatus", "listening", "Listening");
    setSession("LIVE · CHUNKED REST", "var(--teal)");
  }
}

function stopListening() {
  listening = false;
  if (gateOpen && activeMode === "rest") flushRestChunk();
  if (ws) { try { ws.send(JSON.stringify({ type: "commit" })); } catch { /* ignore */ } setTimeout(() => ws?.close(), 600); }
  workletNode?.port.close();
  mediaStream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close();
  audioCtx = workletNode = mediaStream = null;
  setVu(0);
  $("micBtn").innerHTML = '<span class="material-symbols-outlined text-lg">mic</span>Start listening';
  $("langSel").disabled = $("modeSel").disabled = false;
  setStatus("sunoStatus", "idle", "Idle");
  setSession("SESSION IDLE", "var(--txt-dim)");
}

function onAudio({ pcm, rms }) {
  if (!listening) return;
  setVu(rms);
  const now = performance.now();
  if (rms > GATE_RMS) lastVoiceAt = now;
  if (!pcm) return;
  const speechActive = now - lastVoiceAt < HANGOVER_MS;

  if (!gateOpen && rms > GATE_RMS) {
    gateOpen = true;
    if (activeMode === "rest") { restChunks = [...prebuffer]; restStartedAt = now; setStatus("sunoStatus", "listening", "Listening — speech"); }
    else { for (const b of prebuffer) wsSend(b); }
    prebuffer = [];
  }

  if (gateOpen) {
    if (activeMode === "rest") {
      restChunks.push(pcm);
      if (!speechActive || now - restStartedAt > REST_MAX_MS) { gateOpen = false; flushRestChunk(); }
    } else {
      wsSend(pcm);
      if (!speechActive) {
        gateOpen = false;
        try { ws?.send(JSON.stringify({ type: "commit" })); } catch { /* ignore */ }
      }
    }
  } else {
    prebuffer.push(pcm);
    if (prebuffer.length > PREBUFFER_CHUNKS) prebuffer.shift();
  }
}

/* ---- realtime (WebSocket proxy), with automatic REST fallback ---- */

function openRealtimeSocket() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const lang = encodeURIComponent($("langSel").value);
  ws = new WebSocket(`${proto}://${location.host}/ws/stt?language_code=${lang}`);
  ws.binaryType = "arraybuffer";
  setStatus("sunoStatus", "transcribing", "Connecting…");
  setSession("CONNECTING…", "var(--orange)");
  ws.onopen = () => bumpReqs();
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === "connected") { setStatus("sunoStatus", "listening", "Listening"); setSession("LIVE · REALTIME WSS", "var(--teal)"); }
    else if (m.type === "speech_start") setStatus("sunoStatus", "listening", "Listening — speech");
    else if (m.type === "processing") setStatus("sunoStatus", "transcribing", "Transcribing…");
    else if (m.type === "transcript") {
      addCaption(m.text, m.detected_language_code, m.latency != null ? m.latency / 1000 : null);
      setStatus("sunoStatus", "listening", "Listening");
    } else if (m.type === "error") {
      toast("STT: " + m.message, "error");
    }
  };
  ws.onclose = () => {
    ws = null;
    if (listening && activeMode === "realtime") {
      // keep the conversation going: flip to chunked REST without stopping the mic
      activeMode = "rest";
      $("modeSel").value = "rest";
      gateOpen = false; restChunks = [];
      setStatus("sunoStatus", "listening", "Listening (chunked)");
      setSession("LIVE · CHUNKED REST", "var(--teal)");
      toast("Realtime stream dropped — switched to chunked mode, still listening.", "info");
    }
  };
  ws.onerror = () => {};
}

function wsSend(buf) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(buf); }

/* ---- REST fallback: cut at pauses, wrap as WAV, POST ---- */

async function flushRestChunk() {
  const chunks = restChunks; restChunks = [];
  const samples = chunks.reduce((n, b) => n + b.byteLength / 2, 0);
  if (samples < 16000 * 0.3) return;
  setStatus("sunoStatus", "transcribing", "Transcribing…");
  const wav = buildWav(chunks, 16000);
  const fd = new FormData();
  fd.append("audio_file", new Blob([wav], { type: "audio/wav" }), "chunk.wav");
  fd.append("language_code", $("langSel").value);
  fd.append("format", "codemix");
  bumpReqs();
  try {
    const r = await fetch("/api/stt", { method: "POST", body: fd });
    const data = await r.json();
    if (!r.ok || data.success === false) throw new Error(data.message || "STT failed");
    if (data.transcript) addCaption(data.transcript, data.detected_language_code, data.processing_time);
  } catch (err) {
    toast("STT: " + err.message, "error");
  }
  if (listening) setStatus("sunoStatus", "listening", "Listening");
}

function buildWav(int16Buffers, rate) {
  const dataLen = int16Buffers.reduce((n, b) => n + b.byteLength, 0);
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, dataLen, true);
  let o = 44;
  for (const b of int16Buffers) { new Uint8Array(buf, o, b.byteLength).set(new Uint8Array(b)); o += b.byteLength; }
  return buf;
}

/* ---------------- reply side: quick phrases + TTS (with cache) ---------------- */

const PHRASES = [
  ["Namaste! Main sun nahi sakta, par yeh app meri awaaz hai.", "intro"],
  ["Haan, theek hai.", "yes / okay"],
  ["Nahin, sorry.", "no"],
  ["Thoda dheere boliye please.", "speak slowly"],
  ["Ek baar phir se boliye?", "repeat please"],
  ["Dhanyavaad!", "thank you"],
  ["Mujhe madad chahiye.", "need help"],
  ["Kitna hua? Price batayiye.", "how much?"],
  ["Main samajh gaya.", "understood"],
  ["Do minute rukiye please.", "please wait"],
];

const phrasesBox = $("phrases");
for (const [hi, en] of PHRASES) {
  const b = document.createElement("button");
  b.className = "phrase";
  b.innerHTML = `${hi}<span class="en">${en}</span>`;
  b.addEventListener("click", () => speak(hi));
  phrasesBox.appendChild(b);
}

const sayInput = $("sayInput");
sayInput.addEventListener("input", () => { $("charCount").textContent = `${sayInput.value.length} / 300`; });
sayInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("sayBtn").click(); }
});
$("sayBtn").addEventListener("click", () => {
  const t = sayInput.value.trim();
  if (t) { speak(t); sayInput.value = ""; $("charCount").textContent = "0 / 300"; }
});
$("clearInputBtn").addEventListener("click", () => { sayInput.value = ""; $("charCount").textContent = "0 / 300"; });

const ttsCache = new Map(); // `${voice}|${text}` -> object URL (repeats cost 0 credits)
let speaking = false;

async function speak(text) {
  // Text fallback FIRST — communication must not depend on audio (Timbre is beta)
  $("spokenText").textContent = text;
  $("spokenMeta").textContent = "";
  if (speaking) { toast("One moment — already speaking.", "info"); return; }
  speaking = true;

  const voice = $("voiceSel").value;
  const key = `${voice}|${text}`;
  try {
    let src = ttsCache.get(key);
    const cached = Boolean(src);
    if (!cached) {
      setStatus("boloStatus", "transcribing", "Generating…");
      bumpReqs();
      const r = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.message || `TTS failed (${r.status})`);
      }
      const lat = parseFloat(r.headers.get("X-TTS-Latency"));
      if (!Number.isNaN(lat)) $("statTts").textContent = lat.toFixed(2);
      src = URL.createObjectURL(await r.blob());
      ttsCache.set(key, src);
      $("spokenMeta").textContent = `Voice: ${voice} · ${Number.isNaN(lat) ? "" : lat.toFixed(2) + " s"}`;
    } else {
      $("spokenMeta").textContent = `Voice: ${voice} · cached, 0 credits`;
    }
    addMessage("you", text, cached ? "cached" : voice);
    const audio = $("ttsAudio");
    audio.src = src;
    setStatus("boloStatus", "speaking", "Speaking");
    await audio.play();
    await new Promise((res) => { audio.onended = res; audio.onerror = res; });
    setStatus("boloStatus", "idle", "Idle");
  } catch (err) {
    addMessage("you", text, "voice failed — text only");
    $("spokenMeta").textContent = "Voice failed — message delivered as text above.";
    setStatus("boloStatus", "error", "Voice failed");
    toast("TTS: " + err.message + " (message still shown as text)", "error");
  } finally {
    speaking = false;
  }
}

/* ======================================================================
   SIGN ENGINE — MediaPipe HandLandmarker (21 keypoints, fully on-device)
   + geometric classifier: 16 static signs, temporal smoothing,
   confidence meter, skeleton overlay. No video ever leaves the browser.
   ====================================================================== */

const SIGNS = {
  hello:    { icon: "waving_hand",    name: "OPEN PALM",        phrase: "Namaste!" },
  wait:     { icon: "front_hand",     name: "FIST",             phrase: "Ruk jaiye, ek minute." },
  yes:      { icon: "thumb_up",       name: "THUMBS UP",        phrase: "Haan, theek hai." },
  no:       { icon: "thumb_down",     name: "THUMBS DOWN",      phrase: "Nahin." },
  question: { icon: "contact_support",name: "INDEX UP",         phrase: "Mujhe ek sawaal poochna hai." },
  good:     { icon: "mood",           name: "V SPREAD",         phrase: "Sab badhiya hai!" },
  repeat:   { icon: "replay",         name: "TWO TOGETHER",     phrase: "Ek baar phir se boliye, please." },
  thanks:   { icon: "favorite",       name: "I-LOVE-YOU",       phrase: "Bahut bahut shukriya!" },
  okay:     { icon: "check_circle",   name: "OK RING",          phrase: "Okay, main samajh gaya." },
  price:    { icon: "payments",       name: "L-SHAPE",          phrase: "Iska daam kitna hai?" },
  help:     { icon: "support",        name: "THUMB+INDEX+MID",  phrase: "Mujhe madad chahiye." },
  call:     { icon: "call",           name: "SHAKA",            phrase: "Mujhe phone karna hai." },
  urgent:   { icon: "emergency",      name: "ROCK",             phrase: "Emergency hai, jaldi madad chahiye!" },
  second:   { icon: "timer",          name: "PINKY ONLY",       phrase: "Bas ek second." },
  water:    { icon: "water_drop",     name: "THREE MID",        phrase: "Paani milega?" },
  slow:     { icon: "speed",          name: "FOUR",             phrase: "Thoda dheere boliye." },
};

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17],
];
const TIPS = new Set([4, 8, 12, 16, 20]);

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

/** Classify one frame of landmarks into a sign id, or null. */
function classify(lm) {
  const palm = dist(lm[0], lm[9]) || 1e-6;
  const ext = (tip, pip) => dist(lm[tip], lm[0]) > dist(lm[pip], lm[0]) * 1.12;
  const I = ext(8, 6), M = ext(12, 10), R = ext(16, 14), P = ext(20, 18);
  const T = dist(lm[4], lm[17]) > palm * 1.35;
  const pinch = dist(lm[4], lm[8]) < palm * 0.45;

  if (pinch && M && R && P) return "okay";
  if (T && I && P && !M && !R) return "thanks";
  if (T && P && !I && !M && !R) return "call";
  if (I && P && !T && !M && !R) return "urgent";
  if (T && !I && !M && !R && !P) return lm[4].y < lm[0].y - palm * 0.3 ? "yes" : "no";
  if (P && !T && !I && !M && !R) return "second";
  if (I && !T && !M && !R && !P) return "question";
  if (T && I && !M && !R && !P) return "price";
  if (T && I && M && !R && !P) return "help";
  if (I && M && !T && !R && !P) return dist(lm[8], lm[12]) > palm * 0.45 ? "good" : "repeat";
  if (I && M && R && !T && !P) return "water";
  if (I && M && R && P && !T) return "slow";
  if (T && I && M && R && P) return "hello";
  if (!T && !I && !M && !R && !P) return "wait";
  return null;
}

const SMOOTH_N = 12, HOLD_MS = 900, COOLDOWN_MS = 1500;
const history = [];
let stableSign = null, stableSince = 0, lastCommit = 0;

function smooth(sign) {
  history.push(sign);
  if (history.length > SMOOTH_N) history.shift();
  const counts = {};
  for (const s of history) if (s) counts[s] = (counts[s] || 0) + 1;
  let best = null, n = 0;
  for (const [s, c] of Object.entries(counts)) if (c > n) { best = s; n = c; }
  return { sign: best, confidence: history.length ? n / history.length : 0 };
}

/* ---- vocabulary grid ---- */
const vocabBox = $("signVocab");
let vi = 0;
for (const [id, s] of Object.entries(SIGNS)) {
  vi += 1;
  const card = document.createElement("div");
  card.className = "sign-card";
  card.id = "vocab-" + id;
  card.innerHTML =
    `<img src="assets/signs/${id}.png" alt="Hand making the ${s.name.toLowerCase()} sign" class="simg" hidden ` +
    `onload="this.hidden=false;this.nextElementSibling.firstElementChild.style.display='none'" onerror="this.remove()">` +
    `<div class="head"><span class="material-symbols-outlined">${s.icon}</span>` +
    `<span class="num">${String(vi).padStart(2, "0")}</span></div>` +
    `<span class="nm">${s.name}</span><span class="ph">“${s.phrase}”</span>`;
  vocabBox.appendChild(card);
}

/* ---- sentence chain ---- */
const signWords = []; // {id, phrase}

function renderChain() {
  const box = $("signChain");
  box.innerHTML = "";
  if (!signWords.length) {
    box.innerHTML = '<span class="font-mono text-label-code-sm" style="color:#8b93a1" id="chainEmpty">Hold a sign steady for ~1 second — it lands here.</span>';
    $("signSentence").textContent = "";
    return;
  }
  signWords.forEach((w, i) => {
    if (i > 0) {
      const a = document.createElement("span");
      a.className = "material-symbols-outlined chain-arrow";
      a.textContent = "arrow_forward";
      box.appendChild(a);
    }
    const chip = document.createElement("span");
    chip.className = "chain-chip";
    chip.textContent = SIGNS[w.id].name;
    box.appendChild(chip);
  });
  $("signSentence").textContent = "Sentence: “" + signWords.map((w) => w.phrase).join(" ") + "”";
}

/* ---- camera loop ---- */
let landmarker = null, camOn = false, camStream = null, rafId = null;

$("camBtn").addEventListener("click", () => (camOn ? stopCam() : startCam()));

async function startCam() {
  setStatus("signStatus", "transcribing", "Loading model…");
  $("camBtn").disabled = true;
  try {
    if (!landmarker) {
      const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14");
      const fileset = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
      landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        },
        runningMode: "VIDEO",
        numHands: 1,
      });
    }
    camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  } catch (err) {
    toast("Sign studio unavailable: " + (err.message || "camera/model failed"), "error");
    setStatus("signStatus", "error", "Failed");
    $("camBtn").disabled = false;
    return;
  }
  const video = $("camVideo");
  video.srcObject = camStream;
  await video.play();
  $("camEmpty").hidden = true;
  camOn = true;
  history.length = 0;
  $("camBtn").disabled = false;
  $("camBtn").textContent = "Disable camera";
  $("camLabel").textContent = "Camera feed active · on-device";
  $("camDot").classList.add("animate-ping");
  setStatus("signStatus", "listening", "Watching");
  loopSigns(video, $("camCanvas"));
}

function stopCam() {
  camOn = false;
  cancelAnimationFrame(rafId);
  camStream?.getTracks().forEach((t) => t.stop());
  $("camVideo").srcObject = null;
  const canvas = $("camCanvas");
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  $("camEmpty").hidden = false;
  $("camBtn").textContent = "Enable camera";
  $("camLabel").textContent = "Camera off";
  $("camDot").classList.remove("animate-ping");
  setStatus("signStatus", "idle", "Off");
  setReadout(null, 0, 0);
}

/* map normalized (mirrored) landmark coords through the object-cover crop */
function coverMap(canvas, video) {
  const cw = canvas.width, ch = canvas.height;
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale, dh = vh * scale;
  const ox = (cw - dw) / 2, oy = (ch - dh) / 2;
  return { X: (p) => ox + (1 - p.x) * dw, Y: (p) => oy + p.y * dh };
}

function drawSkeleton(canvas, video, lm) {
  const ctx = canvas.getContext("2d");
  const box = canvas.parentElement;
  if (canvas.width !== box.clientWidth || canvas.height !== box.clientHeight) {
    canvas.width = box.clientWidth; canvas.height = box.clientHeight;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lm) return;
  const css = getComputedStyle(root);
  const teal = css.getPropertyValue("--teal").trim() || "#4ddcc6";
  const amber = css.getPropertyValue("--amber-soft").trim() || "#fdd44e";
  const { X, Y } = coverMap(canvas, video);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = teal;
  ctx.globalAlpha = 0.9;
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.beginPath(); ctx.moveTo(X(lm[a]), Y(lm[a])); ctx.lineTo(X(lm[b]), Y(lm[b])); ctx.stroke();
  }
  for (let i = 0; i < lm.length; i++) {
    ctx.fillStyle = TIPS.has(i) ? amber : teal;
    ctx.beginPath(); ctx.arc(X(lm[i]), Y(lm[i]), TIPS.has(i) ? 5 : 3.5, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function setReadout(signId, confidence, heldMs) {
  for (const el of vocabBox.children) el.classList.remove("active");
  if (signId) {
    const s = SIGNS[signId];
    $("detectName").textContent = s.name;
    $("detectPhrase").textContent = "“" + s.phrase + "”";
    $("vocab-" + signId)?.classList.add("active");
  } else {
    $("detectName").textContent = "—";
    $("detectPhrase").textContent = camOn ? "Show a hand to the camera" : "Camera is off";
  }
  $("confBar").style.width = Math.round(confidence * 100) + "%";
  $("confPct").textContent = Math.round(confidence * 100) + "%";
  $("holdBar").style.width = Math.min(100, (heldMs / HOLD_MS) * 100) + "%";
}

function loopSigns(video, canvas) {
  if (!camOn) return;
  const now = performance.now();
  let lm = null;
  try {
    const res = landmarker.detectForVideo(video, now);
    lm = res.landmarks?.[0] || null;
  } catch { /* skip frame */ }
  drawSkeleton(canvas, video, lm);

  const frameSign = lm ? classify(lm) : null;
  const { sign, confidence } = smooth(frameSign);
  const confident = sign && confidence >= 0.7;

  if (confident && sign === stableSign) {
    const held = now - stableSince;
    setReadout(sign, confidence, held);
    if (held >= HOLD_MS && now - lastCommit > COOLDOWN_MS) {
      lastCommit = now;
      stableSince = now; // require a fresh hold for a repeat
      signWords.push({ id: sign, phrase: SIGNS[sign].phrase });
      renderChain();
    }
  } else {
    stableSign = confident ? sign : null;
    stableSince = now;
    setReadout(confident ? sign : null, confidence || 0, 0);
  }
  rafId = requestAnimationFrame(() => loopSigns(video, canvas));
}

$("signClearBtn").addEventListener("click", () => { signWords.pop(); renderChain(); });
$("signClearAllBtn").addEventListener("click", () => { signWords.length = 0; renderChain(); });
$("signSpeakBtn").addEventListener("click", () => {
  const t = signWords.map((w) => w.phrase).join(" ").trim();
  if (t) { speak(t); signWords.length = 0; renderChain(); }
  else toast("The sign chain is empty — hold a sign for a second first.", "info");
});

/* ---------------- health check ---------------- */

fetch("/api/health").then((r) => r.json()).then((h) => {
  if (h.ok) {
    $("healthText").textContent = "BRIDGE READY";
    $("healthDot").style.background = "var(--teal)";
  } else {
    $("healthText").textContent = "API KEY MISSING";
    $("healthDot").style.background = "var(--err)";
    toast(h.message || "Backend is missing GNANI_API_KEY.", "error");
  }
}).catch(() => {
  $("healthText").textContent = "BACKEND OFFLINE";
  $("healthDot").style.background = "var(--err)";
  toast("Backend not reachable — is uvicorn running?", "error");
});

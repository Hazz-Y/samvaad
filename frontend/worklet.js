// AudioWorklet: capture mono audio, downsample to 16 kHz, emit Int16 PCM
// buffers (~128 ms each) plus an RMS level for the VU meter / speech gate.

class PCMCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.ratio = sampleRate / this.targetRate; // worklet global sampleRate
    this.acc = [];
    this.accLen = 0;
    this.readPos = 0;
    this.batch = new Int16Array(2048); // 128 ms at 16 kHz
    this.batchPos = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    // RMS of this 128-sample block (at native rate) for level metering
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    const rms = Math.sqrt(sum / ch.length);

    this.acc.push(Float32Array.from(ch));
    this.accLen += ch.length;

    // flatten + resample when we have enough
    if (this.accLen >= this.ratio * 512) {
      const flat = new Float32Array(this.accLen);
      let o = 0;
      for (const b of this.acc) { flat.set(b, o); o += b.length; }
      this.acc = [];
      this.accLen = 0;

      for (let pos = this.readPos; pos < flat.length - 1; pos += this.ratio) {
        const i = Math.floor(pos);
        const frac = pos - i;
        const s = flat[i] * (1 - frac) + flat[i + 1] * frac; // linear interp
        const v = Math.max(-1, Math.min(1, s));
        this.batch[this.batchPos++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (this.batchPos === this.batch.length) {
          this.port.postMessage({ pcm: this.batch.buffer.slice(0), rms });
          this.batchPos = 0;
        }
      }
      this.readPos = 0;
    } else {
      this.port.postMessage({ rms });
    }
    return true;
  }
}

registerProcessor("pcm-capture", PCMCapture);

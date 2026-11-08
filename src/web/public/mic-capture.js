// AudioWorklet: microphone capture, downsampled to 12 kHz mono signed 16-bit in 20 ms frames.
// Classic script (no imports) so it also parses in the unit test with vm.Script.
/* global AudioWorkletProcessor, registerProcessor, sampleRate */

const TARGET_RATE = 12000;
const FRAME_SAMPLES = 240; // 20 ms
const ZEROS = 8;

class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.step = sampleRate / TARGET_RATE;
    // Low-pass at 92% of the output Nyquist frequency to avoid aliasing (windowed sinc).
    this.cut = Math.min(1, TARGET_RATE / sampleRate) * 0.92;
    this.half = ZEROS / this.cut;
    this.pad = Math.ceil(this.half);
    this.tail = new Float32Array(this.pad);
    this.pos = this.pad;
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.filled = 0;
    this.peak = 0;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'active') {
        this.active = e.data.on === true;
        this.tail = new Float32Array(this.pad);
        this.pos = this.pad;
        this.filled = 0;
      }
    };
  }

  emit(v) {
    const s = Math.max(-1, Math.min(1, v));
    this.frame[this.filled++] = Math.round(s * 32767);
    const a = Math.abs(s);
    if (a > this.peak) this.peak = a;
    if (this.filled === FRAME_SAMPLES) {
      const buf = this.frame.buffer;
      this.port.postMessage({ pcm: buf, peak: this.peak }, [buf]);
      this.frame = new Int16Array(FRAME_SAMPLES);
      this.filled = 0;
      this.peak = 0;
    }
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!this.active || !input) return true;
    const work = new Float32Array(this.tail.length + input.length);
    work.set(this.tail, 0);
    work.set(input, this.tail.length);
    const hw = this.half;
    let pos = this.pos;
    while (Math.floor(pos + hw) < work.length) {
      const i0 = Math.ceil(pos - hw);
      const i1 = Math.floor(pos + hw);
      let acc = 0;
      let wsum = 0;
      for (let i = i0; i <= i1; i++) {
        const d = i - pos;
        const x = Math.PI * this.cut * d;
        const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
        const w = this.cut * sinc * (0.5 + 0.5 * Math.cos(Math.PI * d / hw));
        acc += work[i] * w;
        wsum += w;
      }
      this.emit(acc / wsum);
      pos += this.step;
    }
    const keep = Math.max(0, Math.floor(pos) - this.pad);
    this.tail = work.slice(keep);
    this.pos = pos - keep;
    return true;
  }
}

registerProcessor('mic-capture', MicCapture);

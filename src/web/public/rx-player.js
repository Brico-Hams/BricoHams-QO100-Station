// AudioWorklet: jitter buffer and player for the 12 kHz mono RX audio sent by the server.
// Classic script (no imports) so it also parses in the unit test with vm.Script.
/* global AudioWorkletProcessor, registerProcessor, sampleRate */

const SOURCE_RATE = 12000;
const CAPACITY = SOURCE_RATE * 2; // 2 s ring buffer

class RxPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(CAPACITY);
    this.write = 0;
    this.count = 0; // samples buffered
    this.pos = 0; // fractional read position offset inside the buffered data
    this.read = 0;
    this.playing = false;
    this.targetSamples = Math.round(SOURCE_RATE * 0.08); // pre-buffer before starting
    this.maxSamples = Math.round(SOURCE_RATE * 0.5); // above this we drop the oldest audio to catch up
    this.step = SOURCE_RATE / sampleRate;
    this.stats = { underruns: 0, overruns: 0 };
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m && m.pcm instanceof Int16Array) this.push(m.pcm);
      else if (m && m.type === 'target' && m.ms > 0 && m.ms < 1000) this.targetSamples = Math.round(SOURCE_RATE * m.ms / 1000);
      else if (m && m.type === 'flush') this.flush();
      else if (m && m.type === 'notch') this.setNotch(m);
    };
    this.notch = null;
    this.mode = 'off';
  }

  // Notch settings come from the page; values are clamped here as well because the port is not a trust boundary for DSP maths.
  setNotch(m) {
    const dsp = globalThis.BHNotch;
    if (!dsp || !m.enabled) {
      this.notch = null;
      this.mode = 'off';
      return;
    }
    if (m.auto) {
      if (this.mode !== 'auto') this.notch = dsp.createLmsNotch();
      this.mode = 'auto';
      return;
    }
    const f = Number(m.freq);
    const w = Number(m.width);
    if (!(f >= 20 && f <= 5900 && w >= 10 && w <= 1000)) return;
    this.notch = dsp.createBiquadNotch(SOURCE_RATE, f, w);
    this.mode = 'manual';
  }

  flush() {
    this.count = 0;
    this.read = this.write;
    this.pos = 0;
    this.playing = false;
  }

  push(pcm) {
    const notch = this.notch;
    for (let i = 0; i < pcm.length; i++) {
      const s = pcm[i] / 32768;
      this.ring[this.write] = notch ? notch.process(s) : s;
      this.write = (this.write + 1) % CAPACITY;
    }
    this.count = Math.min(CAPACITY, this.count + pcm.length);
    if (this.count > this.maxSamples) {
      const drop = this.count - this.targetSamples;
      this.read = (this.read + drop) % CAPACITY;
      this.count -= drop;
      this.stats.overruns++;
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const ch0 = out[0];
    if (!this.playing && this.count >= this.targetSamples) this.playing = true;
    for (let i = 0; i < ch0.length; i++) {
      if (!this.playing || this.count < 2) {
        if (this.playing) {
          this.playing = false; // underrun: rebuffer instead of stuttering
          this.stats.underruns++;
        }
        ch0[i] = 0;
        continue;
      }
      const a = this.ring[this.read];
      const b = this.ring[(this.read + 1) % CAPACITY];
      ch0[i] = a + (b - a) * this.pos;
      this.pos += this.step;
      while (this.pos >= 1) {
        this.pos -= 1;
        this.read = (this.read + 1) % CAPACITY;
        this.count--;
      }
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    return true;
  }
}

registerProcessor('rx-player', RxPlayer);

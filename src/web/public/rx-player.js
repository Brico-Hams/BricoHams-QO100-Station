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
    };
  }

  flush() {
    this.count = 0;
    this.read = this.write;
    this.pos = 0;
    this.playing = false;
  }

  push(pcm) {
    for (let i = 0; i < pcm.length; i++) {
      this.ring[this.write] = pcm[i] / 32768;
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

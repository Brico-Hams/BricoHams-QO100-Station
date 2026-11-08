/* BricoHams (https://bricohams.org) - receive-audio notch filters.
 * Classic script shared by the RX AudioWorklet and the unit tests: no imports, no DOM, no allocations in the hot path. */
(function () {
  'use strict';

  /**
   * Biquad notch (RBJ cookbook), one channel. Q = frequency / width.
   * @param {number} fs Sample rate in Hz.
   * @param {number} freq Notch centre in Hz (0 < freq < fs/2).
   * @param {number} width -3 dB width in Hz.
   * @returns {{process: (x: number) => number, reset: () => void}}
   */
  function createBiquadNotch(fs, freq, width) {
    const w0 = (2 * Math.PI * freq) / fs;
    const alpha = Math.sin(w0) / (2 * (freq / Math.max(width, 1)));
    const a0 = 1 + alpha;
    const b0 = 1 / a0;
    const b1 = (-2 * Math.cos(w0)) / a0;
    const a1 = b1;
    const a2 = (1 - alpha) / a0;
    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    return {
      process(x) {
        const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        return y;
      },
      reset() { x1 = x2 = y1 = y2 = 0; },
    };
  }

  /**
   * Adaptive line enhancer: an NLMS filter predicts the periodic part (carriers) from a delayed copy of the input; the
   * output is the input minus that prediction, so steady tones are removed and noise/speech pass.
   * @param {{taps?: number, delay?: number, mu?: number}} [opts]
   * @returns {{process: (x: number) => number, reset: () => void}}
   */
  function createLmsNotch({ taps = 32, delay = 24, mu = 0.05 } = {}) {
    const len = delay + taps + 1;
    const buf = new Float32Array(len * 2); // doubled ring so the window is always contiguous
    const w = new Float32Array(taps);
    let pos = 0;
    let energy = 1e-3;
    return {
      process(x) {
        pos = (pos + 1) % len;
        buf[pos] = x;
        buf[pos + len] = x;
        // Window of past samples starting `delay` samples back.
        const base = pos + len - delay;
        let y = 0;
        let en = 0;
        for (let i = 0; i < taps; i++) {
          const v = buf[base - i];
          y += w[i] * v;
          en += v * v;
        }
        const e = x - y;
        const g = (mu * e) / (en + energy);
        for (let i = 0; i < taps; i++) w[i] += g * buf[base - i];
        return e;
      },
      reset() { buf.fill(0); w.fill(0); pos = 0; },
    };
  }

  globalThis.BHNotch = Object.freeze({ createBiquadNotch, createLmsNotch });
})();

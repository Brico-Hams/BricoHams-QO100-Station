/**
 * Streaming windowed-sinc resampler (arbitrary ratio, mono, pure JS).
 * The low-pass cut-off sits at 92% of the smaller Nyquist frequency, so downsampling is alias-protected
 * and upsampling is interpolated without images. Output is normalised per sample so DC gain is exactly 1.
 */
export class Resampler {
  #step;
  #cut;
  #half;
  #tail;
  #pos;

  /**
   * @param {number} inRate Input sample rate in Hz.
   * @param {number} outRate Output sample rate in Hz.
   * @param {{zeros?: number}} [opts] `zeros`: sinc zero crossings each side (quality/CPU trade-off).
   */
  constructor(inRate, outRate, { zeros = 8 } = {}) {
    if (!(inRate > 0) || !(outRate > 0)) throw new RangeError('sample rates must be positive');
    this.#step = inRate / outRate;
    // Fraction of the input Nyquist frequency that is passed.
    this.#cut = Math.min(1, outRate / inRate) * 0.92;
    this.#half = zeros / this.#cut;
    const pad = Math.ceil(this.#half);
    this.#tail = new Float32Array(pad);
    this.#pos = pad;
  }

  /** Forget all history (use between unrelated streams so stale samples never leak). */
  reset() {
    const pad = Math.ceil(this.#half);
    this.#tail = new Float32Array(pad);
    this.#pos = pad;
  }

  /**
   * Resample a block. State is kept between calls, so blocks may have any size.
   * @param {ArrayLike<number>} input Samples (any scale; the output has the same scale).
   * @returns {Float32Array}
   */
  process(input) {
    const work = new Float32Array(this.#tail.length + input.length);
    work.set(this.#tail, 0);
    for (let i = 0; i < input.length; i++) work[this.#tail.length + i] = input[i];

    const hw = this.#half;
    const cut = this.#cut;
    const out = [];
    let pos = this.#pos;
    while (Math.floor(pos + hw) < work.length) {
      const i0 = Math.ceil(pos - hw);
      const i1 = Math.floor(pos + hw);
      let acc = 0;
      let wsum = 0;
      for (let i = i0; i <= i1; i++) {
        const d = i - pos;
        const x = Math.PI * cut * d;
        const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
        const w = cut * sinc * (0.5 + 0.5 * Math.cos((Math.PI * d) / hw));
        acc += work[i] * w;
        wsum += w;
      }
      out.push(acc / wsum);
      pos += this.#step;
    }
    const keep = Math.max(0, Math.floor(pos) - Math.ceil(hw));
    this.#tail = work.slice(keep);
    this.#pos = pos - keep;
    return Float32Array.from(out);
  }
}

/**
 * Clamp a float sample to the signed 16-bit range and round it.
 * @param {number} v
 * @returns {number}
 */
export function toInt16(v) {
  return Math.max(-32768, Math.min(32767, Math.round(v)));
}

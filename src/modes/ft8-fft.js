// Mixed-radix complex FFT for any size (fast for sizes with small prime factors,
// such as the 3840- and 1152-point transforms used by FT8 and FT4).

/**
 * Create a forward FFT of fixed size.
 * @param {number} n Transform size (positive integer).
 * @returns {{n: number, power: (input: ArrayLike<number>, powerOut: Float64Array) => void}}
 *   `power(real, out)` writes |X[k]|^2 for k = 0..n/2 of the real input.
 */
export function createFft(n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('FFT size must be a positive integer');
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  const factors = [];
  for (let rest = n, p = 2; rest > 1;) {
    if (rest % p === 0) { factors.push(p); rest /= p; } else p += p === 2 ? 1 : 2;
  }
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  const inIm = new Float64Array(n);
  const tRe = new Float64Array(Math.max(1, ...factors));
  const tIm = new Float64Array(tRe.length);

  function work(o, inRe, off, stride, size, fi) {
    if (size === 1) {
      outRe[o] = inRe[off];
      outIm[o] = inIm[off];
      return;
    }
    const p = factors[fi];
    const m = size / p;
    for (let q = 0; q < p; q++) work(o + q * m, inRe, off + q * stride, stride * p, m, fi + 1);
    const step = n / size; // twiddle step for this stage
    for (let k = 0; k < m; k++) {
      for (let q = 0; q < p; q++) {
        const idx = o + q * m + k;
        const w = (q * k * step) % n;
        tRe[q] = outRe[idx] * cos[w] - outIm[idx] * sin[w];
        tIm[q] = outRe[idx] * sin[w] + outIm[idx] * cos[w];
      }
      for (let r = 0; r < p; r++) {
        let sr = 0;
        let si = 0;
        for (let q = 0; q < p; q++) {
          const w = (q * r * (n / p)) % n;
          sr += tRe[q] * cos[w] - tIm[q] * sin[w];
          si += tRe[q] * sin[w] + tIm[q] * cos[w];
        }
        outRe[o + k + r * m] = sr;
        outIm[o + k + r * m] = si;
      }
    }
  }

  return {
    n,
    power(real, out) {
      work(0, real, 0, 1, n, 0);
      const half = Math.floor(n / 2);
      for (let k = 0; k <= half; k++) out[k] = outRe[k] * outRe[k] + outIm[k] * outIm[k];
    },
  };
}

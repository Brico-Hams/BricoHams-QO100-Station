// Deterministic test signal helpers (no randomness between runs).

/**
 * Seeded PRNG (mulberry32).
 * @param {number} seed
 * @returns {() => number} Uniform values in [0, 1).
 */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Add white Gaussian noise in place.
 * @param {Float32Array} x
 * @param {number} sigma Standard deviation.
 * @param {number} seed
 * @returns {Float32Array} The same array.
 */
export function addAwgn(x, sigma, seed) {
  const rnd = prng(seed);
  for (let i = 0; i < x.length; i += 2) {
    const r = Math.sqrt(-2 * Math.log(1 - rnd()));
    const th = 2 * Math.PI * rnd();
    x[i] += sigma * r * Math.cos(th);
    if (i + 1 < x.length) x[i + 1] += sigma * r * Math.sin(th);
  }
  return x;
}

/**
 * Noise sigma that gives `snrDb` for a sine of amplitude `amp`, measured in a 2500 Hz reference bandwidth at 12 kHz sampling.
 * @param {number} amp
 * @param {number} snrDb
 * @returns {number}
 */
export function sigmaForSnr(amp, snrDb, fs = 12000) {
  const signalPower = (amp * amp) / 2;
  const noisePerHz = signalPower / 10 ** (snrDb / 10) / 2500;
  return Math.sqrt(noisePerHz * (fs / 2));
}

// Deterministic QO-100 narrow-band transponder simulator (complex baseband). Pure functions, no network, no clocks.
//
// Signal model
//  - Sample rate 96 kS/s, complex baseband, interleaved Float32Array [I0, Q0, I1, Q1, ...].
//  - Baseband 0 Hz = the nominal beacon IF (739.75 MHz = 10 489.75 MHz - 9.75 GHz LNB LO). The span (+-48 kHz) covers
//    the 400 Bd BPSK beacon, the CW beacon (moved to -35 kHz: the real one is at -250 kHz, which needs >= 600 kS/s) and
//    the first ~80 kHz of the SSB/digital segment.
//  - LNB drift moves EVERY signal by the same time-varying frequency (the beacon and the stations drift together), exactly
//    what a free-running LNB reference does. The receiver can follow it with `retuneHz` (the SDRangel centre correction).
//  - Noise is white Gaussian (AWGN), seeded per block, NOT drifted, so a block can be rendered at any time in any order.
//  - SNR is always defined in 2500 Hz audio bandwidth (the FT8/WSJT convention), identical to test/fixtures/dsp.js.
//    For a USB signal demodulated with `usbDemod` the real audio noise power in 2500 Hz is sigma^2 * 2500 / (2 * fs), so a
//    unit-amplitude audio tone needs complex amplitude A = sqrt(snr * 2500 * sigma^2 / fs).
import { prng, addAwgn } from '../fixtures/dsp.js';
import { synthSlot } from '../../src/modes/ft8-encode.js';
import { MORSE } from '../../src/modes/cw-decoder.js';

/** Sample rate of the complex baseband, Hz. */
export const SAMPLE_RATE = 96_000;
/** Nominal beacon IF (DEFAULT LNB LO 9.75 GHz), Hz. */
export const BEACON_IF_HZ = 739_750_000;
/** Default total complex noise standard deviation. Chosen so that 0 dB SNR gives a demodulated tone of ~0.08. */
export const DEFAULT_NOISE_SIGMA = 0.5;

const TWO_PI = 2 * Math.PI;
const SNR_BANDWIDTH_HZ = 2500;

/**
 * 32-bit integer hash of two integers (deterministic bit source independent of call order).
 * @param {number} a
 * @param {number} b
 * @returns {number} Unsigned 32-bit value.
 */
export function hash32(a, b) {
  let h = Math.imul((a ^ 0x9e3779b9) | 0, 0x85ebca6b) ^ Math.imul((b + 0x7f4a7c15) | 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Complex amplitude of a signal that has `snrDb` in 2500 Hz when demodulated.
 * @param {number} snrDb
 * @param {number} [noiseSigma] Total complex noise standard deviation of the band.
 * @param {number} [fs] Sample rate.
 * @returns {number}
 */
export function amplitudeForSnr(snrDb, noiseSigma = DEFAULT_NOISE_SIGMA, fs = SAMPLE_RATE) {
  return Math.sqrt((10 ** (snrDb / 10) * SNR_BANDWIDTH_HZ * noiseSigma ** 2) / fs);
}

// ---------------------------------------------------------------------------------------------------------------- Morse

const MORSE_ENCODE = (() => {
  const map = {};
  for (const [pattern, ch] of Object.entries(MORSE)) map[ch] = pattern;
  return map;
})();

/**
 * Build a Morse keying envelope (0..1) with raised-cosine edges.
 * Timing: dot = 1.2 / wpm s, dash = 3 dots, element gap = 1, letter gap = 3, word gap = 7 (PARIS standard).
 * @param {string} text Characters unknown to the decoder table are skipped.
 * @param {number} wpm
 * @param {{rate?: number, leadS?: number, tailS?: number, rampS?: number}} [opts]
 * @returns {Float32Array} Envelope sampled at `rate` (default 12 000 Hz).
 */
export function keyingEnvelope(text, wpm, { rate = 12_000, leadS = 0.5, tailS = 1, rampS = 0.005 } = {}) {
  const dot = 1.2 / wpm;
  const on = []; // [startS, endS]
  let t = leadS;
  for (const raw of String(text).toUpperCase()) {
    if (raw === ' ') {
      t += 4 * dot; // 3 already added after the previous letter
      continue;
    }
    const pattern = MORSE_ENCODE[raw];
    if (!pattern) continue;
    for (const el of pattern) {
      const len = (el === '-' ? 3 : 1) * dot;
      on.push([t, t + len]);
      t += len + dot;
    }
    t += 2 * dot; // element gap already added: total letter gap 3 dots
  }
  const total = Math.ceil((t + tailS) * rate);
  const env = new Float32Array(total);
  const ramp = Math.max(1, Math.round(rampS * rate));
  for (const [s, e] of on) {
    const a = Math.round(s * rate);
    const b = Math.min(total, Math.round(e * rate));
    for (let i = a; i < b; i++) {
      let g = 1;
      if (i - a < ramp) g = 0.5 - 0.5 * Math.cos((Math.PI * (i - a)) / ramp);
      if (b - 1 - i < ramp) g = Math.min(g, 0.5 - 0.5 * Math.cos((Math.PI * (b - 1 - i)) / ramp));
      env[i] = g;
    }
  }
  return env;
}

// ---------------------------------------------------------------------------------------------------------------- LNB drift

/**
 * LNB frequency drift model: static reference error (ppm of the LO) + temperature ramp (optionally settling
 * exponentially) + random walk. The returned object is a pure function of time, backed by a 1 s table.
 * @param {{seed?: number, durationS?: number, ppm?: number, loHz?: number, rampHzPerHour?: number, settleTauS?: number,
 *   walkHzPerRootS?: number}} [opts] `rampHzPerHour` is the initial slope; up to +-20 000 Hz/h is realistic for QO-100 LNBs.
 * @returns {{freqHz(tS: number): number, phase(tS: number): number, durationS: number}}
 */
export function createLnbDrift({ seed = 1, durationS = 7500, ppm = 0, loHz = 9_750_000_000, rampHzPerHour = 0, settleTauS = 0, walkHzPerRootS = 0 } = {}) {
  const n = Math.ceil(durationS) + 2;
  const f = new Float64Array(n);
  const phi = new Float64Array(n);
  const rnd = prng(seed);
  const slope = rampHzPerHour / 3600;
  let walk = 0;
  for (let k = 0; k < n; k++) {
    const u1 = rnd();
    const u2 = rnd();
    walk += walkHzPerRootS * Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(TWO_PI * u2);
    const ramp = settleTauS > 0 ? slope * settleTauS * (1 - Math.exp(-k / settleTauS)) : slope * k;
    f[k] = ppm * 1e-6 * loHz + ramp + walk;
  }
  for (let k = 0; k + 1 < n; k++) phi[k + 1] = phi[k] + (TWO_PI * (f[k] + f[k + 1])) / 2;
  const index = (tS) => Math.max(0, Math.min(n - 2, Math.floor(tS)));
  return {
    freqHz(tS) {
      const k = index(tS);
      return f[k] + (f[k + 1] - f[k]) * (tS - k);
    },
    phase(tS) {
      const k = index(tS);
      const tau = tS - k;
      return phi[k] + TWO_PI * (f[k] * tau + ((f[k + 1] - f[k]) * tau * tau) / 2);
    },
    durationS: n - 2,
  };
}

// ---------------------------------------------------------------------------------------------------------------- filters

/**
 * Hamming-windowed sinc low pass with unity DC gain.
 * @param {number} numTaps Odd.
 * @param {number} cutoffHz
 * @param {number} fs
 * @returns {Float64Array}
 */
export function lowpassTaps(numTaps, cutoffHz, fs) {
  const h = new Float64Array(numTaps);
  const mid = (numTaps - 1) / 2;
  const fc = cutoffHz / fs;
  let sum = 0;
  for (let i = 0; i < numTaps; i++) {
    const m = i - mid;
    const sinc = m === 0 ? 2 * fc : Math.sin(TWO_PI * fc * m) / (Math.PI * m);
    h[i] = sinc * (0.54 - 0.46 * Math.cos((TWO_PI * i) / (numTaps - 1)));
    sum += h[i];
  }
  for (let i = 0; i < numTaps; i++) h[i] /= sum;
  return h;
}

// Zero-delay (centred) FIR + decimation, complex input.
function firDecimate(re, im, taps, factor) {
  const half = (taps.length - 1) >> 1;
  const n = re.length;
  const m = Math.floor(n / factor);
  const outRe = new Float32Array(m);
  const outIm = new Float32Array(m);
  for (let k = 0; k < m; k++) {
    const c = k * factor;
    const lo = Math.max(0, c - half);
    const hi = Math.min(n - 1, c + half);
    let a = 0;
    let b = 0;
    for (let j = lo; j <= hi; j++) {
      const h = taps[j - c + half];
      a += h * re[j];
      b += h * im[j];
    }
    outRe[k] = a;
    outIm[k] = b;
  }
  return { re: outRe, im: outIm };
}

function firDecimateReal(x, taps, factor) {
  const half = (taps.length - 1) >> 1;
  const n = x.length;
  const m = Math.floor(n / factor);
  const out = new Float32Array(m);
  for (let k = 0; k < m; k++) {
    const c = k * factor;
    const lo = Math.max(0, c - half);
    const hi = Math.min(n - 1, c + half);
    let a = 0;
    for (let j = lo; j <= hi; j++) a += taps[j - c + half] * x[j];
    out[k] = a;
  }
  return out;
}

// Real interpolation by 2 (taps must have gain 2).
function firInterpolate2(x, taps) {
  const half = (taps.length - 1) >> 1;
  const n = x.length;
  const out = new Float32Array(2 * n);
  for (let m = 0; m < 2 * n; m++) {
    const nLo = Math.max(0, Math.ceil((m - half) / 2));
    const nHi = Math.min(n - 1, Math.floor((m + half) / 2));
    let a = 0;
    for (let i = nLo; i <= nHi; i++) a += taps[m - 2 * i + half] * x[i];
    out[m] = a;
  }
  return out;
}

const DEMOD_SHIFT_HZ = 2100;
const TAPS_96K = lowpassTaps(63, 8000, SAMPLE_RATE);
const TAPS_SHARP = lowpassTaps(133, DEMOD_SHIFT_HZ, 24_000);
const TAPS_TO_12K = lowpassTaps(41, 5000, 24_000);
const TAPS_TO_48K = lowpassTaps(31, 11_000, 48_000).map((v) => v * 2);

/**
 * Ideal-ish USB receiver: selects the sideband above `carrierHz` (baseband offset of the suppressed carrier / audio 0 Hz),
 * filters it to ~0.3-3.9 kHz and returns the audio at 48 kHz and 12 kHz (the rate the decoders use).
 * A complex tone of amplitude A at carrierHz + f comes out as a real tone A*cos(2 pi f t); no group delay is introduced.
 * The whole signal is processed at once (a 15 s FT8 slot is ~11 MB), use short signals for streaming-sized tests.
 * @param {Float32Array} iq Interleaved complex baseband at `sampleRate` (96 kS/s).
 * @param {{carrierHz?: number, sampleRate?: number}} [opts]
 * @returns {{audio48k: Float32Array, audio12k: Float32Array}}
 */
export function usbDemod(iq, { carrierHz = 0, sampleRate = SAMPLE_RATE } = {}) {
  if (sampleRate !== SAMPLE_RATE) throw new RangeError('usbDemod is designed for 96 kS/s');
  const n = iq.length >> 1;
  const zr = new Float32Array(n);
  const zi = new Float32Array(n);
  const w = (-TWO_PI * (carrierHz + DEMOD_SHIFT_HZ)) / sampleRate;
  for (let i = 0; i < n; i++) {
    const p = w * i;
    const c = Math.cos(p);
    const s = Math.sin(p);
    const I = iq[2 * i];
    const Q = iq[2 * i + 1];
    zr[i] = I * c - Q * s;
    zi[i] = I * s + Q * c;
  }
  const a = firDecimate(zr, zi, TAPS_96K, 4);
  const b = firDecimate(a.re, a.im, TAPS_SHARP, 1);
  const audio24 = new Float32Array(b.re.length);
  const step = (TWO_PI * DEMOD_SHIFT_HZ) / 24_000;
  for (let k = 0; k < audio24.length; k++) audio24[k] = b.re[k] * Math.cos(step * k) - b.im[k] * Math.sin(step * k);
  return { audio48k: firInterpolate2(audio24, TAPS_TO_48K), audio12k: firDecimateReal(audio24, TAPS_TO_12K, 2) };
}

/**
 * Pad with zeros or trim to exactly `length` samples.
 * @param {Float32Array} x
 * @param {number} length
 * @returns {Float32Array}
 */
export function fitLength(x, length) {
  if (x.length === length) return x;
  const out = new Float32Array(length);
  out.set(x.subarray(0, Math.min(length, x.length)));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- audio -> baseband

const HILBERT_HALF = 63;
const HILBERT = (() => {
  const h = new Float64Array(2 * HILBERT_HALF + 1);
  for (let m = -HILBERT_HALF; m <= HILBERT_HALF; m++) {
    if (m % 2 !== 0) h[m + HILBERT_HALF] = (2 / (Math.PI * m)) * (0.54 + 0.46 * Math.cos((Math.PI * m) / (HILBERT_HALF + 1)));
  }
  return h;
})();
const INTERP_FACTOR = 8;
const INTERP_HALF = 64;
const INTERP = (() => {
  const h = new Float64Array(2 * INTERP_HALF + 1);
  const fc = 6900 / SAMPLE_RATE;
  for (let j = -INTERP_HALF; j <= INTERP_HALF; j++) {
    const sinc = j === 0 ? 2 * fc : Math.sin(TWO_PI * fc * j) / (Math.PI * j);
    h[j + INTERP_HALF] = INTERP_FACTOR * sinc * (0.54 + 0.46 * Math.cos((Math.PI * j) / (INTERP_HALF + 1)));
  }
  return h;
})();

/**
 * Turn real audio at 12 kHz into the analytic (upper-sideband) complex signal at 96 kS/s, audio 0 Hz at baseband 0 Hz.
 * Unit-amplitude audio gives unit complex magnitude.
 * @param {Float32Array} audio12k
 * @returns {Float32Array} Interleaved IQ at 96 kS/s (8x longer than the input).
 */
export function audioToIq(audio12k) {
  const n = audio12k.length;
  const re = audio12k;
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let q = 0;
    const lo = Math.max(0, i - HILBERT_HALF);
    const hi = Math.min(n - 1, i + HILBERT_HALF);
    for (let j = lo; j <= hi; j++) q += HILBERT[i - j + HILBERT_HALF] * re[j];
    im[i] = q;
  }
  const out = new Float32Array(2 * n * INTERP_FACTOR);
  for (let m = 0; m < n * INTERP_FACTOR; m++) {
    const nLo = Math.max(0, Math.ceil((m - INTERP_HALF) / INTERP_FACTOR));
    const nHi = Math.min(n - 1, Math.floor((m + INTERP_HALF) / INTERP_FACTOR));
    let a = 0;
    let b = 0;
    for (let k = nLo; k <= nHi; k++) {
      const h = INTERP[m - INTERP_FACTOR * k + INTERP_HALF];
      a += h * re[k];
      b += h * im[k];
    }
    out[2 * m] = a;
    out[2 * m + 1] = b;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- station descriptors

/**
 * SSB voice-like station: ~24 partials over 300-2700 Hz with a spectral tilt, a 3-5 Hz syllabic envelope and slow per-partial
 * amplitude wobble. `snrDb` is the average audio power in 2500 Hz relative to the noise.
 * @param {{offsetHz: number, snrDb: number, seed?: number, syllableHz?: number}} o `offsetHz`: baseband frequency of audio 0 Hz.
 * @returns {object} Station descriptor for `createBandSim`.
 */
export function voiceStation({ offsetHz, snrDb, seed = 1, syllableHz }) {
  const rnd = prng(seed);
  return { kind: 'voice', offsetHz, snrDb, seed, syllableHz: syllableHz ?? 3 + 2 * rnd() };
}

/**
 * Station that transmits arbitrary 12 kHz audio (unit amplitude) at a given carrier offset.
 * @param {{audio12k: Float32Array, offsetHz: number, snrDb: number, startS?: number, fade?: {rateHz: number, depth: number, phase?: number}}} o
 *   `fade`: QSB, gain swings between 1 - depth and 1 at `rateHz`.
 * @returns {object} Station descriptor for `createBandSim`.
 */
export function audioStation({ audio12k, offsetHz, snrDb, startS = 0, fade = null }) {
  return { kind: 'iq', iq: audioToIq(audio12k), offsetHz, snrDb, startS, fade };
}

/**
 * FT8/FT4 station built with the repository's own synthesizer.
 * @param {{text: string, mode: 'FT8'|'FT4', audioHz?: number, offsetHz: number, snrDb: number, startS?: number}} o
 * @returns {object}
 */
export function digitalStation({ text, mode, audioHz = 1500, offsetHz, snrDb, startS = 0 }) {
  const audio = synthSlot(text, mode, { freqHz: audioHz, amplitude: 1, sampleRate: 12_000 });
  return audioStation({ audio12k: audio, offsetHz, snrDb, startS });
}

/**
 * Keyed-tone CW station (Morse text encoded with the decoder's own table).
 * @param {{text: string, wpm: number, toneHz?: number, offsetHz: number, snrDb: number, startS?: number,
 *   fade?: {rateHz: number, depth: number, phase?: number}}} o
 * @returns {object}
 */
export function cwStation({ text, wpm, toneHz = 700, offsetHz, snrDb, startS = 0, fade = null }) {
  const env = keyingEnvelope(text, wpm, { rate: 12_000 });
  const audio = new Float32Array(env.length);
  for (let i = 0; i < audio.length; i++) audio[i] = env[i] * Math.sin((TWO_PI * toneHz * i) / 12_000);
  return audioStation({ audio12k: audio, offsetHz, snrDb, startS, fade });
}

// ---------------------------------------------------------------------------------------------------------------- band simulator

function makeBeacon(c, sigma, fs, seed) {
  const amp = amplitudeForSnr(c.snrDb ?? 30, sigma, fs);
  const baud = c.baud ?? 400;
  const theta = c.theta ?? Math.PI / 4;
  const off = c.offsetHz ?? 0;
  const q = 0.3; // fraction of the symbol spent in the smooth (half-cosine) transition
  const bit = (k) => (hash32(seed ^ 0xbeac04, k) & 1 ? 1 : -1);
  return {
    enabled: true,
    add(out, start, n) {
      if (!this.enabled) return;
      for (let i = 0; i < n; i++) {
        const t = (start + i) / fs;
        const x = t * baud;
        const k = Math.floor(x);
        const u = x - k;
        const cur = bit(k);
        let d = cur;
        if (u < q) {
          const prev = bit(k - 1);
          d = prev + (cur - prev) * (0.5 - 0.5 * Math.cos((Math.PI * u) / q));
        }
        const ph = theta * d + TWO_PI * ((off * t) % 1);
        out[2 * i] += amp * Math.cos(ph);
        out[2 * i + 1] += amp * Math.sin(ph);
      }
    },
  };
}

function makeCwBeacon(c, sigma, fs) {
  const wpm = c.wpm ?? 12;
  const rate = 2000;
  const env = keyingEnvelope(c.text ?? 'QO100 BEACON', wpm, { rate, leadS: 0, tailS: 7 * (1.2 / wpm), rampS: 0.005 });
  const period = env.length / rate;
  const amp = amplitudeForSnr(c.snrDb ?? 25, sigma, fs);
  const off = c.offsetHz ?? -35_000;
  return {
    enabled: true,
    add(out, start, n) {
      if (!this.enabled) return;
      for (let i = 0; i < n; i++) {
        const t = (start + i) / fs;
        const pos = (t % period) * rate;
        const k = Math.floor(pos);
        const fr = pos - k;
        const g = env[k] * (1 - fr) + env[(k + 1) % env.length] * fr;
        if (g === 0) continue;
        const ph = TWO_PI * ((off * t) % 1);
        out[2 * i] += amp * g * Math.cos(ph);
        out[2 * i + 1] += amp * g * Math.sin(ph);
      }
    },
  };
}

function makeTone(offsetHz, snrDb, sigma, fs) {
  const amp = amplitudeForSnr(snrDb, sigma, fs);
  return {
    enabled: true,
    add(out, start, n) {
      for (let i = 0; i < n; i++) {
        const ph = TWO_PI * ((offsetHz * (start + i)) / fs % 1);
        out[2 * i] += amp * Math.cos(ph);
        out[2 * i + 1] += amp * Math.sin(ph);
      }
    },
  };
}

function makeVoice(c, sigma, fs) {
  const rnd = prng(c.seed);
  const K = 24;
  const freqs = new Float64Array(K);
  const amps = new Float64Array(K);
  const phases = new Float64Array(K);
  const wobbleHz = new Float64Array(K);
  const wobbleFase = new Float64Array(K);
  let sumSq = 0;
  for (let k = 0; k < K; k++) {
    freqs[k] = c.offsetHz + 300 + (k + rnd()) * (2400 / K);
    amps[k] = (1 / (1 + (freqs[k] - c.offsetHz) / 800)) * (0.5 + 0.5 * rnd());
    phases[k] = TWO_PI * rnd();
    wobbleHz[k] = 0.3 + 1.5 * rnd();
    wobbleFase[k] = TWO_PI * rnd();
    sumSq += amps[k] * amps[k];
  }
  const ph1 = TWO_PI * rnd();
  const ph2 = TWO_PI * rnd();
  const envelope = (t) => {
    const syl = 0.5 + 0.5 * Math.sin(TWO_PI * c.syllableHz * t + ph1);
    return syl ** 1.5 * (0.65 + 0.35 * Math.sin(TWO_PI * 0.7 * t + ph2));
  };
  let mean2 = 0;
  for (let i = 0; i < 4000; i++) mean2 += envelope(i / 100) ** 2;
  mean2 /= 4000;
  // Target: mean real audio power sum(a^2)/2 * E[env^2] = snr * sigma^2 * 2500 / (2 fs)
  const gain = Math.sqrt((10 ** (c.snrDb / 10) * sigma * sigma * SNR_BANDWIDTH_HZ) / (fs * sumSq * mean2));
  return {
    enabled: true,
    add(out, start, n) {
      const env = new Float64Array(n);
      for (let i = 0; i < n; i++) env[i] = envelope((start + i) / fs);
      const t0 = start / fs;
      for (let k = 0; k < K; k++) {
        const stepP = (TWO_PI * freqs[k]) / fs;
        const p0 = TWO_PI * ((freqs[k] * t0) % 1) + phases[k];
        const cs = Math.cos(stepP);
        const sn = Math.sin(stepP);
        let cr = Math.cos(p0);
        let ci = Math.sin(p0);
        const a = gain * amps[k];
        const wob0 = TWO_PI * wobbleHz[k] * t0 + wobbleFase[k];
        for (let i = 0; i < n; i++) {
          const wob = 0.75 + 0.25 * Math.sin(wob0 + (TWO_PI * wobbleHz[k] * i) / fs);
          const g = a * env[i] * wob;
          out[2 * i] += g * cr;
          out[2 * i + 1] += g * ci;
          const nr = cr * cs - ci * sn;
          ci = cr * sn + ci * cs;
          cr = nr;
        }
      }
    },
  };
}

function makeIqStation(c, sigma, fs) {
  const amp = amplitudeForSnr(c.snrDb, sigma, fs);
  const startSample = Math.round(c.startS * fs);
  const len = c.iq.length >> 1;
  const fade = c.fade;
  return {
    enabled: true,
    add(out, start, n) {
      const a = Math.max(start, startSample);
      const b = Math.min(start + n, startSample + len);
      for (let g = a; g < b; g++) {
        const j = g - startSample;
        const t = g / fs;
        let gain = amp;
        if (fade) gain *= 1 - fade.depth * (0.5 - 0.5 * Math.cos(TWO_PI * fade.rateHz * t + (fade.phase ?? 0)));
        const ph = TWO_PI * ((c.offsetHz * t) % 1);
        const cr = Math.cos(ph);
        const ci = Math.sin(ph);
        const I = c.iq[2 * j];
        const Q = c.iq[2 * j + 1];
        const o = 2 * (g - start);
        out[o] += gain * (I * cr - Q * ci);
        out[o + 1] += gain * (I * ci + Q * cr);
      }
    },
  };
}

/**
 * Create a band simulator. All randomness derives from `seed`; rendering a block is a pure function of (startSample, retune).
 * @param {{seed?: number, sampleRate?: number, noiseSigma?: number,
 *   drift?: Parameters<typeof createLnbDrift>[0]|null,
 *   beacon?: {offsetHz?: number, snrDb?: number, baud?: number, theta?: number}|null,
 *   cwBeacon?: {offsetHz?: number, snrDb?: number, wpm?: number, text?: string}|null,
 *   stations?: object[], spurs?: Array<{offsetHz: number, snrDb: number}>}} [opts]
 *   `beacon` defaults to a 30 dB 400 Bd BPSK beacon at 0 Hz; pass `null` to omit. `cwBeacon` is omitted unless given.
 * @returns {{sampleRate: number, noiseSigma: number, drift: ReturnType<typeof createLnbDrift>|null,
 *   renderBlock(startSample: number, count: number, retuneHz?: number): Float32Array,
 *   blocks(startSample: number, totalSamples: number, opts?: {blockSize?: number, retuneHz?: number}): Generator<Float32Array>,
 *   setBeaconEnabled(on: boolean): void, driftHz(tS: number): number}}
 */
export function createBandSim({ seed = 1, sampleRate = SAMPLE_RATE, noiseSigma = DEFAULT_NOISE_SIGMA, drift = null, beacon = {}, cwBeacon = null, stations = [], spurs = [] } = {}) {
  if (sampleRate !== SAMPLE_RATE) throw new RangeError(`band-sim runs at ${SAMPLE_RATE} S/s`);
  const lnb = drift ? createLnbDrift({ seed: hash32(seed, 77), ...drift }) : null;
  const sources = [];
  let beaconSrc = null;
  if (beacon) sources.push((beaconSrc = makeBeacon(beacon, noiseSigma, sampleRate, seed)));
  if (cwBeacon) sources.push(makeCwBeacon(cwBeacon, noiseSigma, sampleRate));
  for (const sp of spurs) sources.push(makeTone(sp.offsetHz, sp.snrDb, noiseSigma, sampleRate));
  for (const st of stations) {
    if (st.kind === 'voice') sources.push(makeVoice(st, noiseSigma, sampleRate));
    else if (st.kind === 'iq') sources.push(makeIqStation(st, noiseSigma, sampleRate));
    else throw new TypeError(`unknown station kind ${st.kind}`);
  }
  const noiseComponent = noiseSigma / Math.SQRT2;

  const sim = {
    sampleRate,
    noiseSigma,
    drift: lnb,
    /**
     * Render `count` samples starting at absolute sample index `startSample`, as seen by a receiver retuned by `retuneHz`
     * (a receiver centred at nominal IF + retuneHz sees every signal at (offset + drift - retuneHz)).
     * @param {number} startSample
     * @param {number} count
     * @param {number} [retuneHz]
     * @returns {Float32Array} Interleaved IQ.
     */
    renderBlock(startSample, count, retuneHz = 0) {
      const out = new Float32Array(2 * count);
      for (const s of sources) s.add(out, startSample, count);
      if (lnb || retuneHz) {
        for (let i = 0; i < count; i++) {
          const t = (startSample + i) / sampleRate;
          const ph = (lnb ? lnb.phase(t) : 0) - TWO_PI * retuneHz * t;
          const c = Math.cos(ph);
          const s = Math.sin(ph);
          const I = out[2 * i];
          const Q = out[2 * i + 1];
          out[2 * i] = I * c - Q * s;
          out[2 * i + 1] = I * s + Q * c;
        }
      }
      return addAwgn(out, noiseComponent, hash32(seed ^ 0x5eed, startSample));
    },
    /**
     * Memory-bounded rendering: yields consecutive blocks.
     * @param {number} startSample
     * @param {number} totalSamples
     * @param {{blockSize?: number, retuneHz?: number}} [o]
     */
    *blocks(startSample, totalSamples, { blockSize = 16_384, retuneHz = 0 } = {}) {
      for (let done = 0; done < totalSamples; done += blockSize) {
        yield sim.renderBlock(startSample + done, Math.min(blockSize, totalSamples - done), retuneHz);
      }
    },
    /**
     * Switch the BPSK beacon on or off (outage simulation).
     * @param {boolean} on
     */
    setBeaconEnabled(on) {
      if (beaconSrc) beaconSrc.enabled = Boolean(on);
    },
    /**
     * Ground-truth LNB drift.
     * @param {number} tS Seconds.
     * @returns {number} Hz.
     */
    driftHz: (tS) => (lnb ? lnb.freqHz(tS) : 0),
  };
  return sim;
}

// ---------------------------------------------------------------------------------------------------------------- spectrum frames

const twiddles = new Map();
function twiddleTable(n) {
  let t = twiddles.get(n);
  if (!t) {
    t = { cos: new Float64Array(n / 2), sin: new Float64Array(n / 2) };
    for (let i = 0; i < n / 2; i++) {
      t.cos[i] = Math.cos((TWO_PI * i) / n);
      t.sin[i] = -Math.sin((TWO_PI * i) / n);
    }
    twiddles.set(n, t);
  }
  return t;
}

/**
 * In-place radix-2 FFT.
 * @param {Float64Array} re
 * @param {Float64Array} im
 */
export function fft(re, im) {
  const n = re.length;
  if ((n & (n - 1)) !== 0) throw new RangeError('FFT size must be a power of two');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  const { cos, sin } = twiddleTable(n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const stride = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * stride];
        const wi = sin[k * stride];
        const a = i + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/**
 * One spectrum frame serialized EXACTLY like SDRangel's spectrum WebSocket (little endian; see src/webrtc/spectrum.js):
 * u64 centre Hz, i64 FFT time ms, u64 timestamp ms, i32 N, i32 bandwidth Hz, i32 flags (0 = dB, full spectrum), N x f32 dB,
 * bin i at centre + (i - N/2) * bandwidth / N. Power is the Hann-windowed periodogram averaged over `averages` blocks.
 * @param {Float32Array} iq Interleaved IQ, at least `fftSize * averages` complex samples (extra samples are ignored).
 * @param {{centerHz?: number, sampleRate?: number, fftSize?: number, averages?: number, timestampMs?: number}} [o]
 *   `centerHz` must be the receiver centre frequency (nominal IF + applied correction) so the beacon module sees what SDRangel would send.
 * @returns {Buffer}
 */
export function fftFrame(iq, { centerHz = BEACON_IF_HZ, sampleRate = SAMPLE_RATE, fftSize = 2048, averages = 4, timestampMs = 1_700_000_000_000 } = {}) {
  const n = fftSize;
  const avail = Math.floor((iq.length >> 1) / n);
  if (avail < 1) throw new RangeError('not enough samples for one FFT');
  const blocks = Math.min(avail, averages);
  const win = new Float64Array(n);
  let winPower = 0;
  for (let i = 0; i < n; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / n);
    winPower += win[i] * win[i];
  }
  const acc = new Float64Array(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < n; i++) {
      re[i] = iq[2 * (b * n + i)] * win[i];
      im[i] = iq[2 * (b * n + i) + 1] * win[i];
    }
    fft(re, im);
    for (let i = 0; i < n; i++) acc[i] += re[i] * re[i] + im[i] * im[i];
  }
  const buf = Buffer.alloc(36 + n * 4);
  buf.writeBigUInt64LE(BigInt(Math.round(centerHz)), 0);
  buf.writeBigInt64LE(BigInt(Math.round((n / sampleRate) * 1000)), 8);
  buf.writeBigUInt64LE(BigInt(timestampMs), 16);
  buf.writeInt32LE(n, 24);
  buf.writeInt32LE(sampleRate, 28);
  buf.writeInt32LE(0, 32);
  for (let i = 0; i < n; i++) {
    const p = acc[(i + n / 2) % n] / (blocks * winPower); // fftshift: low to high frequency
    buf.writeFloatLE(10 * Math.log10(p + 1e-30), 36 + i * 4);
  }
  return buf;
}

/**
 * Split a long IQ capture into consecutive spectrum frames (see `fftFrame`).
 * @param {Float32Array} iq
 * @param {Parameters<typeof fftFrame>[1] & {hopSamples?: number}} [o] `hopSamples` defaults to fftSize * averages.
 * @returns {Generator<Buffer>}
 */
export function* fftFrames(iq, o = {}) {
  const { fftSize = 2048, averages = 4, hopSamples = fftSize * averages, timestampMs = 1_700_000_000_000 } = o;
  const need = fftSize * averages;
  const total = iq.length >> 1;
  for (let s = 0, k = 0; s + need <= total; s += hopSamples, k++) {
    yield fftFrame(iq.subarray(2 * s, 2 * (s + need)), { ...o, timestampMs: timestampMs + Math.round((s / SAMPLE_RATE) * 1000) });
  }
}

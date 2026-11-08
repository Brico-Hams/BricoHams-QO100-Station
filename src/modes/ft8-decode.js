// FT8 / FT4 slot decoder: waterfall, sync search, soft-decision LDPC decode.
// Port of the algorithms of ft8_lib (https://github.com/kgoba/ft8_lib): common/monitor.c and ft8/decode.c.
// Copyright (c) 2018 Karlis Goba, MIT License (see NOTICE.md).

import { FT4_XOR, PROTOCOLS, SAMPLE_RATE } from './ft8-constants.js';
import { encodeTones } from './ft8-encode.js';
import { createFft } from './ft8-fft.js';
import { bpDecode, computeCrc, extractCrc } from './ft8-ldpc.js';
import { unpackMessage } from './ft8-message.js';

const TIME_OSR = 2;
const FREQ_OSR = 2;
const FFTS = new Map();

function fftFor(n) {
  let f = FFTS.get(n);
  if (!f) { f = createFft(n); FFTS.set(n, f); }
  return f;
}

/**
 * Build the quantized dB waterfall of a slot (0.5 dB steps, 0..255 = -120..+7.5 dB).
 * @param {Float32Array} x Samples scaled to +-1.
 * @param {object} proto Protocol description.
 * @param {number} fs Sample rate.
 * @param {number} fMin
 * @param {number} fMax
 * @returns {{mag: Uint8Array, numBlocks: number, numBins: number, minBin: number, blockStride: number, nfft: number, histogram: Uint32Array}}
 */
export function buildWaterfall(x, proto, fs, fMin, fMax) {
  const blockSize = Math.round(fs * proto.symbolPeriod);
  const subSize = blockSize / TIME_OSR;
  const nfft = blockSize * FREQ_OSR;
  const minBin = Math.floor(fMin * proto.symbolPeriod);
  const maxBin = Math.floor(fMax * proto.symbolPeriod) + 1;
  const numBins = maxBin - minBin;
  const maxBlocks = Math.floor(proto.slotSeconds / proto.symbolPeriod);
  const numBlocks = Math.min(maxBlocks, Math.floor(x.length / blockSize));
  const blockStride = TIME_OSR * FREQ_OSR * numBins;
  const mag = new Uint8Array(numBlocks * blockStride);
  const histogram = new Uint32Array(256);
  const window = new Float64Array(nfft);
  for (let i = 0; i < nfft; i++) window[i] = (2 / nfft) * Math.sin((Math.PI * i) / nfft) ** 2;
  const fft = fftFor(nfft);
  const frame = new Float64Array(nfft);
  const power = new Float64Array(nfft / 2 + 1);
  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    for (let ts = 0; ts < TIME_OSR; ts++) {
      const end = b * blockSize + (ts + 1) * subSize;
      const start = end - nfft;
      for (let i = 0; i < nfft; i++) {
        const p = start + i;
        frame[i] = p >= 0 ? x[p] * window[i] : 0;
      }
      fft.power(frame, power);
      for (let fsub = 0; fsub < FREQ_OSR; fsub++) {
        for (let bin = minBin; bin < maxBin; bin++) {
          const db = 10 * Math.log10(1e-12 + power[bin * FREQ_OSR + fsub]);
          const scaled = Math.trunc(2 * db + 240);
          const v = scaled < 0 ? 0 : scaled > 255 ? 255 : scaled;
          mag[offset++] = v;
          histogram[v]++;
        }
      }
    }
  }
  return { mag, numBlocks, numBins, minBin, blockStride, nfft, histogram };
}

function candidateBase(wf, c) {
  return ((c.timeOffset * TIME_OSR + c.timeSub) * FREQ_OSR + c.freqSub) * wf.numBins + c.freqOffset;
}

function syncScore(wf, proto, c) {
  const { mag, blockStride, numBlocks } = wf;
  const base = candidateBase(wf, c);
  let score = 0;
  let count = 0;
  for (let m = 0; m < proto.numSync; m++) {
    const pattern = proto.costas(m);
    for (let k = 0; k < proto.lengthSync; k++) {
      const block = proto.firstSync + m * proto.syncOffset + k;
      const abs = c.timeOffset + block;
      if (abs < 0) continue;
      if (abs >= numBlocks) break;
      const p = base + block * blockStride;
      const sm = pattern[k];
      const v = mag[p + sm];
      if (sm > 0) { score += v - mag[p + sm - 1]; count++; }
      if (sm < proto.numTones - 1) { score += v - mag[p + sm + 1]; count++; }
      if (k > 0 && abs > 0) { score += v - mag[p + sm - blockStride]; count++; }
      if (k + 1 < proto.lengthSync && abs + 1 < numBlocks) { score += v - mag[p + sm + blockStride]; count++; }
    }
  }
  return count > 0 ? Math.trunc(score / count) : 0;
}

/**
 * Find the strongest sync candidates in a waterfall.
 * @param {ReturnType<typeof buildWaterfall>} wf
 * @param {object} proto
 * @param {number} maxCandidates
 * @param {number} minScore
 * @returns {Array<{timeOffset: number, timeSub: number, freqOffset: number, freqSub: number, score: number}>} Sorted by descending score.
 */
export function findCandidates(wf, proto, maxCandidates, minScore) {
  const found = [];
  for (let timeSub = 0; timeSub < TIME_OSR; timeSub++) {
    for (let freqSub = 0; freqSub < FREQ_OSR; freqSub++) {
      for (let timeOffset = -10; timeOffset < 20; timeOffset++) {
        for (let freqOffset = 0; freqOffset + proto.numTones - 1 < wf.numBins; freqOffset++) {
          const c = { timeOffset, timeSub, freqOffset, freqSub, score: 0 };
          c.score = syncScore(wf, proto, c);
          if (c.score >= minScore) found.push(c);
        }
      }
    }
  }
  found.sort((a, b) => b.score - a.score);
  return found.slice(0, maxCandidates);
}

function extractLlr(wf, proto, c) {
  const llr = new Float32Array(174);
  const base = candidateBase(wf, c);
  const s = new Float64Array(proto.numTones);
  for (let k = 0; k < proto.numData; k++) {
    const sym = proto.dataSymbol(k);
    const block = c.timeOffset + sym;
    const bit = k * proto.bitsPerSymbol;
    if (block < 0 || block >= wf.numBlocks) continue;
    const p = base + sym * wf.blockStride;
    for (let j = 0; j < proto.numTones; j++) s[j] = wf.mag[p + proto.gray[j]] / 2 - 120;
    if (proto.numTones === 8) {
      llr[bit] = Math.max(s[4], s[5], s[6], s[7]) - Math.max(s[0], s[1], s[2], s[3]);
      llr[bit + 1] = Math.max(s[2], s[3], s[6], s[7]) - Math.max(s[0], s[1], s[4], s[5]);
      llr[bit + 2] = Math.max(s[1], s[3], s[5], s[7]) - Math.max(s[0], s[2], s[4], s[6]);
    } else {
      llr[bit] = Math.max(s[2], s[3]) - Math.max(s[0], s[1]);
      llr[bit + 1] = Math.max(s[1], s[3]) - Math.max(s[0], s[2]);
    }
  }
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i < 174; i++) { sum += llr[i]; sum2 += llr[i] * llr[i]; }
  const variance = (sum2 - (sum * sum) / 174) / 174;
  if (!(variance > 1e-9)) return null;
  const norm = Math.sqrt(24 / variance);
  for (let i = 0; i < 174; i++) llr[i] *= norm;
  return llr;
}

function packBits(bits, numBits) {
  const out = new Uint8Array(12);
  for (let i = 0; i < numBits; i++) if (bits[i]) out[i >> 3] |= 0x80 >> (i & 7);
  return out;
}

function medianDb(histogram) {
  let total = 0;
  for (const n of histogram) total += n;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += histogram[v];
    if (acc * 2 >= total) return v / 2 - 120;
  }
  return -120;
}

// Rough SNR in a 2500 Hz reference bandwidth from the decoded tone powers against the waterfall noise floor.
function estimateSnr(wf, proto, c, tones, fs, noiseDb) {
  const base = candidateBase(wf, c);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < proto.numSymbols; i++) {
    const block = c.timeOffset + i;
    if (block < 0 || block >= wf.numBlocks) continue;
    sum += 10 ** ((wf.mag[base + i * wf.blockStride + tones[i]] / 2 - 120) / 10);
    n++;
  }
  if (n === 0) return -30;
  const noiseLin = 10 ** ((noiseDb + 1.6) / 10); // median -> mean of an exponential power distribution
  const sig = Math.max(sum / n - noiseLin, noiseLin * 1e-3);
  const binBandwidth = (1.5 * fs) / wf.nfft; // Hann window equivalent noise bandwidth
  const snr = 10 * Math.log10(sig / noiseLin) - 10 * Math.log10(2500 / binBandwidth);
  return Math.max(-30, Math.min(30, Math.round(snr)));
}

/**
 * Decode all FT8 or FT4 messages in one slot of audio.
 * @param {Float32Array|Int16Array} samples Mono audio at `sampleRate`, starting at the slot boundary. Int16 is scaled by 1/32768.
 * @param {{mode: 'FT8'|'FT4', hashes?: object, sampleRate?: number, maxCandidates?: number, minScore?: number,
 *   maxIterations?: number, fMin?: number, fMax?: number}} opts
 * @returns {Array<{text: string, type: string, freqHz: number, dtSec: number, snrDb: number, score: number}>}
 *   `freqHz` is the frequency of the lowest tone; `dtSec` is relative to the nominal 0.5 s start; `snrDb` is an estimate.
 */
export function decodeSlot(samples, { mode, hashes, sampleRate = SAMPLE_RATE, maxCandidates = 140, minScore = 10, maxIterations = 25, fMin = 200, fMax = 3000 }) {
  const proto = PROTOCOLS[String(mode).toUpperCase()];
  if (!proto) throw new RangeError(`unknown protocol ${mode}`);
  let x = samples;
  if (samples instanceof Int16Array) {
    x = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) x[i] = samples[i] / 32768;
  }
  const wf = buildWaterfall(x, proto, sampleRate, fMin, fMax);
  if (wf.numBlocks < proto.numSymbols / 2) return [];
  const noiseDb = medianDb(wf.histogram);
  const candidates = findCandidates(wf, proto, maxCandidates, minScore);
  const seenCrc = new Set();
  const seenText = new Set();
  const out = [];
  for (const c of candidates) {
    const llr = extractLlr(wf, proto, c);
    if (!llr) continue;
    const { plain, errors } = bpDecode(llr, maxIterations);
    if (errors > 0) continue;
    const a91 = packBits(plain, 91);
    const crcExtracted = extractCrc(a91);
    a91[9] &= 0xf8;
    a91[10] = 0;
    if (crcExtracted !== computeCrc(a91, 82)) continue;
    if (seenCrc.has(crcExtracted)) continue;
    seenCrc.add(crcExtracted);
    const payload = new Uint8Array(10);
    for (let i = 0; i < 10; i++) payload[i] = proto.name === 'FT4' ? a91[i] ^ FT4_XOR[i] : a91[i];
    const msg = unpackMessage(payload, hashes);
    if (!msg || seenText.has(msg.text)) continue;
    seenText.add(msg.text);
    const tones = encodeTones(payload, proto);
    const startSec = (c.timeOffset + c.timeSub / TIME_OSR - 1) * proto.symbolPeriod;
    out.push({
      text: msg.text,
      type: msg.type,
      freqHz: Math.round(((wf.minBin + c.freqOffset + c.freqSub / FREQ_OSR) / proto.symbolPeriod) * 10) / 10,
      dtSec: Math.round((startSec - proto.nominalStartSeconds) * 100) / 100,
      snrDb: estimateSnr(wf, proto, c, tones, sampleRate, noiseDb),
      score: c.score,
    });
  }
  return out;
}

// FT8/FT4 channel encoder and GFSK synthesizer.
// Port of ft8_lib (https://github.com/kgoba/ft8_lib): ft8/encode.c and demo/gen_ft8.c.
// Copyright (c) 2018 Karlis Goba, MIT License (see NOTICE.md).

import { FT4_XOR, PROTOCOLS, SAMPLE_RATE } from './ft8-constants.js';
import { addCrc, encode174 } from './ft8-ldpc.js';
import { packMessage } from './ft8-message.js';

function resolveProtocol(mode) {
  const proto = typeof mode === 'string' ? PROTOCOLS[mode.toUpperCase()] : mode;
  if (!proto) throw new RangeError(`unknown protocol ${mode}`);
  return proto;
}

/**
 * Channel symbols (tones) for a packed 77-bit payload.
 * @param {Uint8Array} payload 10 bytes from `packMessage`.
 * @param {'FT8'|'FT4'|object} mode
 * @returns {Uint8Array} 79 (FT8) or 105 (FT4) tone indexes.
 */
export function encodeTones(payload, mode) {
  const proto = resolveProtocol(mode);
  let source = payload;
  if (proto.name === 'FT4') source = Uint8Array.from(payload, (b, i) => b ^ FT4_XOR[i]);
  const bits = encode174(addCrc(source));
  const tones = new Uint8Array(proto.numSymbols);
  const syncTone = new Int8Array(proto.numSymbols).fill(-1);
  for (let m = 0; m < proto.numSync; m++) {
    for (let k = 0; k < proto.lengthSync; k++) {
      syncTone[proto.firstSync + m * proto.syncOffset + k] = proto.costas(m)[k];
    }
  }
  const ramp = proto.name === 'FT4' ? new Set([0, proto.numSymbols - 1]) : new Set();
  let bitPos = 0;
  let dataIdx = 0;
  for (let i = 0; i < proto.numSymbols; i++) {
    if (syncTone[i] >= 0) {
      tones[i] = syncTone[i];
    } else if (ramp.has(i)) {
      tones[i] = 0;
    } else {
      let v = 0;
      for (let b = 0; b < proto.bitsPerSymbol; b++) v = (v << 1) | bits[bitPos++];
      tones[i] = proto.gray[v];
      dataIdx++;
    }
  }
  if (bitPos !== 174 || dataIdx !== proto.numData) throw new Error('internal error: bad symbol layout');
  return tones;
}

/**
 * Encode message text to channel symbols.
 * @param {string} text
 * @param {'FT8'|'FT4'} mode
 * @param {{hashes?: object}} [opts]
 * @returns {Uint8Array}
 */
export function encodeMessage(text, mode, { hashes } = {}) {
  return encodeTones(packMessage(text, hashes), mode);
}

// Abramowitz & Stegun 7.1.26, max error 1.5e-7: plenty for a modulation pulse.
function erf(x) {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

const GFSK_K = Math.PI * Math.sqrt(2 / Math.LN2);

/**
 * Gaussian-filtered FSK waveform.
 * @param {ArrayLike<number>} symbols Tone indexes.
 * @param {{f0: number, bt: number, symbolPeriod: number, sampleRate?: number}} opts `f0` is the frequency of tone 0 in Hz.
 * @returns {Float32Array} Unit-amplitude signal of `symbols.length * symbolPeriod` seconds.
 */
export function synthGfsk(symbols, { f0, bt, symbolPeriod, sampleRate = SAMPLE_RATE }) {
  const nSym = symbols.length;
  const nsp = Math.round(sampleRate * symbolPeriod);
  const nWave = nSym * nsp;
  const dphiPeak = (2 * Math.PI) / nsp;
  const dphi = new Float64Array(nWave + 2 * nsp).fill((2 * Math.PI * f0) / sampleRate);
  const pulse = new Float64Array(3 * nsp);
  for (let i = 0; i < pulse.length; i++) {
    const t = i / nsp - 1.5;
    pulse[i] = (erf(GFSK_K * bt * (t + 0.5)) - erf(GFSK_K * bt * (t - 0.5))) / 2;
  }
  for (let i = 0; i < nSym; i++) {
    const ib = i * nsp;
    for (let j = 0; j < 3 * nsp; j++) dphi[j + ib] += dphiPeak * symbols[i] * pulse[j];
  }
  // Dummy symbols before and after repeat the first and last tone so the edges are not smeared towards f0.
  for (let j = 0; j < 2 * nsp; j++) {
    dphi[j] += dphiPeak * pulse[j + nsp] * symbols[0];
    dphi[j + nSym * nsp] += dphiPeak * pulse[j] * symbols[nSym - 1];
  }
  const signal = new Float32Array(nWave);
  let phi = 0;
  for (let k = 0; k < nWave; k++) {
    signal[k] = Math.sin(phi);
    phi = (phi + dphi[k + nsp]) % (2 * Math.PI);
  }
  const nRamp = Math.floor(nsp / 8);
  for (let i = 0; i < nRamp; i++) {
    const env = (1 - Math.cos((2 * Math.PI * i) / (2 * nRamp))) / 2;
    signal[i] *= env;
    signal[nWave - 1 - i] *= env;
  }
  return signal;
}

/**
 * Synthesize a full transmit slot (silence + signal + silence).
 * @param {string} text Message text.
 * @param {'FT8'|'FT4'} mode
 * @param {{freqHz?: number, startSeconds?: number, amplitude?: number, sampleRate?: number, hashes?: object}} [opts]
 *   `freqHz` is the frequency of tone 0 (the lowest tone); default 1500.
 * @returns {Float32Array} Samples of one slot (15 s for FT8, 7.5 s for FT4) at `sampleRate`.
 */
export function synthSlot(text, mode, { freqHz = 1500, startSeconds, amplitude = 0.5, sampleRate = SAMPLE_RATE, hashes } = {}) {
  const proto = resolveProtocol(mode);
  const tones = encodeMessage(text, proto, { hashes });
  const wave = synthGfsk(tones, { f0: freqHz, bt: proto.gaussianBt, symbolPeriod: proto.symbolPeriod, sampleRate });
  const slot = new Float32Array(Math.round(proto.slotSeconds * sampleRate));
  const start = Math.round((startSeconds ?? proto.nominalStartSeconds) * sampleRate);
  for (let i = 0; i < wave.length && start + i < slot.length; i++) slot[start + i] = wave[i] * amplitude;
  return slot;
}

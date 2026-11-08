// CRC-14 and (174,91) LDPC encoder / belief-propagation decoder for FT8 and FT4.
// Ported from ft8_lib (https://github.com/kgoba/ft8_lib): ft8/crc.c, ft8/encode.c, ft8/ldpc.c.
// Copyright (c) 2018 Karlis Goba, MIT License (see NOTICE.md).

import { LDPC_GENERATOR, LDPC_K_BYTES, LDPC_M, LDPC_MN, LDPC_N, LDPC_NM } from './ft8-tables.js';

const CRC_WIDTH = 14;
const CRC_POLY = 0x2757;
const TOPBIT = 1 << (CRC_WIDTH - 1);
const CRC_MASK = (TOPBIT << 1) - 1;

/**
 * 14-bit CRC (polynomial 0x2757) of the first `numBits` bits of `bytes` (MSB first).
 * @param {Uint8Array} bytes
 * @param {number} numBits
 * @returns {number}
 */
export function computeCrc(bytes, numBits) {
  let rem = 0;
  let idx = 0;
  for (let bit = 0; bit < numBits; bit++) {
    if (bit % 8 === 0) rem ^= bytes[idx++] << (CRC_WIDTH - 8);
    rem = (rem & TOPBIT) !== 0 ? ((rem << 1) ^ CRC_POLY) & CRC_MASK : (rem << 1) & CRC_MASK;
  }
  return rem & CRC_MASK;
}

/**
 * Read the CRC stored in bits 77..90 of a 91-bit message.
 * @param {Uint8Array} a91 12-byte message.
 * @returns {number}
 */
export function extractCrc(a91) {
  return ((a91[9] & 0x07) << 11) | (a91[10] << 3) | (a91[11] >> 5);
}

/**
 * Append the CRC to a 77-bit payload.
 * @param {Uint8Array} payload 10 bytes (77 bits, MSB first, last 3 bits zero).
 * @returns {Uint8Array} 12 bytes: 77 payload bits + 14 CRC bits + 5 zero bits.
 */
export function addCrc(payload) {
  const a91 = new Uint8Array(LDPC_K_BYTES);
  a91.set(payload.subarray(0, 10));
  a91[9] &= 0xf8;
  a91[10] = 0;
  // The CRC covers the 77-bit message zero-extended to 82 bits.
  const sum = computeCrc(a91, 96 - 14);
  a91[9] |= sum >> 11;
  a91[10] = (sum >> 3) & 0xff;
  a91[11] = (sum << 5) & 0xff;
  return a91;
}

const parity8 = (x) => {
  x ^= x >> 4;
  x ^= x >> 2;
  x ^= x >> 1;
  return x & 1;
};

/**
 * LDPC-encode a 91-bit message.
 * @param {Uint8Array} a91 12 bytes (91 bits, MSB first).
 * @returns {Uint8Array} 174 bits, one per element: the 91 message bits followed by 83 parity bits.
 */
export function encode174(a91) {
  const bits = new Uint8Array(LDPC_N);
  for (let i = 0; i < 91; i++) bits[i] = (a91[i >> 3] >> (7 - (i & 7))) & 1;
  for (let i = 0; i < LDPC_M; i++) {
    let sum = 0;
    const row = LDPC_GENERATOR[i];
    for (let j = 0; j < LDPC_K_BYTES; j++) sum ^= parity8(a91[j] & row[j]);
    bits[91 + i] = sum;
  }
  return bits;
}

/**
 * Number of failed parity checks of a 174-bit word (0 means a valid codeword).
 * @param {Uint8Array} bits 174 elements of 0/1.
 * @returns {number}
 */
export function ldpcCheck(bits) {
  let errors = 0;
  for (let m = 0; m < LDPC_M; m++) {
    let x = 0;
    for (const v of LDPC_NM[m]) if (v !== 0) x ^= bits[v - 1];
    if (x !== 0) errors++;
  }
  return errors;
}

// Rational approximations used by ft8_lib; much faster than Math.tanh/atanh and accurate enough for decoding.
function fastTanh(x) {
  if (x < -4.97) return -1;
  if (x > 4.97) return 1;
  const x2 = x * x;
  return (x * (945 + x2 * (105 + x2))) / (945 + x2 * (420 + x2 * 15));
}

function fastAtanh(x) {
  const x2 = x * x;
  return (x * (945 + x2 * (-735 + x2 * 64))) / (945 + x2 * (-1050 + x2 * 225));
}

// Precomputed topology: for each check m, the (0-origin) variables, and where each variable sits in the other list.
const CHECK_VARS = LDPC_NM.map((row) => row.filter((v) => v !== 0).map((v) => v - 1));
const VAR_CHECKS = LDPC_MN; // 0-origin checks per variable
const CHECK_VAR_SLOT = CHECK_VARS.map((vars, m) => vars.map((n) => VAR_CHECKS[n].indexOf(m)));
const VAR_CHECK_POS = VAR_CHECKS.map((checks, n) => checks.map((m) => CHECK_VARS[m].indexOf(n)));

/**
 * Belief-propagation (sum-product) decoder.
 * @param {Float32Array|number[]} llr 174 log-likelihood ratios, positive = bit is 1 (ft8_lib convention).
 * @param {number} [maxIters] Iterations (ft8_lib uses 25).
 * @returns {{plain: Uint8Array, errors: number}} Hard decision (174 bits) and number of parity errors of the best guess (0 = success).
 */
export function bpDecode(llr, maxIters = 25) {
  const tov = new Float32Array(LDPC_N * 3);
  const toc = new Float32Array(LDPC_M * 7);
  const plain = new Uint8Array(LDPC_N);
  let best = null;
  let minErrors = LDPC_M;

  for (let iter = 0; iter < maxIters; iter++) {
    let plainSum = 0;
    for (let n = 0; n < LDPC_N; n++) {
      plain[n] = llr[n] + tov[n * 3] + tov[n * 3 + 1] + tov[n * 3 + 2] > 0 ? 1 : 0;
      plainSum += plain[n];
    }
    if (plainSum === 0) break; // all-zero word is prohibited
    const errors = ldpcCheck(plain);
    if (errors < minErrors) {
      minErrors = errors;
      best = Uint8Array.from(plain);
      if (errors === 0) break;
    }

    for (let m = 0; m < LDPC_M; m++) {
      const vars = CHECK_VARS[m];
      for (let i = 0; i < vars.length; i++) {
        const n = vars[i];
        const k = CHECK_VAR_SLOT[m][i];
        const total = llr[n] + tov[n * 3] + tov[n * 3 + 1] + tov[n * 3 + 2] - tov[n * 3 + k];
        toc[m * 7 + i] = fastTanh(-total / 2);
      }
    }

    for (let n = 0; n < LDPC_N; n++) {
      for (let k = 0; k < 3; k++) {
        const m = VAR_CHECKS[n][k];
        const skip = VAR_CHECK_POS[n][k];
        let prod = 1;
        for (let i = 0; i < CHECK_VARS[m].length; i++) if (i !== skip) prod *= toc[m * 7 + i];
        tov[n * 3 + k] = -2 * fastAtanh(prod);
      }
    }
  }
  return { plain: best ?? plain, errors: minErrors };
}

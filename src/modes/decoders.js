/** Raised by the stub decoders so callers can show "decoder not available" instead of silent nothing. */
export class DecoderUnavailableError extends Error {
  /** @param {string} mode */
  constructor(mode) {
    super(`decoder not available for ${mode}`);
    this.name = 'DecoderUnavailableError';
    this.code = 'decoder_not_available';
    this.mode = mode;
  }
}

/**
 * @typedef {object} Decoder
 * @property {string} mode FT8, FT4 or CW.
 * @property {boolean} available False for the stub.
 * @property {(pcmFrame: Float32Array|Int16Array, utcSlot: {index: number, startMs: number}) => Array<{text: string, snrDb?: number, dtSec?: number, freqHz?: number}>} decode
 *   Decode one audio frame (mono, 12 kHz for FT8/FT4) belonging to a UTC slot. Returns decoded messages, possibly none.
 */

/**
 * Stub decoder: reports clearly that no real decoder is plugged in.
 * @param {string} mode
 * @returns {Decoder}
 */
export function createUnavailableDecoder(mode) {
  return {
    mode,
    available: false,
    decode() {
      throw new DecoderUnavailableError(mode);
    },
  };
}

const SLOT_MS = Object.freeze({ FT8: 15_000, FT4: 7_500 });

/**
 * UTC slot a timestamp falls in (FT8: 15 s, FT4: 7.5 s, aligned to the UTC minute).
 * @param {'FT8'|'FT4'} mode
 * @param {number} [nowMs]
 * @returns {{index: number, startMs: number}}
 */
export function utcSlot(mode, nowMs = Date.now()) {
  const len = SLOT_MS[mode];
  if (!len) throw new RangeError(`no UTC slots for mode ${mode}`);
  const index = Math.floor(nowMs / len);
  return { index, startMs: index * len };
}

/**
 * Registry of decoders by mode; unregistered modes get the unavailable stub.
 * @returns {{register(decoder: Decoder): void, get(mode: string): Decoder}}
 */
export function createDecoderRegistry() {
  const map = new Map();
  return {
    register(decoder) {
      if (typeof decoder?.decode !== 'function' || typeof decoder.mode !== 'string') throw new TypeError('invalid decoder');
      map.set(decoder.mode, decoder);
    },
    get(mode) {
      return map.get(mode) ?? createUnavailableDecoder(mode);
    },
  };
}

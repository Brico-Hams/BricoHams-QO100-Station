import { createCwDecoder } from './cw-decoder.js';
import { createInlineExecutor, createSlotDecoder, createWorkerExecutor } from './slot-decoder.js';

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
 * @property {(pcmFrame: Float32Array|Int16Array, utcSlot: {index: number, startMs: number}, nowMs?: number) => Array<object>|Promise<Array<object>>} decode
 *   Feed one audio frame (mono, 12 kHz). CW returns new text chunks `{text, wpm, freqHz}`; FT8/FT4 return the
 *   messages `{text, type, snrDb, dtSec, freqHz}` of a slot when it is decoded, otherwise an empty array.
 * @property {() => Array<object>|Promise<Array<object>>} [flush] Force pending output.
 * @property {() => Promise<void>|void} [close] Release workers.
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
 * @returns {{register(decoder: Decoder): void, get(mode: string): Decoder, close(): Promise<void>}}
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
    async close() {
      await Promise.all([...map.values()].map((d) => d.close?.()));
    },
  };
}

/**
 * Registry with the real decoders: CW (stream), FT8 and FT4 (UTC slots).
 * @param {{useWorkers?: boolean}} [opts] `useWorkers` runs FT8/FT4 decoding in a worker thread (production);
 *   the default decodes inline, which blocks the event loop for about a second per slot.
 * @returns {ReturnType<typeof createDecoderRegistry>}
 */
export function createDefaultDecoderRegistry({ useWorkers = false } = {}) {
  const registry = createDecoderRegistry();
  registry.register(createCwDecoder());
  for (const mode of ['FT8', 'FT4']) {
    registry.register(createSlotDecoder({ mode, executor: useWorkers ? createWorkerExecutor() : createInlineExecutor() }));
  }
  return registry;
}


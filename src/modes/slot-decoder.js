// UTC-slot aligned FT8/FT4 decoders and the executors that run the heavy decoding.
import { Worker } from 'node:worker_threads';
import { PROTOCOLS, SAMPLE_RATE } from './ft8-constants.js';
import { decodeSlot } from './ft8-decode.js';
import { createHashTable } from './ft8-message.js';

/**
 * Executor that decodes on the calling thread (tests, tools). Blocks for about a second per FT8 slot.
 * @returns {{run(mode: string, samples: Float32Array): Array<object>, close(): void}}
 */
export function createInlineExecutor() {
  const hashes = createHashTable();
  return {
    run: (mode, samples) => decodeSlot(samples, { mode, hashes }),
    close() {},
  };
}

/**
 * Executor that decodes in a `node:worker_threads` worker (created lazily, never keeps the process alive).
 * @returns {{run(mode: string, samples: Float32Array): Promise<Array<object>>, close(): Promise<void>}}
 */
export function createWorkerExecutor() {
  let worker = null;
  let nextId = 1;
  const pending = new Map();

  function failAll(err) {
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
    worker = null;
  }

  function ensure() {
    if (worker) return worker;
    const w = new Worker(new URL('./ft8-worker.js', import.meta.url));
    w.unref();
    w.on('message', ({ id, results, error }) => {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(results);
    });
    w.on('error', (err) => failAll(err));
    w.on('exit', () => failAll(new Error('decoder worker exited')));
    worker = w;
    return w;
  }

  return {
    run(mode, samples) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        try {
          ensure().postMessage({ id, mode, samples }, [samples.buffer]);
        } catch (err) {
          pending.delete(id);
          reject(err);
        }
      });
    },
    async close() {
      const w = worker;
      worker = null;
      if (w) await w.terminate();
    },
  };
}

/**
 * FT8 / FT4 decoder: accumulates 12 kHz audio of the current UTC slot and decodes it shortly before the slot
 * ends (FT8 14.5 s, FT4 7.0 s), or when the next slot starts, whichever comes first.
 * @param {{mode: 'FT8'|'FT4', executor?: ReturnType<typeof createInlineExecutor>, sampleRate?: number}} opts
 * @returns {{mode: string, available: true, decode(frame: Float32Array|Int16Array, slot: {index: number, startMs: number}, nowMs?: number): Array<object>|Promise<Array<object>>,
 *   flush(): Array<object>|Promise<Array<object>>, reset(): void, close(): Promise<void>|void}}
 *   `decode` returns the messages of a slot when it triggers a decode, otherwise an empty array. The audio frame is
 *   placed at the sample offset implied by `nowMs` so a partial first slot stays time aligned.
 */
export function createSlotDecoder({ mode, executor = createInlineExecutor(), sampleRate = SAMPLE_RATE }) {
  const proto = PROTOCOLS[mode];
  if (!proto) throw new RangeError(`unsupported mode ${mode}`);
  const slotSamples = Math.round(proto.slotSeconds * sampleRate);
  const triggerSamples = Math.round(proto.decodeAtSeconds * sampleRate);
  let cur = null;

  function begin(slot, nowMs, frameLen) {
    const at = Math.round(((nowMs - slot.startMs) / 1000) * sampleRate) - frameLen;
    cur = { index: slot.index, startMs: slot.startMs, buf: new Float32Array(slotSamples), pos: Math.max(0, Math.min(at, slotSamples)), decoded: false };
  }

  function finish() {
    if (!cur || cur.decoded) return [];
    cur.decoded = true;
    const { startMs } = cur;
    const tag = (list) => list.map((m) => ({ ...m, slotStartMs: startMs }));
    const r = executor.run(mode, cur.buf.slice());
    return Array.isArray(r) ? tag(r) : r.then(tag);
  }

  return {
    mode,
    available: true,
    decode(frame, slot, nowMs = Date.now()) {
      let results = [];
      if (cur && slot.index !== cur.index) {
        results = finish();
        cur = null;
      }
      if (!cur) begin(slot, nowMs, frame.length);
      if (!cur.decoded) {
        const n = Math.min(frame.length, slotSamples - cur.pos);
        for (let i = 0; i < n; i++) cur.buf[cur.pos + i] = frame instanceof Int16Array ? frame[i] / 32768 : frame[i];
        cur.pos += n;
        if (cur.pos >= triggerSamples) {
          const late = finish();
          return Array.isArray(results) && results.length === 0 ? late : Promise.all([results, late]).then(([a, b]) => [...a, ...b]);
        }
      }
      return results;
    },
    flush() {
      const r = finish();
      cur = null;
      return r;
    },
    reset() {
      cur = null;
    },
    close() {
      cur = null;
      return executor.close();
    },
  };
}

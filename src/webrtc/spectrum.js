import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { encodeSpectrumFrame } from './frames.js';

const HEADER_BYTES = 36;
const IND_LINEAR = 1;
const IND_SSB = 2;
const MIN_FFT = 64;
const MAX_FFT = 65_536;
const FLOOR_DB = -200;
const WS_OPEN = 1;

/**
 * Decode one binary frame of SDRangel's spectrum WebSocket server.
 *
 * ref: docs/references/sdrangel-swagger/source/wsspectrum.cpp (buildPayload). Little endian:
 *
 * | offset | size | field |
 * |---|---|---|
 * | 0 | u64 | centre frequency, Hz |
 * | 8 | i64 | FFT time, ms |
 * | 16 | u64 | timestamp, ms since epoch |
 * | 24 | i32 | FFT size N (power of two) |
 * | 28 | i32 | bandwidth, Hz (the span covered by the FFT = sample rate) |
 * | 32 | i32 | indicators: bit 0 linear power (else dB), bit 1 ssb, bit 2 usb |
 * | 36 | N x f32 | power; bin i at centre + (i - N/2) * bandwidth / N (low to high; bin order UNCONFIRMED in wsspectrum.cpp) |
 *
 * Frames with the ssb indicator (half spectrum, layout unconfirmed) are rejected: provision the server with `ssb: 0`.
 * @param {Uint8Array} buf
 * @returns {{centerHz: number, binHz: number, sampleRate: number, timestampMs: number, power: Float32Array, powersDb: Float32Array}|null}
 *   `power` and `powersDb` are the same dB array (the latter is the name the beacon module uses). null when malformed.
 */
export function parseSpectrumFrame(buf) {
  if (!buf || buf.length < HEADER_BYTES) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const centerHz = Number(view.getBigUint64(0, true));
  const timestampMs = Number(view.getBigUint64(16, true));
  const n = view.getInt32(24, true);
  const sampleRate = view.getInt32(28, true);
  const indicators = view.getInt32(32, true);
  if (n < MIN_FFT || n > MAX_FFT || (n & (n - 1)) !== 0) return null;
  if (buf.length !== HEADER_BYTES + n * 4) return null;
  if (!Number.isSafeInteger(centerHz) || sampleRate <= 0 || (indicators & IND_SSB) !== 0) return null;
  const power = new Float32Array(n);
  const isDb = (indicators & IND_LINEAR) === 0;
  for (let i = 0; i < n; i++) {
    const v = view.getFloat32(HEADER_BYTES + i * 4, true);
    const db = isDb ? v : 10 * Math.log10(v);
    power[i] = Number.isFinite(db) ? db : FLOOR_DB;
  }
  return { centerHz, binHz: sampleRate / n, sampleRate, timestampMs, power, powersDb: power };
}

/**
 * Reduce a spectrum line to `outBins` bins, keeping the maximum of each group so narrow carriers stay visible.
 * @param {ArrayLike<number>} power dB values.
 * @param {number} outBins
 * @returns {Float32Array}
 */
export function downsampleSpectrum(power, outBins) {
  const n = power.length;
  if (outBins >= n) return Float32Array.from(power);
  const out = new Float32Array(outBins);
  for (let i = 0; i < outBins; i++) {
    const start = Math.floor((i * n) / outBins);
    const end = Math.max(start + 1, Math.floor(((i + 1) * n) / outBins));
    let m = -Infinity;
    for (let j = start; j < end; j++) if (power[j] > m) m = power[j];
    out[i] = m;
  }
  return out;
}

/**
 * Reads SDRangel's spectrum WebSocket and keeps the latest frame. Reconnects with back-off.
 * Events: `frame` (parsed frame), `state` ('connected'|'disconnected').
 */
export class SpectrumSource extends EventEmitter {
  #url;
  #WebSocketImpl;
  #maxAgeMs;
  #now;
  #ws = null;
  #latest = null;
  #stopped = true;
  #retryTimer = null;
  #retryMs = 500;
  #maxRetryMs;
  #logger;

  /**
   * @param {{url?: string, WebSocketImpl?: typeof WebSocket, maxAgeMs?: number, maxRetryMs?: number,
   *   now?: () => number, logger?: {error: Function}}} [opts] `maxAgeMs`: frames older than this are not served.
   */
  constructor({ url = 'ws://127.0.0.1:8887', WebSocketImpl = WebSocket, maxAgeMs = 3000, maxRetryMs = 10_000, now = Date.now, logger = console } = {}) {
    super();
    this.#url = url;
    this.#WebSocketImpl = WebSocketImpl;
    this.#maxAgeMs = maxAgeMs;
    this.#maxRetryMs = maxRetryMs;
    this.#now = now;
    this.#logger = logger;
  }

  /** Connect (and keep reconnecting) until `stop()`. */
  start() {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#connect();
  }

  /** Disconnect and stop reconnecting. */
  stop() {
    this.#stopped = true;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#ws?.terminate?.();
    this.#ws = null;
  }

  /**
   * Latest frame, shaped for the beacon controller.
   * @returns {Promise<{powersDb: Float32Array, centerHz: number, binHz: number}|null>} null when there is no fresh frame.
   */
  async getSpectrum() {
    const f = this.#latest;
    if (!f || this.#now() - f.at > this.#maxAgeMs) return null;
    return { powersDb: f.frame.powersDb, centerHz: f.frame.centerHz, binHz: f.frame.binHz };
  }

  #connect() {
    let ws;
    try {
      ws = new this.#WebSocketImpl(this.#url, { maxPayload: 4 * MAX_FFT + HEADER_BYTES });
    } catch (err) {
      this.#logger.error('spectrum: cannot connect:', err.message);
      this.#scheduleRetry();
      return;
    }
    this.#ws = ws;
    ws.binaryType = 'nodebuffer';
    ws.on('open', () => {
      this.#retryMs = 500;
      this.emit('state', 'connected');
    });
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const frame = parseSpectrumFrame(data);
      if (!frame) return;
      this.#latest = { frame, at: this.#now() };
      this.emit('frame', frame);
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (this.#ws === ws) this.#ws = null;
      this.emit('state', 'disconnected');
      this.#scheduleRetry();
    });
  }

  #scheduleRetry() {
    if (this.#stopped) return;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = setTimeout(() => this.#connect(), this.#retryMs);
    this.#retryTimer.unref();
    this.#retryMs = Math.min(this.#maxRetryMs, this.#retryMs * 2);
  }
}

/**
 * Create a SpectrumSource.
 * @param {ConstructorParameters<typeof SpectrumSource>[0]} [opts]
 * @returns {SpectrumSource}
 */
export function createSpectrumSource(opts) {
  return new SpectrumSource(opts);
}

/**
 * Fan the spectrum out to browsers: downsampled to `bins` and rate-limited to `maxFps`.
 * Slow listeners (socket buffer above `highWaterBytes`) skip lines instead of queueing them.
 * @param {{source: EventEmitter, bins?: number, maxFps?: number, highWaterBytes?: number, now?: () => number}} opts
 * @returns {{addListener(l: {readyState: number, bufferedAmount: number, send: Function}): () => void, stats(): object}}
 */
export function createSpectrumFeed({ source, bins = 512, maxFps = 10, highWaterBytes = 65_536, now = Date.now }) {
  const listeners = new Set();
  const counters = { frames: 0, sent: 0, dropped: 0, throttled: 0 };
  const minGapMs = 1000 / maxFps;
  let lastAt = -Infinity;
  let seq = 0;

  source.on('frame', (frame) => {
    const t = now();
    if (t - lastAt < minGapMs) {
      counters.throttled++;
      return;
    }
    lastAt = t;
    if (listeners.size === 0) return;
    const down = downsampleSpectrum(frame.power, bins);
    const msg = encodeSpectrumFrame(seq++, frame.centerHz, (frame.binHz * frame.power.length) / down.length, down);
    counters.frames++;
    for (const l of listeners) {
      if (l.readyState !== WS_OPEN || l.bufferedAmount > highWaterBytes) {
        counters.dropped++;
        continue;
      }
      try {
        l.send(msg, { binary: true });
        counters.sent++;
      } catch {
        counters.dropped++;
      }
    }
  });

  return {
    /**
     * Subscribe a WebSocket-like to spectrum lines (binary frames of kind 3, see frames.js).
     * @param {{readyState: number, bufferedAmount: number, send: Function}} listener
     * @returns {() => void} Unsubscribe function.
     */
    addListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** @returns {{frames: number, sent: number, dropped: number, throttled: number, listeners: number}} */
    stats: () => ({ ...counters, listeners: listeners.size }),
  };
}

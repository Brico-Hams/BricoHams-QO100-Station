import dgram from 'node:dgram';
import { FrameKind, encodeAudioFrame } from './frames.js';
import { Resampler, toInt16 } from './resample.js';

const WS_OPEN = 1;
const MAX_DATAGRAM = 65_535;

/**
 * @typedef {object} AudioListener
 * @property {number} readyState WebSocket ready state (1 = open).
 * @property {number} bufferedAmount Bytes queued and not yet sent to the peer.
 * @property {(data: Buffer, opts: {binary: boolean}) => void} send
 */

/**
 * Receive RX audio from SDRangel ("copy audio to UDP" of the SSB demodulator), resample it and fan it out.
 *
 * Invariant: this module never blocks and never queues. A listener whose socket buffer is above `highWaterBytes`
 * simply misses the frame (counted in `stats().dropped`), so one slow phone cannot delay the others or grow memory.
 * @param {{host?: string, port?: number, inRate?: number, outRate?: number, channels?: 1|2, frameSamples?: number,
 *   highWaterBytes?: number, createSocket?: () => import('node:dgram').Socket, logger?: {error: Function}}} [opts]
 * `channels: 2` takes the left channel of interleaved stereo (SDRangel can send stereo UDP audio).
 * @returns {{start(): Promise<{port: number}>, stop(): Promise<void>, addListener(l: AudioListener): () => void,
 *   addTap(fn: (samples: Int16Array) => void): () => void, ingest(datagram: Uint8Array): void, stats(): object}}
 */
export function createRxAudio({
  host = '127.0.0.1', port = 9998, inRate = 48_000, outRate = 12_000, channels = 1, frameSamples = 240,
  highWaterBytes = 16_384, createSocket = () => dgram.createSocket('udp4'), logger = console,
} = {}) {
  const resampler = new Resampler(inRate, outRate);
  const listeners = new Set();
  const taps = new Set();
  const counters = { datagrams: 0, badDatagrams: 0, frames: 0, sent: 0, dropped: 0 };
  let pending = [];
  let seq = 0;
  let socket = null;

  function emit(samples) {
    for (const tap of taps) {
      try {
        tap(samples);
      } catch (err) {
        logger.error('rx-audio: tap failed:', err.message);
      }
    }
    if (listeners.size === 0) return;
    const frame = encodeAudioFrame(FrameKind.RX_AUDIO, seq++, outRate, samples);
    counters.frames++;
    for (const l of listeners) {
      if (l.readyState !== WS_OPEN || l.bufferedAmount > highWaterBytes) {
        counters.dropped++;
        continue;
      }
      try {
        l.send(frame, { binary: true });
        counters.sent++;
      } catch {
        counters.dropped++;
      }
    }
  }

  function ingest(datagram) {
    const frameBytes = 2 * channels;
    if (!datagram || datagram.length === 0 || datagram.length > MAX_DATAGRAM || datagram.length % frameBytes !== 0) {
      counters.badDatagrams++;
      return;
    }
    counters.datagrams++;
    // Nobody is listening: skip the filter work, but keep the resampler state consistent by resetting it.
    if (listeners.size === 0 && taps.size === 0) {
      resampler.reset();
      pending = [];
      return;
    }
    const n = datagram.length / frameBytes;
    const input = new Float32Array(n);
    const view = new DataView(datagram.buffer, datagram.byteOffset, datagram.byteLength);
    for (let i = 0; i < n; i++) input[i] = view.getInt16(i * frameBytes, true);
    const out = resampler.process(input);
    for (const v of out) pending.push(toInt16(v));
    while (pending.length >= frameSamples) emit(Int16Array.from(pending.splice(0, frameSamples)));
  }

  return {
    /**
     * Bind the UDP socket.
     * @returns {Promise<{port: number}>} The bound port (useful with port 0).
     */
    start() {
      return new Promise((resolve, reject) => {
        socket = createSocket();
        socket.on('message', (msg) => {
          try {
            ingest(msg);
          } catch (err) {
            logger.error('rx-audio: datagram failed:', err.message);
          }
        });
        socket.once('error', reject);
        socket.bind(port, host, () => {
          socket.off('error', reject);
          socket.on('error', (err) => logger.error('rx-audio: socket error:', err.message));
          resolve({ port: socket.address().port });
        });
      });
    },
    /** Close the UDP socket. @returns {Promise<void>} */
    stop() {
      return new Promise((resolve) => {
        if (!socket) return resolve();
        const s = socket;
        socket = null;
        s.close(() => resolve());
      });
    },
    /**
     * Subscribe a (already authenticated) WebSocket-like to the audio stream.
     * @param {AudioListener} listener
     * @returns {() => void} Unsubscribe function.
     */
    addListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /**
     * Subscribe a local consumer (decoders) to the resampled stream; it keeps the pipeline running without listeners.
     * @param {(samples: Int16Array) => void} fn Called with each 12 kHz s16 mono frame (240 samples by default). Must not block.
     * @returns {() => void} Remove function.
     */
    addTap(fn) {
      taps.add(fn);
      return () => taps.delete(fn);
    },
    ingest,
    /** @returns {{datagrams: number, badDatagrams: number, frames: number, sent: number, dropped: number, listeners: number}} */
    stats: () => ({ ...counters, listeners: listeners.size }),
  };
}

import dgram from 'node:dgram';
import { FrameKind, decodeAudioFrame } from './frames.js';
import { Resampler, toInt16 } from './resample.js';

/** Mic sample rates the browser may send. Anything else is rejected rather than guessed. */
export const MIC_SAMPLE_RATES = Object.freeze([8000, 12000, 16000, 24000, 48000]);

const MAX_FRAME_SECONDS = 0.1;
const UDP_CHUNK_SAMPLES = 640;

/**
 * Destination of the transmit audio.
 * @typedef {object} TxAudioSink
 * @property {(pcm: Int16Array, sampleRate: number) => void} write Mono signed 16-bit samples, already limited.
 * @property {() => void} [reset] Called when the transmission ends; drop any buffered audio.
 * @property {() => Promise<void>|void} [close]
 */

/**
 * Sink sending s16le mono datagrams to the SDRangel UDPSource channel of the TX device set
 * (sampleFormat=3 FormatUSB, inputSampleRate=48000; provisioned by `station.provision()`).
 * SSBMod has NO UDP audio input (ref: docs/references/sdrangel-swagger/source/udpsourcesettings.h).
 * @param {{host?: string, port?: number, socket?: import('node:dgram').Socket}} [opts]
 * @returns {TxAudioSink}
 */
export function createUdpTxSink({ host = '127.0.0.1', port = 9999, socket = dgram.createSocket('udp4') } = {}) {
  socket.on('error', () => {});
  return {
    write(pcm) {
      for (let i = 0; i < pcm.length; i += UDP_CHUNK_SAMPLES) {
        const chunk = pcm.subarray(i, i + UDP_CHUNK_SAMPLES);
        socket.send(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength), port, host);
      }
    },
    close() {
      return new Promise((resolve) => socket.close(() => resolve()));
    },
  };
}

/**
 * Gate, validate, level-limit and forward microphone frames to a TxAudioSink.
 *
 * Invariants:
 * - A frame is forwarded only if its sender holds the PTT turn AND the PTT state is TX_ON at that very moment.
 *   The check is made per frame, so forwarding stops with the first frame after PTT release, watchdog cut or TOT.
 * - Output never exceeds `ceiling` (peak, fraction of full scale): the limiter has instant attack and a hard clamp,
 *   so a hot microphone cannot overdrive the PA chain.
 * @param {{ptt: {state: string, holderId: string|null, on: Function}, sink: TxAudioSink, sinkRate?: number,
 *   ceiling?: number, releaseSeconds?: number}} opts
 * @returns {{handleFrame(connId: string, data: Uint8Array): {ok: boolean, reason?: string}, stats(): object}}
 */
export function createTxAudio({ ptt, sink, sinkRate = 48_000, ceiling = 0.8, releaseSeconds = 0.2 }) {
  if (!(ceiling > 0 && ceiling <= 1)) throw new RangeError('ceiling must be in (0, 1]');
  const limit = Math.floor(32767 * ceiling);
  const release = 1 / (sinkRate * releaseSeconds);
  const resamplers = new Map();
  const counters = {
    accepted: 0, droppedNoTurn: 0, droppedNotTx: 0, droppedInvalid: 0, limitedSamples: 0, forwardedSamples: 0,
  };
  let gain = 1;

  function resetStream() {
    resamplers.clear();
    gain = 1;
    sink.reset?.();
  }

  ptt.on('state', (s) => {
    if (s.state !== 'TX_ON') resetStream();
  });

  function resamplerFor(rate) {
    let r = resamplers.get(rate);
    if (!r) {
      resamplers.clear(); // one stream at a time
      r = new Resampler(rate, sinkRate);
      resamplers.set(rate, r);
    }
    return r;
  }

  function applyLimiter(samples) {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const a = Math.abs(x);
      if (a * gain > limit) {
        gain = limit / a;
        counters.limitedSamples++;
      } else if (gain < 1) {
        gain = Math.min(1, gain + (1 - gain) * release * 4 + 1e-6);
      }
      out[i] = toInt16(Math.max(-limit, Math.min(limit, x * gain)));
    }
    return out;
  }

  return {
    /**
     * Handle one binary mic frame from a connection.
     * @param {string} connId Connection that sent it.
     * @param {Uint8Array} data Full binary message (header + s16le samples).
     * @returns {{ok: boolean, reason?: string}} `reason`: no_turn, not_tx, invalid.
     */
    handleFrame(connId, data) {
      // Authorisation first: cheap, and a listener must learn nothing about validation rules.
      if (ptt.holderId === null || ptt.holderId !== connId) {
        counters.droppedNoTurn++;
        return { ok: false, reason: 'no_turn' };
      }
      if (ptt.state !== 'TX_ON') {
        counters.droppedNotTx++;
        return { ok: false, reason: 'not_tx' };
      }
      const frame = decodeAudioFrame(data, FrameKind.MIC);
      if (!frame || !MIC_SAMPLE_RATES.includes(frame.sampleRate)
        || frame.samples.length > Math.floor(frame.sampleRate * MAX_FRAME_SECONDS)) {
        counters.droppedInvalid++;
        return { ok: false, reason: 'invalid' };
      }
      let pcm = frame.samples;
      if (frame.sampleRate !== sinkRate) {
        pcm = Int16Array.from(resamplerFor(frame.sampleRate).process(pcm), toInt16);
      }
      const limited = applyLimiter(pcm);
      counters.accepted++;
      counters.forwardedSamples += limited.length;
      if (limited.length > 0) sink.write(limited, sinkRate);
      return { ok: true };
    },
    /** @returns {{accepted: number, droppedNoTurn: number, droppedNotTx: number, droppedInvalid: number, limitedSamples: number, forwardedSamples: number}} */
    stats: () => ({ ...counters }),
  };
}

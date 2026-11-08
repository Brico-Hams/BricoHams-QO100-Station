/** Binary frame kinds on the control WebSocket (first byte of every binary message). */
export const FrameKind = Object.freeze({
  MIC: 1, // client -> server: microphone PCM
  RX_AUDIO: 2, // server -> client: receive audio PCM
  SPECTRUM: 3, // server -> client: quantised spectrum line
});

/** Size of the header of audio frames: kind u8, flags u8, seq u16, sampleRate u32 (all little endian). */
export const AUDIO_HEADER_BYTES = 8;

/** Size of the header of spectrum frames: kind u8, flags u8, seq u16, centerHz f64, binHz f32, count u16. */
export const SPECTRUM_HEADER_BYTES = 18;

/** Quantisation of spectrum levels: dB = byte / 2 - 140. */
export const SPECTRUM_DB_OFFSET = -140;
export const SPECTRUM_DB_STEP = 0.5;

/**
 * Encode an audio frame (RX or MIC).
 * @param {number} kind A FrameKind audio value.
 * @param {number} seq Sequence number, wrapped to 16 bits.
 * @param {number} sampleRate Hz.
 * @param {Int16Array} samples
 * @returns {Buffer}
 */
export function encodeAudioFrame(kind, seq, sampleRate, samples) {
  const buf = Buffer.allocUnsafe(AUDIO_HEADER_BYTES + samples.length * 2);
  buf.writeUInt8(kind, 0);
  buf.writeUInt8(0, 1);
  buf.writeUInt16LE(seq & 0xffff, 2);
  buf.writeUInt32LE(sampleRate, 4);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], AUDIO_HEADER_BYTES + i * 2);
  return buf;
}

/**
 * Decode and validate an audio frame.
 * @param {Uint8Array} buf
 * @param {number} expectedKind
 * @returns {{seq: number, sampleRate: number, samples: Int16Array}|null} null when malformed.
 */
export function decodeAudioFrame(buf, expectedKind) {
  if (!buf || buf.length < AUDIO_HEADER_BYTES + 2 || (buf.length - AUDIO_HEADER_BYTES) % 2 !== 0) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint8(0) !== expectedKind) return null;
  const count = (buf.length - AUDIO_HEADER_BYTES) / 2;
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) samples[i] = view.getInt16(AUDIO_HEADER_BYTES + i * 2, true);
  return { seq: view.getUint16(2, true), sampleRate: view.getUint32(4, true), samples };
}

/**
 * Encode a spectrum line for browsers.
 * @param {number} seq
 * @param {number} centerHz
 * @param {number} binHz
 * @param {ArrayLike<number>} powerDb Already downsampled to the wanted number of bins.
 * @returns {Buffer}
 */
export function encodeSpectrumFrame(seq, centerHz, binHz, powerDb) {
  const buf = Buffer.allocUnsafe(SPECTRUM_HEADER_BYTES + powerDb.length);
  buf.writeUInt8(FrameKind.SPECTRUM, 0);
  buf.writeUInt8(0, 1);
  buf.writeUInt16LE(seq & 0xffff, 2);
  buf.writeDoubleLE(centerHz, 4);
  buf.writeFloatLE(binHz, 12);
  buf.writeUInt16LE(powerDb.length, 16);
  for (let i = 0; i < powerDb.length; i++) {
    const q = Math.round((powerDb[i] - SPECTRUM_DB_OFFSET) / SPECTRUM_DB_STEP);
    buf.writeUInt8(Number.isFinite(q) ? Math.max(0, Math.min(255, q)) : 0, SPECTRUM_HEADER_BYTES + i);
  }
  return buf;
}

/**
 * Decode a spectrum line (used by tests; the browser has its own copy in app.js).
 * @param {Uint8Array} buf
 * @returns {{seq: number, centerHz: number, binHz: number, powerDb: Float32Array}|null}
 */
export function decodeSpectrumFrame(buf) {
  if (!buf || buf.length < SPECTRUM_HEADER_BYTES) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint8(0) !== FrameKind.SPECTRUM) return null;
  const count = view.getUint16(16, true);
  if (buf.length !== SPECTRUM_HEADER_BYTES + count) return null;
  const powerDb = new Float32Array(count);
  for (let i = 0; i < count; i++) powerDb[i] = view.getUint8(SPECTRUM_HEADER_BYTES + i) * SPECTRUM_DB_STEP + SPECTRUM_DB_OFFSET;
  return { seq: view.getUint16(2, true), centerHz: view.getFloat64(4, true), binHz: view.getFloat32(12, true), powerDb };
}

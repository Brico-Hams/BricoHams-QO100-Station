/**
 * Builds a frame in SDRangel's spectrum WebSocket layout (ref: docs/references/sdrangel-swagger/source/wsspectrum.cpp).
 * Kept as code instead of a binary file so it is reviewable; update it together with src/webrtc/spectrum.js.
 * `sampleRate` is the frame's bandwidth field.
 * @param {{centerHz?: number, sampleRate?: number, n?: number, peakBin?: number, peakDb?: number, noiseDb?: number, linear?: boolean,
 *   ssb?: boolean, timestampMs?: number}} [opts]
 * @returns {Buffer}
 */
export function buildSpectrumFrame({
  centerHz = 739_750_000, sampleRate = 102_400, n = 1024, peakBin = 600, peakDb = -50, noiseDb = -90, linear = false,
  ssb = false, timestampMs = 1_700_000_000_000,
} = {}) {
  const buf = Buffer.alloc(36 + n * 4);
  buf.writeBigUInt64LE(BigInt(centerHz), 0);
  buf.writeBigInt64LE(BigInt(Math.round((n / Math.max(sampleRate, 1)) * 1000)), 8);
  buf.writeBigUInt64LE(BigInt(timestampMs), 16);
  buf.writeInt32LE(n, 24);
  buf.writeInt32LE(sampleRate, 28);
  buf.writeInt32LE((linear ? 1 : 0) | (ssb ? 2 : 0), 32);
  for (let i = 0; i < n; i++) {
    const db = i === peakBin ? peakDb : noiseDb;
    buf.writeFloatLE(linear ? 10 ** (db / 10) : db, 36 + i * 4);
  }
  return buf;
}

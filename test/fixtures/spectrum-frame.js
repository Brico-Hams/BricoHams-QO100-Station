/**
 * Builds a frame in the layout assumed by `parseSpectrumFrame` (see src/webrtc/spectrum.js).
 * Kept as code instead of a binary file so it is reviewable; update it together with the parser.
 * @param {{centerHz?: number, sampleRate?: number, n?: number, peakBin?: number, peakDb?: number, noiseDb?: number, linear?: boolean}} [opts]
 * @returns {Buffer}
 */
export function buildSpectrumFrame({
  centerHz = 739_750_000, sampleRate = 102_400, n = 1024, peakBin = 600, peakDb = -50, noiseDb = -90, linear = false,
} = {}) {
  const buf = Buffer.alloc(20 + n * 4);
  buf.writeBigUInt64LE(BigInt(centerHz), 0);
  buf.writeUInt32LE(sampleRate, 8);
  buf.writeUInt32LE(n, 12);
  buf.writeUInt32LE(linear ? 0 : 1, 16);
  for (let i = 0; i < n; i++) {
    const db = i === peakBin ? peakDb : noiseDb;
    buf.writeFloatLE(linear ? 10 ** (db / 10) : db, 20 + i * 4);
  }
  return buf;
}

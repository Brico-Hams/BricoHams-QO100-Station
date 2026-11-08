import { openSync, writeSync, closeSync, readSync, fstatSync, ftruncateSync } from 'node:fs';

export const WAV_HEADER_BYTES = 44;

/**
 * Build a canonical 44-byte PCM WAV header.
 * @param {{dataBytes: number, sampleRate: number, channels?: number, bits?: number}} p
 * @returns {Buffer}
 */
export function wavHeader({ dataBytes, sampleRate, channels = 1, bits = 16 }) {
  const h = Buffer.alloc(WAV_HEADER_BYTES);
  const blockAlign = channels * (bits / 8);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * blockAlign, 28);
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(bits, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/**
 * Parse a header produced by `wavHeader`.
 * @param {Uint8Array} bytes At least 44 bytes.
 * @returns {{sampleRate: number, channels: number, bits: number, dataBytes: number, riffBytes: number}|null} `null` if it is not a PCM WAV.
 */
export function parseWavHeader(bytes) {
  if (bytes.length < WAV_HEADER_BYTES) return null;
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE' || b.toString('ascii', 36, 40) !== 'data') return null;
  return {
    riffBytes: b.readUInt32LE(4), channels: b.readUInt16LE(22), sampleRate: b.readUInt32LE(24), bits: b.readUInt16LE(34), dataBytes: b.readUInt32LE(40),
  };
}

/**
 * Streaming 16-bit mono WAV writer with a hard size cap. The header is written first with a zero length so that a crash
 * leaves a file `fixWavHeader` can repair; `close()` patches the real sizes.
 * @param {{path: string, sampleRate: number, maxBytes: number, channels?: number}} opts `maxBytes` caps the whole file (header included).
 * @returns {{write(samples: Int16Array): boolean, close(): number, readonly bytes: number, readonly full: boolean}}
 */
export function createWavWriter({ path, sampleRate, maxBytes, channels = 1 }) {
  if (!Number.isInteger(sampleRate) || sampleRate < 1) throw new RangeError('sampleRate');
  if (!Number.isInteger(maxBytes) || maxBytes <= WAV_HEADER_BYTES) throw new RangeError('maxBytes');
  const fd = openSync(path, 'wx', 0o600); // never overwrite an existing recording
  let data = 0;
  let full = false;
  let closed = false;
  writeSync(fd, wavHeader({ dataBytes: 0, sampleRate, channels }));
  const frame = 2 * channels;
  const cap = Math.floor((maxBytes - WAV_HEADER_BYTES) / frame) * frame;

  return {
    /**
     * Append samples (little-endian). Samples that would exceed the cap are dropped and the writer reports `full`.
     * @param {Int16Array} samples
     * @returns {boolean} `true` while more audio can be written.
     */
    write(samples) {
      if (closed || full) return false;
      const room = cap - data;
      const take = Math.min(samples.length * 2, room - (room % frame));
      if (take > 0) {
        const buf = Buffer.alloc(samples.length * 2);
        for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], i * 2);
        writeSync(fd, buf, 0, take);
        data += take;
      }
      if (take < samples.length * 2 || data >= cap) full = true;
      return !full;
    },
    /** Patch the header and close the file. Idempotent. @returns {number} Total file size in bytes. */
    close() {
      if (!closed) {
        closed = true;
        writeSync(fd, wavHeader({ dataBytes: data, sampleRate, channels }), 0, WAV_HEADER_BYTES, 0);
        closeSync(fd);
      }
      return WAV_HEADER_BYTES + data;
    },
    get bytes() { return WAV_HEADER_BYTES + data; },
    get full() { return full; },
  };
}

/**
 * Repair the header of a recording that was not closed cleanly (the data length is taken from the file size).
 * @param {string} path
 * @returns {number} Resulting file size, or -1 if the file is not a recognisable WAV.
 */
export function fixWavHeader(path) {
  const fd = openSync(path, 'r+');
  try {
    const head = Buffer.alloc(WAV_HEADER_BYTES);
    const n = readSync(fd, head, 0, WAV_HEADER_BYTES, 0);
    const info = n === WAV_HEADER_BYTES ? parseWavHeader(head) : null;
    if (!info) return -1;
    const frame = info.channels * (info.bits / 8);
    const size = fstatSync(fd).size;
    const dataBytes = Math.floor((size - WAV_HEADER_BYTES) / frame) * frame;
    if (WAV_HEADER_BYTES + dataBytes !== size) ftruncateSync(fd, WAV_HEADER_BYTES + dataBytes);
    writeSync(fd, wavHeader({ dataBytes, sampleRate: info.sampleRate, channels: info.channels, bits: info.bits }), 0, WAV_HEADER_BYTES, 0);
    return WAV_HEADER_BYTES + dataBytes;
  } finally {
    closeSync(fd);
  }
}

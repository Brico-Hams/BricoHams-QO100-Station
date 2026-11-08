// Decoder worker: runs FT8/FT4 slot decoding off the main thread so the PTT watchdog is never starved.
import { parentPort } from 'node:worker_threads';
import { decodeSlot } from './ft8-decode.js';
import { createHashTable } from './ft8-message.js';

const hashes = createHashTable();

parentPort.on('message', ({ id, mode, samples }) => {
  try {
    parentPort.postMessage({ id, results: decodeSlot(samples, { mode, hashes }) });
  } catch (err) {
    parentPort.postMessage({ id, error: String(err?.message ?? err) });
  }
});

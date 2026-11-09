// One CW trial: band-sim keyed-tone station with QSB fading and AWGN -> USB demodulation -> CW decoder.
import { createBandSim, cwStation, fitLength, usbDemod } from './band-sim.js';
import { prng } from '../fixtures/dsp.js';
import { createCwDecoder } from '../../src/modes/cw-decoder.js';

/**
 * Levenshtein distance.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const normalize = (s) => s.toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * Send `text` at `wpm` and decode it.
 * @param {{text?: string, wpm: number, snrDb: number, seed: number, fadeDepth?: number}} o QSB rate is drawn from 0.1-0.5 Hz.
 * @returns {{sent: string, received: string, errors: number, chars: number, fadeRateHz: number}}
 */
export function cwTrial({ text = 'CQ CQ DE EA4AAA K', wpm, snrDb, seed, fadeDepth = 0.3 }) {
  const rnd = prng(seed);
  const fadeRateHz = 0.1 + 0.4 * rnd();
  const offsetHz = 15_000 + Math.floor(rnd() * 20_000);
  const toneHz = 500 + Math.floor(rnd() * 400);
  const st = cwStation({ text, wpm, toneHz, offsetHz, snrDb, fade: { rateHz: fadeRateHz, depth: fadeDepth, phase: rnd() * 2 * Math.PI } });
  const sim = createBandSim({ seed, beacon: null, stations: [st] });
  const iq = sim.renderBlock(0, st.iq.length >> 1);
  const audio = fitLength(usbDemod(iq, { carrierHz: offsetHz }).audio12k, st.iq.length >> 4); // 96 kS/s interleaved -> 12 kS/s mono
  const dec = createCwDecoder({ sampleRate: 12_000 });
  let received = '';
  const feed = (r) => {
    for (const e of r ?? []) received += e.text;
  };
  const block = 1200;
  for (let i = 0; i < audio.length; i += block) feed(dec.decode(audio.subarray(i, Math.min(audio.length, i + block))));
  feed(dec.flush());
  const a = normalize(text);
  const b = normalize(received);
  return { sent: a, received: b, errors: editDistance(a, b), chars: a.length, fadeRateHz };
}

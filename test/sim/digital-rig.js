// One FT8/FT4 end-to-end trial: band-sim station -> 96 kS/s complex baseband + AWGN -> USB demodulation -> 12 kHz audio -> decoder.
import { createBandSim, digitalStation, fitLength, usbDemod, SAMPLE_RATE } from './band-sim.js';
import { prng } from '../fixtures/dsp.js';
import { PROTOCOLS } from '../../src/modes/ft8-constants.js';
import { decodeSlot } from '../../src/modes/ft8-decode.js';

const CALLS = ['EA4AAA', 'DL1ABC', 'G4XYZ', 'I2ABC', 'OE3XYZ', 'F5ABC', 'ON4ABC', 'HB9XYZ'];
const GRIDS = ['IN80', 'JO31', 'JN45', 'IO91', 'JN58', 'JO20'];

/**
 * Run one decode trial. Everything (message, audio frequency, timing, noise) derives from `seed`.
 * @param {{mode: 'FT8'|'FT4', snrDb: number|null, seed: number}} o `snrDb: null` renders a noise-only slot.
 * @returns {{sent: string|null, decoded: boolean, texts: string[], snrReported: number|null}}
 */
export function digitalTrial({ mode, snrDb, seed }) {
  const rnd = prng(seed);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const sent = snrDb === null ? null : rnd() < 0.5 ? `CQ ${pick(CALLS)} ${pick(GRIDS)}` : `${pick(CALLS)} ${pick(CALLS)} ${pick(GRIDS)}`;
  const audioHz = 800 + Math.floor(rnd() * 1700);
  const offsetHz = 10_000 + Math.floor(rnd() * 30_000);
  const startS = rnd() * 0.3;
  const stations = sent === null ? [] : [digitalStation({ text: sent, mode, audioHz, offsetHz, snrDb, startS })];
  const sim = createBandSim({ seed, beacon: null, stations });
  const slotSeconds = PROTOCOLS[mode].slotSeconds;
  const iq = sim.renderBlock(0, Math.round(slotSeconds * SAMPLE_RATE));
  const { audio12k } = usbDemod(iq, { carrierHz: offsetHz });
  const found = decodeSlot(fitLength(audio12k, Math.round(slotSeconds * 12_000)), { mode });
  const hit = sent === null ? null : found.find((f) => f.text === sent);
  return { sent, decoded: Boolean(hit), texts: found.map((f) => f.text), snrReported: hit?.snrDb ?? null };
}

import assert from 'node:assert/strict';
import { cwTrial } from './cw-rig.js';
import { record, simTest } from './metrics.js';

const WPMS = [10, 15, 20, 25, 30, 35];
const SNRS_DB = [0, 6, 12]; // in 2500 Hz; the decoder integrates in ~25 Hz bins so the effective tone-to-noise ratio is ~20 dB higher
const TRIALS = Number(process.env.SIM_CW_TRIALS) || 3;
// Design requirement: CER < 5 % at 20 WPM with moderate SNR (6 dB in 2500 Hz) under 0.1-0.5 Hz QSB (3.1 dB deep).
const MAX_CER_20WPM = 0.05;

simTest('cw', 'CW decoder: character error rate vs speed with QSB and AWGN', () => {
  const table = [];
  for (const wpm of WPMS) {
    for (const snrDb of SNRS_DB) {
      let errors = 0;
      let chars = 0;
      let example = '';
      for (let i = 0; i < TRIALS; i++) {
        const r = cwTrial({ wpm, snrDb, seed: 31_000 + wpm * 100 + (snrDb + 10) * 10 + i });
        errors += r.errors;
        chars += r.chars;
        example = r.received;
      }
      table.push({ wpm, snrDb, trials: TRIALS, chars, errors, cer: errors / chars, example });
    }
  }
  record('cw', 'cer', table);
  const point = table.find((p) => p.wpm === 20 && p.snrDb === 6);
  assert.ok(point.cer < MAX_CER_20WPM, `CER at 20 WPM / 6 dB = ${(100 * point.cer).toFixed(1)} % (decoded "${point.example}")`);
});

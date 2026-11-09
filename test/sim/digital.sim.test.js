import assert from 'node:assert/strict';
import { digitalTrial } from './digital-rig.js';
import { record, simTest } from './metrics.js';

// Decode rate vs SNR (2500 Hz reference bandwidth), -24..0 dB in 2 dB steps. Trials per point are kept low to bound the
// runtime (a FT8 trial costs ~2-4 s); the two asserted operating points get more trials for a meaningful 90 % bound.
const TRIALS = Number(process.env.SIM_TRIALS) || 2;
const ASSERT_TRIALS = Number(process.env.SIM_ASSERT_TRIALS) || 10;
const BASE_LEVELS = Array.from({ length: 13 }, (_, i) => -24 + 2 * i);

// Thresholds required by the design: >= 90 % at -15 dB (FT8) and -12 dB (FT4). They sit near the sensitivity limit of a
// decoder written for this repo, so if they fail the measured curve in docs/testing/sim-report.md is the evidence to adjust them.
const MIN_RATE = { FT8: { snrDb: -15, rate: 0.9 }, FT4: { snrDb: -12, rate: 0.9 } };

// Single source of truth: the swept points always include the asserted threshold (-15 dB is off the 2 dB grid) and 0 dB.
function levelsFor(mode) {
  return [...new Set([...BASE_LEVELS, MIN_RATE[mode].snrDb, 0])].sort((a, b) => a - b);
}

function pointAt(table, mode, snrDb) {
  const point = table.find((p) => Math.abs(p.snrDb - snrDb) < 1e-9);
  assert.ok(point, `${mode}: SNR point ${snrDb} dB was not sampled (swept: ${table.map((p) => p.snrDb).join(', ')})`);
  return point;
}

function sweep(mode) {
  const table = [];
  for (const snrDb of levelsFor(mode)) {
    const asserted = MIN_RATE[mode].snrDb === snrDb;
    const trials = asserted ? Math.max(TRIALS, ASSERT_TRIALS) : TRIALS;
    let ok = 0;
    let falseDecodes = 0;
    for (let i = 0; i < trials; i++) {
      const r = digitalTrial({ mode, snrDb, seed: 9000 + (mode === 'FT8' ? 0 : 500) + (snrDb + 40) * 20 + i });
      if (r.decoded) ok++;
      falseDecodes += r.texts.filter((t) => t !== r.sent).length;
    }
    table.push({ snrDb, trials, decoded: ok, rate: ok / trials, falseDecodes });
  }
  return table;
}

for (const mode of ['FT8', 'FT4']) {
  simTest('digital', `${mode}: decode rate vs SNR through band-sim and USB demodulation`, () => {
    const table = sweep(mode);
    record('digital', mode, table);
    const { snrDb, rate } = MIN_RATE[mode];
    const point = pointAt(table, mode, snrDb);
    assert.ok(point.rate >= rate, `${mode} at ${snrDb} dB: ${point.decoded}/${point.trials}`);
    assert.ok(pointAt(table, mode, 0).rate === 1, `${mode} must decode every slot at 0 dB`);
    // An FT message is protected by a CRC-14: wrong text appearing means the demodulator corrupted the audio.
    assert.ok(table.reduce((s, p) => s + p.falseDecodes, 0) <= 1, `${mode}: too many wrong decodes`);
  });
}

simTest('digital', 'noise-only slots decode nothing', () => {
  let decodes = 0;
  for (let i = 0; i < 2; i++) decodes += digitalTrial({ mode: 'FT8', snrDb: null, seed: 777 + i }).texts.length;
  record('digital', 'noiseOnlyDecodes', decodes);
  assert.equal(decodes, 0);
});

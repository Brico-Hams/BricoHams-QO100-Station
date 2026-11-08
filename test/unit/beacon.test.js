import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBeaconController, createBeaconFilter, estimateBeaconOffset } from '../../src/beacon/index.js';

const N = 1024;
const BIN = 100; // Hz
const CENTER = 739_750_000;

/** Deterministic pseudo-noise so tests are repeatable. */
function rng(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Spectrum in dB with a Gaussian-in-dB (exactly parabolic) beacon at `peakHz`. */
function spectrum({ peakHz = null, noiseDb = -90, peakDb = -50, sigmaBins = 2, seed = 1, center = CENTER } = {}) {
  const r = rng(seed);
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let v = noiseDb + (r() - 0.5) * 2;
    if (peakHz !== null) {
      const x = (center + (i - N / 2) * BIN - peakHz) / BIN;
      v = Math.max(v, peakDb - 0.5 * (x / sigmaBins) ** 2 * 6);
    }
    out[i] = v;
  }
  return { powersDb: out, centerHz: center, binHz: BIN };
}

const est = (frame, extra = {}) => estimateBeaconOffset({ ...frame, expectedHz: CENTER, ...extra });

test('beacon exactly on a bin gives zero offset', () => {
  const r = est(spectrum({ peakHz: CENTER }));
  assert.equal(r.found, true);
  assert.ok(Math.abs(r.offsetHz) < 0.5, `offset ${r.offsetHz}`);
  assert.ok(r.snrDb > 30);
});

test('beacon between bins is interpolated to sub-bin accuracy', () => {
  for (const off of [-3000, -437.5, 12.3, 49, 1234.5, 4999]) {
    const r = est(spectrum({ peakHz: CENTER + off }));
    assert.equal(r.found, true);
    assert.ok(Math.abs(r.offsetHz - off) < 5, `wanted ${off}, got ${r.offsetHz}`);
  }
});

test('noise only, weak beacon and out-of-window beacon are not found', () => {
  assert.deepEqual(est(spectrum()), { found: false, reason: 'low_snr' });
  assert.equal(est(spectrum({ peakHz: CENTER + 200, peakDb: -85 })).found, false);
  const far = est(spectrum({ peakHz: CENTER + 50_000 }));
  assert.equal(far.found, false, 'a strong signal outside the search window must not be taken for the beacon');
  assert.equal(est(spectrum({ peakHz: CENTER }), { searchHz: 1000 }).found, true);
});

test('bad input and spans that do not contain the beacon are reported', () => {
  assert.equal(est({ powersDb: [1, 2], centerHz: CENTER, binHz: BIN }).reason, 'bad_input');
  assert.equal(est(spectrum(), { searchHz: 1000 }).found, false);
  assert.equal(estimateBeaconOffset({ ...spectrum(), centerHz: 100e6, expectedHz: CENTER }).reason, 'outside_span');
  const nan = spectrum({ peakHz: CENTER });
  nan.powersDb[N / 2 + 3] = NaN;
  assert.equal(est(nan).reason, 'bad_input');
});

test('filter: lock needs consecutive hits, unlock needs consecutive misses, outliers are rejected', () => {
  const f = createBeaconFilter({ medianSize: 5, alpha: 0.5, lockCount: 3, unlockCount: 3 });
  assert.equal(f.update(100).status, 'no-lock');
  assert.equal(f.update(100).status, 'no-lock');
  const locked = f.update(100);
  assert.deepEqual(locked, { status: 'locked', offsetHz: 100 });
  assert.equal(f.update(5000).offsetHz, 100, 'single outlier removed by the median');
  assert.equal(f.update(null).status, 'locked');
  assert.equal(f.update(null).status, 'locked');
  assert.equal(f.update(100).status, 'locked', 'a hit resets the miss counter');
  f.update(null);
  f.update(null);
  assert.deepEqual(f.update(null), { status: 'no-lock', offsetHz: null });
  assert.equal(f.update(100).status, 'no-lock', 'must re-acquire from scratch');
});

function fakeStation() {
  const calls = [];
  return { calls, setCorrection: async (hz, source) => { calls.push({ hz, source }); } };
}

test('controller applies no correction without lock', async () => {
  const station = fakeStation();
  const events = [];
  const c = createBeaconController({
    getSpectrum: async () => spectrum(),
    station,
    onStatus: (s) => events.push(s.status),
    lnbLoHz: 9_750_000_000,
  });
  for (let i = 0; i < 10; i++) await c.step();
  assert.equal(station.calls.length, 0);
  assert.equal(c.status().status, 'no-lock');
  assert.equal(c.status().reason, 'low_snr');
  assert.deepEqual(events, [], 'no change, no event');
});

test('controller tracks a drifting beacon and ignores jitter below the deadband', async () => {
  const station = fakeStation();
  let drift = 1000;
  const statuses = [];
  const c = createBeaconController({
    getSpectrum: async () => spectrum({ peakHz: CENTER + drift, seed: Math.floor(drift) }),
    station,
    onStatus: (s) => statuses.push(s.status),
    filter: { alpha: 0.6 },
  });
  for (let i = 0; i < 6; i++) await c.step();
  assert.equal(c.status().status, 'locked');
  assert.ok(Math.abs(station.calls.at(-1).hz - 1000) < 5);
  assert.equal(station.calls[0].source, 'beacon');
  const before = station.calls.length;
  for (let i = 0; i < 5; i++) await c.step();
  assert.equal(station.calls.length, before, 'stable beacon causes no writes');

  for (let i = 0; i < 40; i++) {
    drift += 25;
    await c.step();
  }
  assert.ok(Math.abs(c.status().appliedHz - drift) < 150, `applied ${c.status().appliedHz}, beacon at ${drift}`);
  assert.deepEqual(statuses.slice(0, 1), ['locked']);
});

test('controller keeps the last correction when the beacon disappears and reports no-lock', async () => {
  const station = fakeStation();
  let present = true;
  const c = createBeaconController({
    getSpectrum: async () => spectrum({ peakHz: present ? CENTER + 700 : null }),
    station,
    filter: { unlockCount: 3 },
  });
  for (let i = 0; i < 5; i++) await c.step();
  const applied = c.status().appliedHz;
  present = false;
  for (let i = 0; i < 4; i++) await c.step();
  assert.equal(c.status().status, 'no-lock');
  assert.equal(c.status().appliedHz, applied);
  assert.equal(station.calls.at(-1).hz > 600, true);
  const writes = station.calls.length;
  await c.step();
  assert.equal(station.calls.length, writes);
});

test('controller survives a failing spectrum source and a failing station', async () => {
  const errors = [];
  const logger = { error: (...a) => errors.push(a.join(' ')) };
  const c1 = createBeaconController({ getSpectrum: async () => { throw new Error('boom'); }, station: fakeStation(), logger });
  assert.equal((await c1.step()).reason, 'no_data');
  const c2 = createBeaconController({
    getSpectrum: async () => spectrum({ peakHz: CENTER + 500 }),
    station: { setCorrection: async () => { throw new Error('sdr down'); } },
    logger,
  });
  for (let i = 0; i < 4; i++) await c2.step();
  assert.equal(c2.status().reason, 'apply_failed');
  assert.equal(c2.status().appliedHz, 0);
  assert.ok(errors.length >= 2);
});

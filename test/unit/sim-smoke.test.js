import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEACON_IF_HZ, SAMPLE_RATE, createBandSim, fftFrame, usbDemod } from '../sim/band-sim.js';
import { createBeaconRig } from '../sim/beacon-rig.js';
import { digitalTrial } from '../sim/digital-rig.js';
import { parseSpectrumFrame } from '../../src/webrtc/spectrum.js';

test('band-sim is deterministic and its spectrum frame parses with the beacon at the centre', () => {
  const render = () => createBandSim({ seed: 5 }).renderBlock(0, 4096);
  const a = render();
  assert.deepEqual(a, render());
  assert.equal(a.length, 2 * 4096);

  const f = parseSpectrumFrame(fftFrame(a, { centerHz: BEACON_IF_HZ, averages: 1 }));
  assert.equal(f.centerHz, BEACON_IF_HZ);
  let peak = 0;
  for (let i = 1; i < f.powersDb.length; i++) if (f.powersDb[i] > f.powersDb[peak]) peak = i;
  assert.ok(Math.abs((peak - f.powersDb.length / 2) * f.binHz) < 1000, 'beacon peak near the centre');

  const { audio12k } = usbDemod(a, { carrierHz: 0 });
  assert.ok(Math.abs(audio12k.length - (4096 / SAMPLE_RATE) * 12_000) <= 2, `12 kHz audio length ${audio12k.length}`);
});

test('FT8 decodes end to end at high SNR', () => {
  const r = digitalTrial({ mode: 'FT8', snrDb: 0, seed: 42 });
  assert.equal(r.decoded, true, `sent "${r.sent}", decoded ${JSON.stringify(r.texts)}`);
});

test('beacon tracking locks within 20 s of simulated time', async () => {
  const rig = await createBeaconRig({ seed: 3, drift: { ppm: 0, rampHzPerHour: 1800, walkHzPerRootS: 0.05 } });
  try {
    let last;
    for (let t = 0; t < 20; t += 2) last = await rig.step(t);
    assert.equal(last.status, 'locked');
    assert.ok(Math.abs(last.errHz) < 100, `residual ${last.errHz} Hz`);
  } finally {
    await rig.stop();
  }
});

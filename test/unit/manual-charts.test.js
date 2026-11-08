import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  erfc, qfunc, berPsk, berQam, shannonSpectralEfficiency, cpOverhead, raisedCosine, renderAll,
} from '../../docs/manual/figures/generate-charts.mjs';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test('erfc and Q match reference values', () => {
  near(erfc(0), 1, 1e-12);
  near(erfc(1), 0.157299207050285, 1e-12);
  near(qfunc(0), 0.5, 1e-12);
  near(qfunc(3) / 1.3498980316301e-3, 1, 1e-6);
});

test('BPSK BER at 9.6 dB is about 1e-5 and QAM needs more Eb/N0', () => {
  const b = berPsk(9.6);
  assert.ok(b > 5e-6 && b < 2e-5, `BER ${b}`);
  assert.ok(berQam(16, 10) > berPsk(10));
  assert.ok(berQam(64, 10) > berQam(16, 10));
  near(berQam(4, 7) / berPsk(7), 1, 1e-9);
});

test('Shannon efficiency is 1 bit/s/Hz at 0 dB and grows about 3.32 bit per 10 dB', () => {
  near(shannonSpectralEfficiency(0), 1, 1e-12);
  near(shannonSpectralEfficiency(30) - shannonSpectralEfficiency(20), Math.log2(1001 / 101), 1e-9); // tends to 3.32 bit per 10 dB only asymptotically
});

test('cyclic prefix of 16 on N = 64 costs 20 %', () => {
  near(cpOverhead(64, 16), 0.2, 1e-12);
  assert.throws(() => cpOverhead(0, 4), RangeError);
});

test('raised cosine is 1 in the passband, 0.5 at the Nyquist edge and 0 outside', () => {
  for (const a of [0, 0.25, 0.5, 0.75, 1]) near(raisedCosine(0.5, a), 0.5, 1e-12);
  near(raisedCosine(0, 0.5), 1, 1e-12);
  near(raisedCosine(0.2, 0.25), 1, 1e-12);
  near(raisedCosine(1.01, 1), 0, 1e-12);
});

test('rendered charts are accessible, branded and draw their curves', () => {
  const files = renderAll();
  assert.equal(Object.keys(files).length, 4);
  for (const [name, svg] of Object.entries(files)) {
    assert.match(svg, /viewBox=/, name);
    assert.match(svg, /<title[^>]*>[^<]+<\/title>/, name);
    assert.match(svg, /<desc[^>]*>[^<]+<\/desc>/, name);
    assert.match(svg, /BricoHams/, name);
  }
  const rc = files['fig-26-coseno-alzado.svg'];
  assert.equal((rc.match(/<polyline/g) ?? []).length, 5);
  assert.ok(!/NaN|Infinity/.test(Object.values(files).join('')));
});

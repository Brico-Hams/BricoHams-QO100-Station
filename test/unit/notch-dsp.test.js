import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../../src/web/public/notch-dsp.js', import.meta.url), 'utf8');
const ctx = {};
vm.runInNewContext(src, ctx);
const { createBiquadNotch, createLmsNotch } = ctx.BHNotch;
const FS = 12000;

function lcg(seed) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
}

const tone = (hz, n, amp = 0.5) => Float64Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / FS));
const power = (x, from) => {
  let p = 0;
  for (let i = from; i < x.length; i++) p += x[i] * x[i];
  return p / (x.length - from);
};
const db = (a, b) => 10 * Math.log10(a / b);
// Power at one frequency (Goertzel) so the test measures the tone, not the noise around it.
function bin(x, hz, from) {
  const w = (2 * Math.PI * hz) / FS;
  let re = 0;
  let im = 0;
  for (let i = from; i < x.length; i++) {
    re += x[i] * Math.cos(w * i);
    im -= x[i] * Math.sin(w * i);
  }
  return (re * re + im * im) / (x.length - from) ** 2;
}

test('biquad notch attenuates the tone by more than 30 dB', () => {
  const f = createBiquadNotch(FS, 1500, 50);
  const x = tone(1500, 12000);
  const y = x.map((v) => f.process(v));
  assert.ok(db(power(x, 8000), power(y, 8000)) > 30);
});

test('biquad notch passes a tone 1 kHz away', () => {
  const f = createBiquadNotch(FS, 1500, 50);
  const x = tone(2500, 12000);
  const y = x.map((v) => f.process(v));
  assert.ok(Math.abs(db(power(x, 8000), power(y, 8000))) < 1);
});

test('LMS line enhancer removes a steady tone from tone plus noise', () => {
  const rnd = lcg(7);
  const n = 48000;
  const noise = Float64Array.from({ length: n }, () => 0.05 * rnd());
  const x = tone(1000, n).map((v, i) => v + noise[i]);
  const f = createLmsNotch();
  const y = x.map((v) => f.process(v));
  const from = 36000;
  assert.ok(db(bin(x, 1000, from), bin(y, 1000, from)) >= 20);
  const ratio = power(y, from) / power(noise, from);
  assert.ok(ratio > 0.5 && ratio < 2, `noise power ratio ${ratio}`);
});

test('BHNotch is frozen', () => {
  assert.ok(Object.isFrozen(ctx.BHNotch));
});

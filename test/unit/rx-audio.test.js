import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Resampler } from '../../src/webrtc/resample.js';
import { createRxAudio } from '../../src/webrtc/rx-audio.js';
import { FrameKind, decodeAudioFrame } from '../../src/webrtc/frames.js';

const sine = (n, freq, rate, amp) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));
const rms = (a, from = 0) => Math.sqrt(a.slice(from).reduce((s, v) => s + v * v, 0) / (a.length - from));
const datagram = (samples) => Buffer.from(Int16Array.from(samples, Math.round).buffer);

test('48k to 12k resampling keeps an in-band sine accurate', () => {
  const out = new Resampler(48_000, 12_000).process(sine(48_000, 1000, 48_000, 10_000));
  assert.ok(Math.abs(out.length - 12_000) <= 20, `length ${out.length}`);
  const ref = sine(12_000, 1000, 12_000, 10_000);
  let maxErr = 0;
  for (let i = 100; i < 11_900; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - ref[i]));
  assert.ok(maxErr < 100, `max error ${maxErr} (1% of amplitude)`);
});

test('tones above the output Nyquist frequency are attenuated, not aliased', () => {
  const out = new Resampler(48_000, 12_000).process(sine(48_000, 10_000, 48_000, 10_000));
  assert.ok(rms(out, 100) < 0.03 * (10_000 / Math.SQRT2), `residual rms ${rms(out, 100)}`);
});

test('the output does not depend on how the input is chunked', () => {
  const input = sine(9600, 700, 48_000, 8000);
  const whole = new Resampler(48_000, 12_000).process(input);
  const r = new Resampler(48_000, 12_000);
  const parts = [];
  for (let i = 0; i < input.length; i += 97) parts.push(...r.process(input.subarray(i, i + 97)));
  assert.equal(parts.length, whole.length);
  for (let i = 0; i < whole.length; i++) assert.ok(Math.abs(parts[i] - whole[i]) < 1e-2);
});

test('upsampling 12k to 48k reproduces a sine', () => {
  const out = new Resampler(12_000, 48_000).process(sine(2400, 1000, 12_000, 10_000));
  const ref = sine(9600, 1000, 48_000, 10_000);
  let maxErr = 0;
  for (let i = 200; i < out.length - 200; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - ref[i]));
  assert.ok(maxErr < 100, `max error ${maxErr}`);
});

function fakeListener(bufferedAmount = 0, readyState = 1) {
  const frames = [];
  return { readyState, bufferedAmount, send: (data) => frames.push(data), frames };
}

test('RX frames carry sequence and sample rate; slow or closed listeners drop frames without blocking', () => {
  const rx = createRxAudio({});
  const fast = fakeListener();
  const slow = fakeListener(10_000_000);
  const closed = fakeListener(0, 3);
  for (const l of [fast, slow, closed]) rx.addListener(l);

  for (let i = 0; i < 6; i++) rx.ingest(datagram(sine(960, 1000, 48_000, 8000)));
  assert.ok(fast.frames.length >= 4, `fast got ${fast.frames.length}`);
  assert.equal(slow.frames.length, 0);
  assert.equal(closed.frames.length, 0);

  const [a, b] = fast.frames.map((f) => decodeAudioFrame(f, FrameKind.RX_AUDIO));
  assert.equal(a.sampleRate, 12_000);
  assert.equal(a.samples.length, 240);
  assert.equal(b.seq, (a.seq + 1) & 0xffff);
  const stats = rx.stats();
  assert.equal(stats.dropped, 2 * stats.frames);
  assert.equal(stats.sent, fast.frames.length);
});

test('malformed datagrams are counted and ignored; no listeners means no work', () => {
  const rx = createRxAudio({});
  rx.ingest(Buffer.alloc(3));
  rx.ingest(Buffer.alloc(0));
  assert.equal(rx.stats().badDatagrams, 2);
  rx.ingest(datagram(sine(960, 1000, 48_000, 8000)));
  assert.equal(rx.stats().frames, 0);
});

test('unsubscribing stops delivery', () => {
  const rx = createRxAudio({});
  const l = fakeListener();
  const off = rx.addListener(l);
  for (let i = 0; i < 3; i++) rx.ingest(datagram(sine(960, 1000, 48_000, 8000)));
  const before = l.frames.length;
  off();
  for (let i = 0; i < 3; i++) rx.ingest(datagram(sine(960, 1000, 48_000, 8000)));
  assert.equal(l.frames.length, before);
});

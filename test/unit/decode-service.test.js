import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecodeService } from '../../src/modes/decode-service.js';
import { createDecoderRegistry, createDefaultDecoderRegistry } from '../../src/modes/decoders.js';
import { createRxAudio } from '../../src/webrtc/rx-audio.js';

test('rx-audio taps receive 12 kHz frames even with no WebSocket listener', () => {
  const rx = createRxAudio({ logger: { error() {} } });
  const frames = [];
  const off = rx.addTap((f) => frames.push(f));
  const dgram = Buffer.alloc(9600);
  for (let i = 0; i < 4800; i++) dgram.writeInt16LE(Math.round(8000 * Math.sin(i * 0.1)), i * 2);
  rx.ingest(dgram);
  assert.ok(frames.length >= 3);
  assert.ok(frames.every((f) => f instanceof Int16Array && f.length === 240));
  off();
  const before = frames.length;
  rx.ingest(dgram);
  assert.equal(frames.length, before);
});

test('decode service publishes decodes with the fields the log form needs', () => {
  let tap;
  const published = [];
  const decoder = {
    mode: 'FT8',
    available: true,
    decode: () => [{ text: 'CQ EA4AAA IN80', type: 'standard', snrDb: -3, dtSec: 0.1, freqHz: 1500, slotStartMs: 15_000 }],
  };
  const registry = createDecoderRegistry();
  registry.register(decoder);
  const svc = createDecodeService({
    rxAudio: { addTap: (fn) => { tap = fn; return () => { tap = null; }; } },
    station: { status: () => ({ mode: 'FT8' }) },
    decoders: registry,
    publish: (m) => published.push(m),
    now: () => 20_000,
    logger: { error() {} },
  });
  tap(new Int16Array(240));
  assert.equal(published.length, 1);
  assert.equal(published[0].type, 'decode');
  assert.equal(published[0].mode, 'FT8');
  assert.equal(published[0].slotStartMs, 15_000);
  assert.equal(published[0].messages[0].from, 'EA4AAA');
  assert.equal(published[0].messages[0].grid, 'IN80');
  svc.stop();
  assert.equal(tap, null);
});

test('decode service ignores USB and unavailable decoders and survives decoder errors', () => {
  let tap;
  let mode = 'USB';
  const published = [];
  const errors = [];
  const registry = createDecoderRegistry();
  registry.register({ mode: 'CW', available: true, decode: () => { throw new Error('boom'); } });
  createDecodeService({
    rxAudio: { addTap: (fn) => { tap = fn; return () => {}; } },
    station: { status: () => ({ mode }) },
    decoders: registry,
    publish: (m) => published.push(m),
    logger: { error: (...a) => errors.push(a.join(' ')) },
  });
  tap(new Int16Array(240));
  mode = 'FT4';
  tap(new Int16Array(240));
  mode = 'CW';
  tap(new Int16Array(240));
  assert.equal(published.length, 0);
  assert.equal(errors.length, 1);
});

test('default registry has real decoders for CW, FT8 and FT4', async () => {
  const reg = createDefaultDecoderRegistry();
  for (const m of ['CW', 'FT8', 'FT4']) assert.equal(reg.get(m).available, true, m);
  assert.equal(reg.get('RTTY').available, false);
  await reg.close();
});

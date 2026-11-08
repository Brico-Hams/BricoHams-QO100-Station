import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTxAudio } from '../../src/webrtc/tx-audio.js';
import { FrameKind, encodeAudioFrame } from '../../src/webrtc/frames.js';

class FakePtt extends EventEmitter {
  state = 'TX_OFF';
  holderId = null;

  set(state, holderId) {
    this.state = state;
    this.holderId = holderId;
    this.emit('state', { state });
  }
}

function setup(opts = {}) {
  const ptt = new FakePtt();
  const sink = { writes: [], resets: 0, write(pcm, rate) { this.writes.push({ pcm, rate }); }, reset() { this.resets++; } };
  const tx = createTxAudio({ ptt, sink, ...opts });
  return { ptt, sink, tx };
}

const mic = (samples, rate = 12_000, kind = FrameKind.MIC) => encodeAudioFrame(kind, 0, rate, Int16Array.from(samples));
const tone = (n, amp = 6000) => Array.from({ length: n }, (_, i) => Math.round(amp * Math.sin(i / 5)));

test('frames are dropped without the turn or outside TX_ON, and counted', () => {
  const { ptt, sink, tx } = setup();
  assert.deepEqual(tx.handleFrame('a', mic(tone(240))), { ok: false, reason: 'no_turn' });
  ptt.set('ARMED', 'a');
  assert.deepEqual(tx.handleFrame('a', mic(tone(240))), { ok: false, reason: 'not_tx' });
  ptt.set('TX_ON', 'a');
  assert.deepEqual(tx.handleFrame('b', mic(tone(240))), { ok: false, reason: 'no_turn' });
  assert.equal(sink.writes.length, 0);
  assert.deepEqual([tx.stats().droppedNoTurn, tx.stats().droppedNotTx, tx.stats().accepted], [2, 1, 0]);
});

test('the holder in TX_ON is forwarded; same-rate audio passes through untouched', () => {
  const { ptt, sink, tx } = setup();
  ptt.set('TX_ON', 'a');
  const samples = tone(480, 4000);
  assert.deepEqual(tx.handleFrame('a', mic(samples, 48_000)), { ok: true });
  assert.equal(sink.writes.length, 1);
  assert.equal(sink.writes[0].rate, 48_000);
  assert.deepEqual([...sink.writes[0].pcm], samples);
});

test('12 kHz microphone audio is upsampled to the sink rate', () => {
  const { ptt, sink, tx } = setup();
  ptt.set('TX_ON', 'a');
  for (let i = 0; i < 5; i++) tx.handleFrame('a', mic(tone(240)));
  const total = sink.writes.reduce((n, w) => n + w.pcm.length, 0);
  assert.ok(total > 4 * 240 * 4 - 200 && total <= 4 * 5 * 240, `forwarded ${total} samples`);
  assert.ok(sink.writes.every((w) => w.rate === 48_000));
});

test('forwarding stops with the first frame after PTT release or a watchdog cut', () => {
  const { ptt, sink, tx } = setup();
  ptt.set('TX_ON', 'a');
  assert.equal(tx.handleFrame('a', mic(tone(240))).ok, true);
  const n = sink.writes.length;
  ptt.set('ARMED', 'a'); // key up
  assert.equal(tx.handleFrame('a', mic(tone(240))).reason, 'not_tx');
  assert.ok(sink.resets >= 1, 'sink is told to drop buffered audio');
  ptt.set('TX_ON', 'a');
  assert.equal(tx.handleFrame('a', mic(tone(240))).ok, true);
  ptt.set('TX_OFF', null); // watchdog / TOT
  assert.equal(tx.handleFrame('a', mic(tone(240))).reason, 'no_turn');
  assert.equal(sink.writes.length, n + 1);
});

test('the limiter never lets a sample above the ceiling through', () => {
  const { ptt, sink, tx } = setup({ ceiling: 0.5 });
  ptt.set('TX_ON', 'a');
  const hot = Array.from({ length: 480 }, (_, i) => (i % 2 ? 32767 : -32768));
  tx.handleFrame('a', mic(hot, 48_000));
  const quiet = tone(480, 1000);
  tx.handleFrame('a', mic(quiet, 48_000));
  const limit = Math.floor(32767 * 0.5);
  const all = sink.writes.flatMap((w) => [...w.pcm]);
  assert.ok(all.every((v) => Math.abs(v) <= limit), 'clamped');
  assert.ok(tx.stats().limitedSamples > 0);
  assert.ok(Math.max(...sink.writes[1].pcm.map(Math.abs)) <= 1000, 'quiet audio is not amplified');
});

test('a hot 12 kHz microphone is also kept under the ceiling after resampling', () => {
  const { ptt, sink, tx } = setup();
  ptt.set('TX_ON', 'a');
  for (let i = 0; i < 4; i++) tx.handleFrame('a', mic(Array.from({ length: 240 }, (_, j) => (j % 3 ? 32767 : -32768))));
  const limit = Math.floor(32767 * 0.8);
  assert.ok(sink.writes.every((w) => [...w.pcm].every((v) => Math.abs(v) <= limit)));
});

test('invalid frames are rejected: sample rate, size, kind, truncated', () => {
  const { ptt, sink, tx } = setup();
  ptt.set('TX_ON', 'a');
  assert.equal(tx.handleFrame('a', mic(tone(240), 44_100)).reason, 'invalid');
  assert.equal(tx.handleFrame('a', mic(tone(1300), 12_000)).reason, 'invalid');
  assert.equal(tx.handleFrame('a', mic(tone(240), 12_000, FrameKind.RX_AUDIO)).reason, 'invalid');
  assert.equal(tx.handleFrame('a', mic(tone(240)).subarray(0, 9)).reason, 'invalid');
  assert.equal(tx.handleFrame('a', Buffer.alloc(4)).reason, 'invalid');
  assert.equal(sink.writes.length, 0);
  assert.equal(tx.stats().droppedInvalid, 5);
});

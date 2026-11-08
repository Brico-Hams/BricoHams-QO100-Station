import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOLS } from '../../src/modes/ft8-constants.js';
import { encodeMessage, synthSlot } from '../../src/modes/ft8-encode.js';
import { decodeSlot } from '../../src/modes/ft8-decode.js';
import { addCrc, bpDecode, computeCrc, encode174, extractCrc, ldpcCheck } from '../../src/modes/ft8-ldpc.js';
import { describeMessage, packMessage, unpackMessage } from '../../src/modes/ft8-message.js';
import { createInlineExecutor, createSlotDecoder, createWorkerExecutor } from '../../src/modes/slot-decoder.js';
import { utcSlot } from '../../src/modes/decoders.js';
import { addAwgn, prng, sigmaForSnr } from '../fixtures/dsp.js';

const MESSAGES = [
  'CQ EA4AAA IN80',
  'CQ DX EA4AAA IN80',
  'EA4AAA EA4BBB -10',
  'EA4BBB EA4AAA R-05',
  'EA4AAA EA4BBB RR73',
  'EA4AAA EA4BBB 73',
  'EA4AAA EA4BBB JN18',
  'EA4AAA EA4BBB/R IN80',
  'TNX 73 GL',
];

test('message pack/unpack round-trips standard and free-text messages', () => {
  for (const text of MESSAGES) {
    const payload = packMessage(text);
    assert.equal(payload.length, 10);
    assert.equal(payload[9] & 0x07, 0);
    const back = unpackMessage(payload);
    assert.equal(back?.text, text, text);
  }
  assert.equal(unpackMessage(packMessage('TNX 73 GL')).type, 'free');
  assert.throws(() => packMessage('THIS FREE TEXT IS FAR TOO LONG'));
});

test('describeMessage extracts call, grid and report', () => {
  assert.deepEqual(describeMessage('CQ EA4AAA IN80'), { cq: true, to: null, from: 'EA4AAA', grid: 'IN80', report: null });
  assert.deepEqual(describeMessage('EA4AAA EA4BBB R-05'), { cq: false, to: 'EA4AAA', from: 'EA4BBB', grid: null, report: '-05' });
  assert.equal(describeMessage('EA4AAA EA4BBB RR73').grid, null);
});

test('CRC-14 is stored with the message and detects single-bit errors', () => {
  const payload = packMessage('CQ EA4AAA IN80');
  const a91 = addCrc(payload);
  const stored = extractCrc(a91);
  const masked = Uint8Array.from(a91);
  masked[9] &= 0xf8;
  masked[10] = 0;
  assert.equal(computeCrc(masked, 82), stored);
  const other = Uint8Array.from(payload);
  other[3] ^= 0x10;
  assert.notEqual(extractCrc(addCrc(other)), stored);
  assert.ok(stored > 0 && stored < 1 << 14);
});

test('LDPC(174,91): encoded words satisfy all parity checks and BP corrects flipped bits', () => {
  const rnd = prng(5);
  for (const text of ['CQ EA4AAA IN80', 'EA4BBB EA4AAA R-05']) {
    const bits = encode174(addCrc(packMessage(text)));
    assert.equal(bits.length, 174);
    assert.equal(ldpcCheck(bits), 0);
    const llr = new Float32Array(174);
    for (let i = 0; i < 174; i++) llr[i] = bits[i] ? 4 : -4;
    const flipped = new Set();
    while (flipped.size < 14) flipped.add(Math.floor(rnd() * 174));
    for (const i of flipped) llr[i] = bits[i] ? -1 : 1;
    const { plain, errors } = bpDecode(llr, 25);
    assert.equal(errors, 0);
    assert.deepEqual([...plain], [...bits]);
    const bad = Uint8Array.from(bits);
    bad[7] ^= 1;
    assert.ok(ldpcCheck(bad) > 0);
  }
});

test('encoded symbol sequences carry the Costas sync arrays', () => {
  const ft8 = encodeMessage('CQ EA4AAA IN80', 'FT8');
  assert.equal(ft8.length, 79);
  for (const start of [0, 36, 72]) assert.deepEqual([...ft8.slice(start, start + 7)], [3, 1, 4, 0, 6, 5, 2]);
  const ft4 = encodeMessage('CQ EA4AAA IN80', 'FT4');
  assert.equal(ft4.length, 105);
  assert.deepEqual([...ft4.slice(1, 5)], [0, 1, 3, 2]);
  assert.deepEqual([...ft4.slice(34, 38)], [1, 0, 2, 3]);
  assert.deepEqual([...ft4.slice(67, 71)], [2, 3, 1, 0]);
  assert.deepEqual([...ft4.slice(100, 104)], [3, 2, 0, 1]);
});

function noisySlot(mode, signals, snrDb, seed, amp = 0.1) {
  const len = Math.round(PROTOCOLS[mode].slotSeconds * 12000);
  const mix = new Float32Array(len);
  for (const [text, freqHz] of signals) {
    const s = synthSlot(text, mode, { freqHz, amplitude: amp });
    for (let i = 0; i < len; i++) mix[i] += s[i];
  }
  return addAwgn(mix, sigmaForSnr(amp, snrDb), seed);
}

test('FT8 end to end: "CQ EA4AAA IN80" at 1500 Hz, -10 dB SNR', () => {
  const out = decodeSlot(noisySlot('FT8', [['CQ EA4AAA IN80', 1500]], -10, 11), { mode: 'FT8' });
  assert.deepEqual(out.map((m) => m.text), ['CQ EA4AAA IN80']);
  assert.ok(Math.abs(out[0].freqHz - 1500) <= 4, `freq ${out[0].freqHz}`);
  assert.ok(Math.abs(out[0].dtSec) <= 0.5, `dt ${out[0].dtSec}`);
  assert.ok(out[0].snrDb < 5 && out[0].snrDb > -25, `snr ${out[0].snrDb}`);
});

test('FT8 decodes two simultaneous signals', () => {
  const out = decodeSlot(noisySlot('FT8', [['CQ EA4AAA IN80', 1000], ['EA4BBB EA4CCC -12', 2100]], -10, 12), { mode: 'FT8' });
  assert.deepEqual(out.map((m) => m.text).sort(), ['CQ EA4AAA IN80', 'EA4BBB EA4CCC -12']);
});

test('FT4 end to end in a 7.5 s slot, including two signals', () => {
  const one = decodeSlot(noisySlot('FT4', [['CQ EA4AAA IN80', 1500]], -10, 13), { mode: 'FT4' });
  assert.deepEqual(one.map((m) => m.text), ['CQ EA4AAA IN80']);
  assert.ok(Math.abs(one[0].freqHz - 1500) <= 8, `freq ${one[0].freqHz}`);
  const two = decodeSlot(noisySlot('FT4', [['CQ EA4AAA IN80', 900], ['EA4BBB EA4CCC RR73', 2000]], -10, 14), { mode: 'FT4' });
  assert.deepEqual(two.map((m) => m.text).sort(), ['CQ EA4AAA IN80', 'EA4BBB EA4CCC RR73']);
});

test('noise alone decodes nothing', () => {
  const noise = addAwgn(new Float32Array(180_000), 0.3, 21);
  assert.deepEqual(decodeSlot(noise, { mode: 'FT8' }), []);
});

test('slot decoder buffers frames of a UTC slot and decodes before the slot ends', () => {
  const dec = createSlotDecoder({ mode: 'FT8', executor: createInlineExecutor() });
  const slotStart = utcSlot('FT8', 1_700_000_010_000);
  const pcm = Int16Array.from(noisySlot('FT8', [['CQ EA4AAA IN80', 1500]], -10, 15, 0.05), (v) => Math.round(v * 32768));
  let found = [];
  for (let i = 0; i + 240 <= pcm.length; i += 240) {
    const nowMs = slotStart.startMs + ((i + 240) / 12000) * 1000;
    const r = dec.decode(pcm.subarray(i, i + 240), slotStart, nowMs);
    assert.ok(Array.isArray(r));
    found = found.concat(r);
  }
  assert.deepEqual(found.map((m) => m.text), ['CQ EA4AAA IN80']);
  assert.equal(found[0].slotStartMs, slotStart.startMs);
  assert.deepEqual(dec.flush(), []);
});

test('worker executor decodes off the main thread', async () => {
  const ex = createWorkerExecutor();
  try {
    const out = await ex.run('FT8', noisySlot('FT8', [['EA4AAA EA4BBB -10', 1200]], -10, 16));
    assert.deepEqual(out.map((m) => m.text), ['EA4AAA EA4BBB -10']);
  } finally {
    await ex.close();
  }
});

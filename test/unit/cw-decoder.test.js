import test from 'node:test';
import assert from 'node:assert/strict';
import { MORSE, createCwDecoder } from '../../src/modes/cw-decoder.js';
import { addAwgn } from '../fixtures/dsp.js';

const SR = 12000;
const CODE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

function keyCw(text, wpm, { freq = 700, amp = 0.3, lead = 0.5, tail = 1.0 } = {}) {
  const dot = 1.2 / wpm;
  const on = [];
  const words = text.split(' ');
  let t = lead;
  for (let w = 0; w < words.length; w++) {
    if (w > 0) t += 7 * dot;
    const chars = [...words[w]];
    for (let c = 0; c < chars.length; c++) {
      if (c > 0) t += 3 * dot;
      const code = CODE[chars[c]];
      for (let e = 0; e < code.length; e++) {
        if (e > 0) t += dot;
        const len = code[e] === '.' ? dot : 3 * dot;
        on.push([t, t + len]);
        t += len;
      }
    }
  }
  const x = new Float32Array(Math.round((t + tail) * SR));
  const ramp = 0.005;
  for (const [a, b] of on) {
    for (let i = Math.floor(a * SR); i < Math.min(x.length, Math.ceil(b * SR)); i++) {
      const s = i / SR;
      const env = Math.min(1, (s - a) / ramp, (b - s) / ramp);
      if (env > 0) x[i] = amp * env * Math.sin(2 * Math.PI * freq * s);
    }
  }
  return x;
}

function run(samples, decoder = createCwDecoder()) {
  const pcm = Int16Array.from(samples, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32768))));
  let text = '';
  let wpm = 0;
  for (let i = 0; i < pcm.length; i += 240) {
    for (const c of decoder.decode(pcm.subarray(i, i + 240))) { text += c.text; wpm = c.wpm; }
  }
  for (const c of decoder.flush()) { text += c.text; wpm = c.wpm; }
  return { text, wpm, decoder };
}

for (const wpm of [12, 20, 30]) {
  test(`CW decoder reads "CQ CQ DE EA4AAA K" at ${wpm} WPM with noise`, () => {
    const x = addAwgn(keyCw('CQ CQ DE EA4AAA K', wpm), 0.05, 100 + wpm);
    const r = run(x);
    assert.equal(r.text, 'CQ CQ DE EA4AAA K');
    assert.ok(Math.abs(r.wpm - wpm) <= 3, `wpm estimate ${r.wpm}`);
    assert.ok(Math.abs(r.decoder.info().freqHz - 700) <= 25);
  });
}

test('CW decoder finds the tone anywhere in 300-1200 Hz and decodes punctuation', () => {
  const x = addAwgn(keyCw('TEST 73 DE EA4AAA/P?', 18, { freq: 1050 }), 0.03, 7);
  assert.equal(run(x).text, 'TEST 73 DE EA4AAA/P?');
});

test('CW decoder emits nothing for noise alone and prosigns are in the table', () => {
  const noise = addAwgn(new Float32Array(SR * 5), 0.1, 3);
  assert.equal(run(noise).text, '');
  assert.equal(MORSE['.-.-.'], '<AR>');
  assert.equal(MORSE['...-.-'], '<SK>');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import {
  SpectrumSource, createSpectrumFeed, downsampleSpectrum, parseSpectrumFrame,
} from '../../src/webrtc/spectrum.js';
import { decodeSpectrumFrame } from '../../src/webrtc/frames.js';
import { estimateBeaconOffset } from '../../src/beacon/index.js';
import { buildSpectrumFrame } from '../fixtures/spectrum-frame.js';

test('parses the fixture frame into centre, bin width and dB power', () => {
  const f = parseSpectrumFrame(buildSpectrumFrame());
  assert.equal(f.centerHz, 739_750_000);
  assert.equal(f.binHz, 100);
  assert.equal(f.power.length, 1024);
  assert.equal(f.power[600], -50);
  assert.equal(f.power[0], -90);
  assert.equal(f.powersDb, f.power);
});

test('linear power frames are converted to dB', () => {
  const f = parseSpectrumFrame(buildSpectrumFrame({ linear: true }));
  assert.ok(Math.abs(f.power[600] - -50) < 0.01);
  assert.ok(Math.abs(f.power[10] - -90) < 0.01);
});

test('malformed frames are rejected', () => {
  const good = buildSpectrumFrame();
  assert.equal(parseSpectrumFrame(good.subarray(0, 100)), null);
  assert.equal(parseSpectrumFrame(good.subarray(0, good.length - 4)), null);
  assert.equal(parseSpectrumFrame(buildSpectrumFrame({ n: 1000 })), null, 'FFT size must be a power of two');
  assert.equal(parseSpectrumFrame(buildSpectrumFrame({ sampleRate: 0 })), null);
  assert.equal(parseSpectrumFrame(buildSpectrumFrame({ ssb: true })), null, 'ssb half-spectrum frames are not supported');
  assert.equal(parseSpectrumFrame(Buffer.alloc(0)), null);
});

test('a parsed frame feeds the beacon estimator directly', () => {
  const f = parseSpectrumFrame(buildSpectrumFrame());
  const expectedHz = f.centerHz + (600 - 512) * f.binHz;
  const est = estimateBeaconOffset({ ...f, expectedHz });
  assert.equal(est.found, true);
  assert.ok(Math.abs(est.offsetHz) < 1);
});

test('downsampling keeps narrow peaks and the requested size', () => {
  const f = parseSpectrumFrame(buildSpectrumFrame());
  const d = downsampleSpectrum(f.power, 256);
  assert.equal(d.length, 256);
  assert.equal(d[150], -50);
  assert.equal(d[0], -90);
  assert.equal(downsampleSpectrum(f.power, 2048).length, 1024);
});

test('browser feed is limited to 10 fps, quantised and skips slow clients', () => {
  const source = new EventEmitter();
  let t = 1000;
  const feed = createSpectrumFeed({ source, bins: 512, maxFps: 10, now: () => t });
  const ok = { readyState: 1, bufferedAmount: 0, sent: [], send(d) { this.sent.push(d); } };
  const slow = { readyState: 1, bufferedAmount: 1e7, sent: [], send(d) { this.sent.push(d); } };
  feed.addListener(ok);
  feed.addListener(slow);
  const frame = parseSpectrumFrame(buildSpectrumFrame());
  for (let i = 0; i < 50; i++) {
    t += 10; // 100 fps source for 0.5 s
    source.emit('frame', frame);
  }
  assert.ok(ok.sent.length >= 4 && ok.sent.length <= 6, `sent ${ok.sent.length}`);
  assert.equal(slow.sent.length, 0);
  const line = decodeSpectrumFrame(ok.sent[0]);
  assert.equal(line.powerDb.length, 512);
  assert.equal(line.binHz, 200);
  assert.equal(line.centerHz, 739_750_000);
  assert.equal(line.powerDb[300], -50);
});

test('SpectrumSource reads frames from a WebSocket server and serves the latest', async () => {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => wss.once('listening', resolve));
  wss.on('connection', (ws) => {
    ws.send('ignored text frame');
    ws.send(Buffer.from('garbage'), { binary: true });
    ws.send(buildSpectrumFrame(), { binary: true });
  });
  const source = new SpectrumSource({ url: `ws://127.0.0.1:${wss.address().port}`, logger: { error() {} } });
  try {
    assert.equal(await source.getSpectrum(), null, 'nothing before the first frame');
    const frame = new Promise((resolve) => source.once('frame', resolve));
    source.start();
    await frame;
    const s = await source.getSpectrum();
    assert.equal(s.centerHz, 739_750_000);
    assert.equal(s.binHz, 100);
    assert.equal(s.powersDb.length, 1024);
  } finally {
    source.stop();
    for (const c of wss.clients) c.terminate();
    await new Promise((resolve) => wss.close(resolve));
  }
});

test('stale frames are not served to the beacon', async () => {
  let now = 0;
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => wss.once('listening', resolve));
  wss.on('connection', (ws) => ws.send(buildSpectrumFrame(), { binary: true }));
  const live = new SpectrumSource({ url: `ws://127.0.0.1:${wss.address().port}`, now: () => now, maxAgeMs: 1000, logger: { error() {} } });
  try {
    const got = new Promise((resolve) => live.once('frame', resolve));
    live.start();
    await got;
    assert.ok(await live.getSpectrum());
    now += 1500;
    assert.equal(await live.getSpectrum(), null);
  } finally {
    live.stop();
    for (const c of wss.clients) c.terminate();
    await new Promise((resolve) => wss.close(resolve));
  }
});

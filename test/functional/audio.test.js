import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../../src/server/app.js';
import { validateConfig } from '../../src/server/config.js';
import { createFileAudit } from '../../src/ptt/audit.js';
import { createRxAudio } from '../../src/webrtc/rx-audio.js';
import { FrameKind, decodeAudioFrame, decodeSpectrumFrame, encodeAudioFrame } from '../../src/webrtc/frames.js';
import { parseSpectrumFrame } from '../../src/webrtc/spectrum.js';
import { createFakeOidc } from '../fixtures/fake-oidc.js';
import { FakeDriver, silentLogger } from '../fixtures/fakes.js';
import { buildSpectrumFrame } from '../fixtures/spectrum-frame.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'bricohams-audio-'));
  const config = validateConfig({
    port: 0,
    google: { clientId: 'client-id' },
    allowlist: [
      { email: 'op@example.org', callsign: 'EA4AAA', role: 'operator' },
      { email: 'ear@example.org', callsign: 'EA4LIS', role: 'listener' },
      { email: 'owner@example.org', callsign: 'EA4OWN', role: 'owner' },
    ],
    tx: { enabled: true, totSeconds: 60, heartbeatTimeoutMs: 400 },
    auditLogPath: join(dir, 'audit.log'),
  }, { GOOGLE_CLIENT_SECRET: 'test-secret' });
  const oidc = createFakeOidc();
  const driver = new FakeDriver();
  const sink = { writes: [], resets: 0, write(pcm, rate) { this.writes.push({ n: pcm.length, rate }); }, reset() { this.resets++; } };
  const rxAudio = createRxAudio({ host: '127.0.0.1', port: 0 });
  const rxPort = (await rxAudio.start()).port;
  const spectrum = Object.assign(new EventEmitter(), { getSpectrum: async () => null });
  const app = createApp(config, {
    oidc, driver, logger: silentLogger, txSink: sink, rxAudio, spectrum, beaconAutoStart: false,
    audit: createFileAudit({ path: config.auditLogPath }),
  });
  const { url } = await app.listen();
  return { app, oidc, driver, sink, rxAudio, rxPort, spectrum, base: url };
}

async function cookieFor(ctx, email) {
  const r1 = await fetch(`${ctx.base}/auth/login`, { redirect: 'manual' });
  const { code, state } = ctx.oidc.issueCode(r1.headers.get('location'), { email });
  const loginCookie = r1.headers.getSetCookie().find((c) => c.startsWith('bh_login=')).split(';')[0];
  const r2 = await fetch(`${ctx.base}/auth/callback?code=${code}&state=${state}`, { headers: { cookie: loginCookie } });
  return r2.headers.getSetCookie().find((c) => c.startsWith('bh_session=')).split(';')[0];
}

class Client {
  texts = [];
  binaries = [];

  constructor(ctx, cookie) {
    this.ws = new WebSocket(`${ctx.base.replace('http', 'ws')}/ws/control`, { headers: { Cookie: cookie, Origin: ctx.base } });
    this.ws.on('message', (d, isBinary) => (isBinary ? this.binaries.push(d) : this.texts.push(JSON.parse(d.toString()))));
    this.opened = new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); });
  }

  send(msg) { this.ws.send(JSON.stringify(msg)); }

  mic(samples = 240, rate = 12_000) {
    const pcm = Int16Array.from({ length: samples }, (_, i) => Math.round(5000 * Math.sin(i / 4)));
    this.ws.send(encodeAudioFrame(FrameKind.MIC, 0, rate, pcm), { binary: true });
  }

  async waitFor(pred, from = 0) {
    for (let i = 0; i < 300; i++) {
      if (this.texts.slice(from).some(pred)) return;
      await sleep(10);
    }
    throw new Error(`timeout: ${JSON.stringify(this.texts)}`);
  }

  close() { this.ws.terminate(); }
}

async function withApp(fn) {
  const ctx = await start();
  const clients = [];
  ctx.client = async (email) => {
    const c = new Client(ctx, await cookieFor(ctx, email));
    clients.push(c);
    await c.opened;
    return c;
  };
  try {
    await fn(ctx);
  } finally {
    clients.forEach((c) => c.close());
    await ctx.app.close();
    await ctx.rxAudio.stop();
  }
}

async function keyDown(c) {
  c.send({ type: 'turn' });
  await c.waitFor((m) => m.type === 'state' && m.state === 'ARMED');
  c.send({ type: 'ptt', down: true });
  await c.waitFor((m) => m.type === 'state' && m.state === 'TX_ON');
}

test('mic audio from the turn holder in TX_ON reaches the sink; listeners and other states cannot', () => withApp(async (ctx) => {
  const op = await ctx.client('op@example.org');
  const ear = await ctx.client('ear@example.org');
  await op.waitFor((m) => m.type === 'caps' && m.txAudio === true);

  op.send({ type: 'turn' });
  await op.waitFor((m) => m.type === 'state' && m.state === 'ARMED');
  const hb = setInterval(() => op.send({ type: 'heartbeat' }), 100);
  try {
    op.mic();
    await sleep(80);
    assert.equal(ctx.sink.writes.length, 0, 'ARMED is not enough');

    op.send({ type: 'ptt', down: true });
    await op.waitFor((m) => m.type === 'state' && m.state === 'TX_ON');
    for (let i = 0; i < 5; i++) op.mic();
    for (let i = 0; i < 100 && ctx.sink.writes.length < 3; i++) await sleep(10);
    assert.ok(ctx.sink.writes.length >= 3, 'operator audio forwarded');
    assert.ok(ctx.sink.writes.every((w) => w.rate === 48_000));

    const before = ctx.sink.writes.length;
    for (let i = 0; i < 5; i++) ear.mic();
    await sleep(100);
    assert.equal(ctx.sink.writes.length, before, 'listener audio is dropped');
    assert.ok(ctx.app.txAudio.stats().droppedNoTurn >= 5);

    const mark = op.texts.length;
    op.send({ type: 'ptt', down: false });
    await op.waitFor((m) => m.type === 'state' && m.state === 'ARMED', mark);
    const afterRelease = ctx.sink.writes.length;
    for (let i = 0; i < 5; i++) op.mic();
    await sleep(100);
    assert.equal(ctx.sink.writes.length, afterRelease, 'nothing forwarded after PTT release');
  } finally {
    clearInterval(hb);
  }
}));

test('losing the heartbeat cuts TX and stops audio forwarding', () => withApp(async (ctx) => {
  const op = await ctx.client('op@example.org');
  await keyDown(op);
  op.send({ type: 'heartbeat' });
  op.mic();
  for (let i = 0; i < 100 && ctx.sink.writes.length < 1; i++) await sleep(10);
  assert.ok(ctx.sink.writes.length >= 1);

  // No heartbeats from here on: the watchdog must cut within the configured 400 ms.
  const mark = op.texts.length; // ignore the TX_OFF sent before keying
  await op.waitFor((m) => m.type === 'state' && m.state === 'TX_OFF', mark);
  assert.equal(ctx.driver.last.on, false);
  const n = ctx.sink.writes.length;
  op.mic();
  op.mic();
  await sleep(100);
  assert.equal(ctx.sink.writes.length, n);
  assert.ok(ctx.sink.resets >= 1);
}));

test('subscribed clients receive RX audio frames from UDP and spectrum lines', () => withApp(async (ctx) => {
  const ear = await ctx.client('ear@example.org');
  const other = await ctx.client('op@example.org'); // never subscribes
  ear.send({ type: 'subscribe', rxAudio: true, spectrum: true });

  const udp = dgram.createSocket('udp4');
  const datagram = Buffer.from(Int16Array.from({ length: 960 }, (_, i) => Math.round(6000 * Math.sin(i / 3))).buffer);
  const frame = parseSpectrumFrame(buildSpectrumFrame());
  try {
    for (let i = 0; i < 200 && !(ear.binaries.some((b) => b[0] === FrameKind.RX_AUDIO) && ear.binaries.some((b) => b[0] === FrameKind.SPECTRUM)); i++) {
      udp.send(datagram, ctx.rxPort, '127.0.0.1');
      ctx.spectrum.emit('frame', frame);
      await sleep(20);
    }
  } finally {
    udp.close();
  }
  const audio = decodeAudioFrame(ear.binaries.find((b) => b[0] === FrameKind.RX_AUDIO), FrameKind.RX_AUDIO);
  assert.equal(audio.sampleRate, 12_000);
  assert.equal(audio.samples.length, 240);
  const line = decodeSpectrumFrame(ear.binaries.find((b) => b[0] === FrameKind.SPECTRUM));
  assert.equal(line.centerHz, 739_750_000);
  assert.equal(other.binaries.length, 0);

  ear.send({ type: 'subscribe', rxAudio: 'yes' });
  await ear.waitFor((m) => m.type === 'error' && m.error === 'bad_message');
}));

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../../src/server/app.js';
import { validateConfig } from '../../src/server/config.js';
import { createFileAudit } from '../../src/ptt/audit.js';
import { createMockSdrangel } from '../../src/sdrangel/index.js';
import { createFakeOidc } from '../fixtures/fake-oidc.js';
import { silentLogger } from '../fixtures/fakes.js';

const BIN = 100;
const N = 1024;
const IF_CENTER = 739_750_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Synthetic IF spectrum (dB) with an optional beacon at IF_CENTER + offsetHz. */
function frame(offsetHz) {
  const powersDb = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const noise = -90 + ((i * 7919) % 100) / 50;
    const x = (i - N / 2) - (offsetHz ?? 1e9) / BIN;
    powersDb[i] = offsetHz === null ? noise : Math.max(noise, -50 - 0.5 * (x / 2) ** 2 * 6);
  }
  return { powersDb, centerHz: IF_CENTER, binHz: BIN };
}

async function start({ beaconOffset = null } = {}) {
  const mock = createMockSdrangel();
  const sdrUrl = await mock.start();
  const dir = mkdtempSync(join(tmpdir(), 'bricohams-station-'));
  const config = validateConfig({
    port: 0,
    google: { clientId: 'client-id' },
    allowlist: [
      { email: 'op@example.org', callsign: 'EA4AAA', role: 'operator' },
      { email: 'ear@example.org', callsign: 'EA4LIS', role: 'listener' },
    ].concat([{ email: 'owner@example.org', callsign: 'EA4OWN', role: 'owner' }]),
    tx: { enabled: true, totSeconds: 60, heartbeatTimeoutMs: 1000 },
    sdrangel: { baseUrl: sdrUrl },
    station: { applyCorrectionToTx: true }, // shared-reference setup, so TX correction is exercised
    auditLogPath: join(dir, 'audit.log'),
  }, { GOOGLE_CLIENT_SECRET: 'test-secret' });
  const oidc = createFakeOidc();
  const state = { offset: beaconOffset };
  const app = createApp(config, {
    oidc,
    logger: silentLogger,
    audit: createFileAudit({ path: config.auditLogPath }),
    spectrumSource: async () => frame(state.offset),
    beaconAutoStart: false,
  });
  const { url } = await app.listen();
  await app.whenProvisioned(); // startup provisioning must not consume faults injected by a test
  return { app, mock, oidc, base: url, state };
}

async function loggedIn(ctx, email) {
  const r1 = await fetch(`${ctx.base}/auth/login`, { redirect: 'manual' });
  const { code, state } = ctx.oidc.issueCode(r1.headers.get('location'), { email });
  const loginCookie = r1.headers.getSetCookie().find((c) => c.startsWith('bh_login=')).split(';')[0];
  const r2 = await fetch(`${ctx.base}/auth/callback?code=${code}&state=${state}`, { headers: { cookie: loginCookie } });
  const cookie = r2.headers.getSetCookie().find((c) => c.startsWith('bh_session=')).split(';')[0];
  const me = await (await fetch(`${ctx.base}/api/me`, { headers: { cookie } })).json();
  return {
    cookie,
    post: (path, body, csrf = me.csrfToken) => fetch(`${ctx.base}${path}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
      body: JSON.stringify(body),
    }),
    get: (path) => fetch(`${ctx.base}${path}`, { headers: { cookie } }),
  };
}

async function withApp(opts, fn) {
  const ctx = await start(opts);
  try {
    await fn(ctx);
  } finally {
    await ctx.app.close();
    await ctx.mock.stop();
  }
}

const rx = (ctx) => ctx.mock.state.deviceSets[0];
const tx = (ctx) => ctx.mock.state.deviceSets[1];

test('mode and tune are role- and CSRF-checked and reach SDRangel', () => withApp({}, async (ctx) => {
  const op = await loggedIn(ctx, 'op@example.org');
  const ear = await loggedIn(ctx, 'ear@example.org');
  assert.equal((await fetch(`${ctx.base}/api/status`)).status, 401);
  assert.equal((await ear.post('/api/mode', { mode: 'USB' })).status, 403);
  assert.equal((await op.post('/api/mode', { mode: 'USB' }, null)).status, 403, 'CSRF required');
  assert.equal((await op.post('/api/mode', { mode: 'AM' })).status, 400);
  assert.equal((await op.post('/api/tune', { downlinkHz: 'x' })).status, 400);
  assert.equal((await op.post('/api/tune', { downlinkHz: 10_500_000_000 })).status, 400);

  const m = await op.post('/api/mode', { mode: 'USB' });
  assert.equal(m.status, 200);
  const t = await op.post('/api/tune', { downlinkHz: 10_489_800_000 });
  assert.equal(t.status, 200);
  const st = await t.json();
  assert.equal(st.downlinkHz, 10_489_800_000);
  assert.equal(st.uplinkHz, 2_400_300_000);
  assert.equal(rx(ctx).channels[0].settings.inputFrequencyOffset, 50_000);
  assert.equal(tx(ctx).channels[0].settings.inputFrequencyOffset, 50_000);

  const status = await (await ear.get('/api/status')).json();
  assert.equal(status.station.mode, 'USB');
  assert.equal(status.beacon.status, 'no-lock');
  assert.equal(status.ptt.state, 'TX_OFF');
}));

test('SDRangel outage is reported as 502 without leaking details', () => withApp({}, async (ctx) => {
  const op = await loggedIn(ctx, 'op@example.org');
  ctx.mock.failNext(500);
  const r = await op.post('/api/mode', { mode: 'USB' });
  assert.equal(r.status, 502);
  assert.deepEqual(await r.json(), { error: 'sdrangel_unavailable', kind: 'http' });
}));

test('beacon drift is measured and applied to RX and TX through SDRangel', () => withApp({ beaconOffset: 800 }, async (ctx) => {
  const op = await loggedIn(ctx, 'op@example.org');
  await op.post('/api/mode', { mode: 'USB' });
  const ws = new WebSocket(`${ctx.base.replace('http', 'ws')}/ws/control`, { headers: { Cookie: op.cookie, Origin: ctx.base } });
  const messages = [];
  ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });

  for (let i = 0; i < 5; i++) await ctx.app.beacon.step();
  assert.ok(Math.abs(rx(ctx).settings.centerFrequency - (IF_CENTER + 800)) <= 2, `rx centre ${rx(ctx).settings.centerFrequency}`);
  assert.ok(Math.abs(tx(ctx).settings.centerFrequency - (2_400_250_000 - 800)) <= 2, `tx centre ${tx(ctx).settings.centerFrequency}`);

  const b = await (await op.get('/api/beacon')).json();
  assert.equal(b.status, 'locked');
  assert.ok(Math.abs(b.appliedHz - 800) <= 2);
  for (let i = 0; i < 100 && !messages.some((m) => m.type === 'beacon' && m.status === 'locked'); i++) await sleep(10);
  assert.ok(messages.some((m) => m.type === 'beacon' && m.status === 'locked'), 'WS broadcast of the beacon lock');
  ws.terminate();
}));

test('without a beacon no correction is written to SDRangel', () => withApp({ beaconOffset: null }, async (ctx) => {
  const op = await loggedIn(ctx, 'op@example.org');
  await op.post('/api/mode', { mode: 'USB' });
  const before = ctx.mock.calls.length;
  for (let i = 0; i < 8; i++) await ctx.app.beacon.step();
  assert.equal(ctx.mock.calls.length, before);
  assert.equal(ctx.app.beacon.status().status, 'no-lock');
  assert.equal(rx(ctx).settings.centerFrequency, IF_CENTER);
}));

test('PTT keys the SDRangel TX device set and the retune waits until unkeyed', () => withApp({ beaconOffset: 500 }, async (ctx) => {
  const op = await loggedIn(ctx, 'op@example.org');
  await op.post('/api/mode', { mode: 'USB' });
  const ws = new WebSocket(`${ctx.base.replace('http', 'ws')}/ws/control`, { headers: { Cookie: op.cookie, Origin: ctx.base } });
  const messages = [];
  ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const waitFor = async (pred, from = 0) => {
    for (let i = 0; i < 300; i++) {
      if (messages.slice(from).some(pred)) return;
      await sleep(10);
    }
    throw new Error(`timeout: ${JSON.stringify(messages)}`);
  };

  ws.send(JSON.stringify({ type: 'turn' }));
  await waitFor((m) => m.type === 'state' && m.state === 'ARMED');
  ws.send(JSON.stringify({ type: 'ptt', down: true }));
  await waitFor((m) => m.type === 'state' && m.state === 'TX_ON');
  assert.equal(tx(ctx).running, true);
  assert.equal(rx(ctx).running, true);

  for (let i = 0; i < 5; i++) {
    ws.send(JSON.stringify({ type: 'heartbeat' }));
    await ctx.app.beacon.step();
  }
  assert.ok(Math.abs(rx(ctx).settings.centerFrequency - (IF_CENTER + 500)) <= 2);
  assert.equal(tx(ctx).settings.centerFrequency, 2_400_250_000, 'TX not retuned while keyed');
  assert.equal(ctx.app.station.status().txRetunePending, true);

  const mode = await op.post('/api/mode', { mode: 'CW' });
  assert.equal(mode.status, 409, 'mode change refused while transmitting');

  const mark = messages.length;
  ws.send(JSON.stringify({ type: 'ptt', down: false }));
  await waitFor((m) => m.type === 'state' && m.state === 'ARMED', mark);
  for (let i = 0; i < 100 && (tx(ctx).running || ctx.app.station.status().txRetunePending); i++) await sleep(10);
  assert.equal(tx(ctx).running, false);
  assert.ok(Math.abs(tx(ctx).settings.centerFrequency - (2_400_250_000 - 500)) <= 2);
  ws.terminate();
}));

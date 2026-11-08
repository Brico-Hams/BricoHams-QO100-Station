import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/app.js';
import { validateConfig } from '../../src/server/config.js';
import { createFileAudit } from '../../src/ptt/audit.js';
import { createMockSdrangel } from '../../src/sdrangel/index.js';
import { openStationDb } from '../../src/modes/station-db.js';
import { createRecorder } from '../../src/webrtc/recorder.js';
import { createFakeOidc } from '../fixtures/fake-oidc.js';
import { silentLogger } from '../fixtures/fakes.js';

const settle = () => new Promise((r) => setImmediate(() => setImmediate(r)));

function fakeRxAudio() {
  const taps = new Set();
  return {
    addTap: (fn) => { taps.add(fn); return () => taps.delete(fn); },
    feed: (n) => { for (let i = 0; i < n; i++) for (const t of taps) t(new Int16Array(240).fill(i)); },
  };
}

async function start() {
  const mock = createMockSdrangel();
  const sdrUrl = await mock.start();
  const dir = mkdtempSync(join(tmpdir(), 'bricohams-adv-'));
  const config = validateConfig({
    port: 0,
    google: { clientId: 'client-id' },
    allowlist: [
      { email: 'op@example.org', callsign: 'EA4AAA', role: 'operator' },
      { email: 'op2@example.org', callsign: 'EA4BBB', role: 'operator' },
      { email: 'ear@example.org', callsign: 'EA4LIS', role: 'listener' },
      { email: 'owner@example.org', callsign: 'EA4OWN', role: 'owner' },
    ],
    tx: { enabled: true, totSeconds: 60, heartbeatTimeoutMs: 1000 },
    sdrangel: { baseUrl: sdrUrl },
    auditLogPath: join(dir, 'audit.log'),
  }, { GOOGLE_CLIENT_SECRET: 'test-secret' });
  const db = openStationDb(':memory:');
  const rxAudio = fakeRxAudio();
  const recorder = createRecorder({ db, rxAudio, dir: join(dir, 'rec'), maxFileMb: 1, maxUserMb: 5, logger: silentLogger });
  const oidc = createFakeOidc();
  const app = createApp(config, {
    oidc,
    logger: silentLogger,
    audit: createFileAudit({ path: config.auditLogPath }),
    spectrumSource: async () => ({ powersDb: new Float64Array(1024).fill(-90), centerHz: 739_750_000, binHz: 100 }),
    beaconAutoStart: false,
    stationDb: db,
    recorder,
  });
  const { url } = await app.listen();
  return { app, mock, oidc, base: url, rxAudio, recorder, dir };
}

async function loggedIn(ctx, email) {
  const r1 = await fetch(`${ctx.base}/auth/login`, { redirect: 'manual' });
  const { code, state } = ctx.oidc.issueCode(r1.headers.get('location'), { email });
  const loginCookie = r1.headers.getSetCookie().find((c) => c.startsWith('bh_login=')).split(';')[0];
  const r2 = await fetch(`${ctx.base}/auth/callback?code=${code}&state=${state}`, { headers: { cookie: loginCookie } });
  const cookie = r2.headers.getSetCookie().find((c) => c.startsWith('bh_session=')).split(';')[0];
  const me = await (await fetch(`${ctx.base}/api/me`, { headers: { cookie } })).json();
  const send = (method) => (path, body, csrf = me.csrfToken) => fetch(`${ctx.base}${path}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(csrf ? { 'x-csrf-token': csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { post: send('POST'), put: send('PUT'), del: send('DELETE'), get: (path) => fetch(`${ctx.base}${path}`, { headers: { cookie } }) };
}

async function withApp(fn) {
  const ctx = await start();
  try {
    await fn(ctx);
  } finally {
    await ctx.app.close();
    await ctx.mock.stop();
    rmSync(ctx.dir, { recursive: true, force: true });
  }
}

const MEM = { name: 'My net', downlinkHz: 10_489_650_000, mode: 'USB' };

test('memories: CRUD, validation, CSRF and role checks, per-user isolation', () => withApp(async (ctx) => {
  const op = await loggedIn(ctx, 'op@example.org');
  const op2 = await loggedIn(ctx, 'op2@example.org');
  const ear = await loggedIn(ctx, 'ear@example.org');
  const owner = await loggedIn(ctx, 'owner@example.org');

  assert.equal((await ear.post('/api/memories', MEM)).status, 403);
  assert.equal((await op.post('/api/memories', MEM, null)).status, 403);
  assert.equal((await op.post('/api/memories', { ...MEM, downlinkHz: 145_000_000 })).status, 400);
  assert.equal((await op.post('/api/memories', { ...MEM, mode: 'FM' })).status, 400);

  const created = await op.post('/api/memories', MEM);
  assert.equal(created.status, 201);
  const mem = await created.json();
  assert.equal((await op.post('/api/memories', { ...MEM, name: 'my NET' })).status, 409);

  const list = await (await op.get('/api/memories')).json();
  assert.equal(list.items.length, 1);
  assert.ok(list.presets.length >= 5);
  assert.equal((await (await ear.get('/api/memories')).json()).items.length, 0);
  assert.equal((await (await op2.get('/api/memories')).json()).items.length, 0);

  assert.equal((await op2.put(`/api/memories/${mem.id}`, { ...MEM, name: 'stolen' })).status, 404);
  assert.equal((await op2.del(`/api/memories/${mem.id}`)).status, 404);
  assert.equal((await op.put(`/api/memories/${mem.id}`, { ...MEM, name: 'Renamed' })).status, 200);

  assert.equal((await op.post('/api/memories', { ...MEM, name: 'Shared', shared: true })).status, 403);
  assert.equal((await owner.post('/api/memories', { ...MEM, name: 'Shared', shared: true })).status, 201);
  assert.equal((await (await ear.get('/api/memories')).json()).items.length, 1);

  assert.equal((await op.del(`/api/memories/${mem.id}`)).status, 200);
  assert.equal((await (await op.get('/api/memories')).json()).items.length, 1);
}));

test('memory recall tunes and sets the mode and filter', () => withApp(async (ctx) => {
  const op = await loggedIn(ctx, 'op@example.org');
  const mem = await (await op.post('/api/memories', { name: 'CW spot', downlinkHz: 10_489_550_000, mode: 'CW', filter: 'narrow' })).json();
  const r = await op.post(`/api/memories/${mem.id}/recall`, {});
  assert.equal(r.status, 200);
  const st = await r.json();
  assert.equal(st.mode, 'CW');
  assert.equal(st.downlinkHz, 10_489_550_000);
  assert.equal(st.filter.name, 'narrow');
  assert.equal((await op.post('/api/memories/99999/recall', {})).status, 404);
}));

test('rit, txlock, filter and rxdsp: validated and role-checked', () => withApp(async (ctx) => {
  const op = await loggedIn(ctx, 'op@example.org');
  const ear = await loggedIn(ctx, 'ear@example.org');
  await op.post('/api/mode', { mode: 'USB' });
  await op.post('/api/tune', { downlinkHz: 10_489_700_000 });

  for (const [path, body] of [['/api/rit', { ritHz: 100 }], ['/api/txlock', { locked: false }], ['/api/filter', { preset: 'wide' }], ['/api/rxdsp', { agc: 'fast' }]]) {
    assert.equal((await ear.post(path, body)).status, 403, path);
    assert.equal((await op.post(path, body, null)).status, 403, path);
  }

  const rit = await op.post('/api/rit', { ritHz: 300, xitHz: -200 });
  assert.equal(rit.status, 200);
  const st = await rit.json();
  assert.equal(st.ritHz, 300);
  assert.equal(st.xitHz, -200);
  assert.equal(st.rxHz, 10_489_700_300);
  assert.equal((await op.post('/api/rit', { ritHz: 'x' })).status, 400);
  assert.equal((await op.post('/api/rit', { ritHz: 1e9 })).status, 400);

  const split = await (await op.post('/api/txlock', { locked: false, txDownlinkHz: 10_489_750_000 })).json();
  assert.equal(split.txFollowsRx, false);
  assert.equal(split.txDownlinkHz, 10_489_750_000 - 200); // XIT (-200 Hz) still applies on top of the split dial
  assert.equal((await op.post('/api/txlock', { locked: 'no' })).status, 400);
  assert.equal((await op.post('/api/txlock', { locked: false, txDownlinkHz: 145_000_000 })).status, 400);
  assert.equal((await (await op.post('/api/txlock', { locked: true })).json()).txFollowsRx, true);

  assert.equal((await op.post('/api/filter', { preset: 'wide' })).status, 200);
  assert.equal((await op.post('/api/filter', { preset: 'bogus' })).status, 400);
  assert.equal((await op.post('/api/filter', {})).status, 400);

  const dsp = await (await op.post('/api/rxdsp', { agc: 'fast', squelchDb: -60 })).json();
  assert.deepEqual({ ...dsp.rxDsp }, { agc: 'fast', squelchDb: -60, noiseReduction: false });
  assert.equal((await op.post('/api/rxdsp', { noiseReduction: true })).status, 400, 'DNR is not available on the UDPSink path');
  assert.equal((await op.post('/api/rxdsp', { agc: 'turbo' })).status, 400);
  assert.equal((await op.post('/api/rxdsp', { squelchDb: 5 })).status, 400);
  assert.equal((await op.post('/api/rxdsp', {})).status, 400);
}));

test('bandplan is readable by any signed-in user but not anonymous', () => withApp(async (ctx) => {
  assert.equal((await fetch(`${ctx.base}/api/bandplan`)).status, 401);
  const ear = await loggedIn(ctx, 'ear@example.org');
  const r = await ear.get('/api/bandplan');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.agcModes));
  assert.ok(body.filters.USB);
}));

test('recordings: start, stop, list, download, delete, isolation and owner policy', () => withApp(async (ctx) => {
  const op = await loggedIn(ctx, 'op@example.org');
  const op2 = await loggedIn(ctx, 'op2@example.org');
  const ear = await loggedIn(ctx, 'ear@example.org');
  const owner = await loggedIn(ctx, 'owner@example.org');

  assert.equal((await ear.post('/api/recordings/start', {})).status, 403);
  const started = await op.post('/api/recordings/start', {});
  assert.equal(started.status, 201);
  ctx.rxAudio.feed(20);
  assert.equal((await op.post('/api/recordings/start', {})).status, 409);
  const stopped = await op.post('/api/recordings/stop', {});
  assert.equal(stopped.status, 200);
  await settle();

  const list = await (await op.get('/api/recordings')).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.policy.enabled, true);
  const id = list.items[0].id;

  const dl = await op.get(`/api/recordings/${id}.wav`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'audio/wav');
  const bytes = Buffer.from(await dl.arrayBuffer());
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.length, 44 + 20 * 240 * 2);

  assert.equal((await op2.get(`/api/recordings/${id}.wav`)).status, 404);
  assert.equal((await op2.del(`/api/recordings/${id}`)).status, 404);
  assert.equal((await ear.get(`/api/recordings/${id}.wav`)).status, 403);
  assert.equal((await (await op2.get('/api/recordings')).json()).items.length, 0);

  assert.equal((await op.put('/api/recordings/policy', { enabled: false })).status, 403);
  assert.equal((await owner.put('/api/recordings/policy', { enabled: 'x' })).status, 400);
  assert.equal((await owner.put('/api/recordings/policy', { enabled: false })).status, 200);
  const blocked = await op.post('/api/recordings/start', {});
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error, 'recording_disabled');
  await owner.put('/api/recordings/policy', { enabled: true });

  assert.equal((await op.del(`/api/recordings/${id}`)).status, 200);
  assert.equal((await (await op.get('/api/recordings')).json()).items.length, 0);
}));

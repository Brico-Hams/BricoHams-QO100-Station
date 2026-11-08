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
import { createFakeOidc } from '../fixtures/fake-oidc.js';
import { silentLogger } from '../fixtures/fakes.js';

async function start(extra = {}, deps = {}) {
  const mock = createMockSdrangel();
  const sdrUrl = await mock.start();
  const dir = mkdtempSync(join(tmpdir(), 'bricohams-p13-'));
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
    // keep every store in the temp dir: the defaults under ./data persist between runs and break duplicate checks
    logbook: { path: join(dir, 'logbook.db') },
    stationDbPath: join(dir, 'station.db'),
    ...extra,
    iq: { dir: join(dir, 'iq'), ...extra.iq },
  }, { GOOGLE_CLIENT_SECRET: 'test-secret', BRICOHAMS_WEBHOOK_SECRET_1: 'a'.repeat(32) });
  const oidc = createFakeOidc();
  const app = createApp(config, {
    oidc,
    logger: silentLogger,
    audit: createFileAudit({ path: config.auditLogPath }),
    spectrumSource: async () => ({ powersDb: new Float64Array(1024).fill(-90), centerHz: 739_750_000, binHz: 100 }),
    beaconAutoStart: false,
    stationDb: openStationDb(':memory:'),
    ...deps,
  });
  const { url } = await app.listen();
  return { app, mock, oidc, base: url, dir };
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

async function withApp(fn, extra, deps) {
  const ctx = await start(extra, deps);
  try {
    await fn(ctx);
  } finally {
    await ctx.app.close();
    await ctx.mock.stop();
    rmSync(ctx.dir, { recursive: true, force: true });
  }
}

test('notch: operator only, CSRF, validation, state in status', () => withApp(async (ctx) => {
  const op = await loggedIn(ctx, 'op@example.org');
  const ear = await loggedIn(ctx, 'ear@example.org');
  assert.equal((await ear.post('/api/notch', { enabled: true })).status, 403);
  assert.equal((await op.post('/api/notch', { enabled: true }, null)).status, 403);
  assert.equal((await op.post('/api/notch', { widthHz: -5 })).status, 400);
  const ok = await op.post('/api/notch', { enabled: true, offsetHz: 1000, widthHz: 80 });
  assert.equal(ok.status, 200);
  const st = (await (await op.get('/api/status')).json()).station;
  assert.equal(st.notch.enabled, true);
  assert.equal(st.notch.engine, 'client');
}));

test('memories import/export: round trip, dry run, listener cannot import', () => withApp(async (ctx) => {
  const op = await loggedIn(ctx, 'op@example.org');
  const ear = await loggedIn(ctx, 'ear@example.org');
  await op.post('/api/memories', { name: 'My net', downlinkHz: 10_489_650_000, mode: 'USB' });
  const json = await (await op.get('/api/memories/export?format=json')).text();
  assert.equal((await op.get('/api/memories/export?format=xml')).status, 400);
  const csv = await op.get('/api/memories/export?format=csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);

  assert.equal((await ear.post('/api/memories/import', { format: 'json', content: json })).status, 403);
  const op2 = await loggedIn(ctx, 'op2@example.org');
  const dry = await (await op2.post('/api/memories/import', { format: 'json', content: json, dryRun: true })).json();
  assert.equal(dry.imported, 1);
  assert.equal((await (await op2.get('/api/memories')).json()).items.length, 0);
  const real = await (await op2.post('/api/memories/import', { format: 'json', content: json })).json();
  assert.equal(real.imported, 1);
  assert.equal((await (await op2.get('/api/memories')).json()).items.length, 1);
  assert.equal((await op2.post('/api/memories/import', { format: 'json', content: 'nope' })).status, 400);
}));

test('cluster and calendar are off by default and role-checked', () => withApp(async (ctx) => {
  const op = await loggedIn(ctx, 'op@example.org');
  const ear = await loggedIn(ctx, 'ear@example.org');
  const owner = await loggedIn(ctx, 'owner@example.org');
  assert.equal((await ear.get('/api/spots')).status, 200);
  assert.equal((await ear.post('/api/spots', { dx: 'EA4AAA', downlinkHz: 10_489_700_000 })).status, 403);
  const posted = await op.post('/api/spots', { dx: 'EA4AAA', downlinkHz: 10_489_700_000 });
  assert.ok(posted.status >= 400);
  assert.equal((await op.post('/api/calendar/refresh', {})).status, 403);
  const refresh = await owner.post('/api/calendar/refresh', {});
  assert.ok(refresh.status >= 400);
  assert.equal((await ear.get('/api/calendar')).status, 200);
}));

test('plugins: only enabled names are listed and served', () => withApp(async (ctx) => {
  const ear = await loggedIn(ctx, 'ear@example.org');
  const list = await (await ear.get('/api/plugins')).json();
  assert.deepEqual(list.enabled, ['hello-panel']);
  assert.equal((await ear.get('/plugins/not-enabled/index.js')).status, 404);
  assert.equal((await ear.get('/plugins/..%2f..%2fpackage.json')).status, 404);
}, { plugins: { enabled: ['hello-panel'], dir: './plugins/examples' } }));

test('qso_logged webhook is signed and carries no secrets', async () => {
  const sent = [];
  const webhookFetch = async (url, init) => { sent.push({ url, init }); return { ok: true, status: 200 }; };
  await withApp(async (ctx) => {
    const op = await loggedIn(ctx, 'op@example.org');
    const r = await op.post('/api/log', { call: 'EA4ZZZ', mode: 'SSB', freq: 2400.25, freq_rx: 10489.75, rst_sent: '59', rst_rcvd: '59' });
    assert.ok(r.status < 300, `log status ${r.status}`);
    await new Promise((res) => setTimeout(res, 50));
    assert.ok(sent.length >= 1);
    const { init } = sent[0];
    const h = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
    assert.match(h['x-bricohams-signature'], /^sha256=[0-9a-f]{64}$/);
    assert.ok(!/secret|token|cookie|csrf/i.test(String(init.body)));
  }, { webhooks: { enabled: true, endpoints: [{ url: 'https://hooks.example.org/in', events: ['qso_logged'], secretEnv: 'BRICOHAMS_WEBHOOK_SECRET_1' }] } }, { webhookFetch });
});

test('I/Q: disabled by default; record, list, playback, live, delete when enabled', async () => {
  await withApp(async (ctx) => {
    const op = await loggedIn(ctx, 'op@example.org');
    assert.equal((await op.post('/api/iq/start', {})).status, 403);
  });
  await withApp(async (ctx) => {
    const op = await loggedIn(ctx, 'op@example.org');
    const ear = await loggedIn(ctx, 'ear@example.org');
    const owner = await loggedIn(ctx, 'owner@example.org');
    assert.equal((await ear.get('/api/iq')).status, 403);
    assert.equal((await op.post('/api/iq/start', {}, null)).status, 403);
    const started = await op.post('/api/iq/start', {});
    assert.equal(started.status, 201);
    const rec = await started.json();
    assert.equal((await op.post('/api/iq/start', {})).status, 409);
    assert.equal((await op.post('/api/iq/stop', {})).status, 200);
    const list = await (await op.get('/api/iq')).json();
    assert.equal(list.items.length, 1);
    assert.equal((await (await (await loggedIn(ctx, 'op2@example.org')).get('/api/iq')).json()).items.length, 0);
    assert.equal((await op.post(`/api/iq/${rec.id}/playback`, {})).status, 200);
    assert.equal((await op.post('/api/iq/live', {})).status, 200);
    assert.equal((await owner.put('/api/iq/policy', { enabled: false })).status, 200);
    assert.equal((await op.post('/api/iq/start', {})).status, 403);
    assert.equal((await op.del(`/api/iq/${rec.id}`)).status, 200);
  }, { iq: { enabled: true } });
});

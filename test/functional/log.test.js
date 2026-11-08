import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/server/app.js';
import { validateConfig } from '../../src/server/config.js';
import { createFileAudit } from '../../src/ptt/audit.js';
import { createFakeOidc } from '../fixtures/fake-oidc.js';
import { FakeDriver, silentLogger } from '../fixtures/fakes.js';

const QRZ_KEY = 'AAAA-BBBB-CCCC-DDDD';

async function start({ secretsKey = randomBytes(32).toString('base64'), lotw = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bricohams-log-'));
  const env = { GOOGLE_CLIENT_SECRET: 'test-secret' };
  if (secretsKey) env.BRICOHAMS_SECRETS_KEY = secretsKey;
  const config = validateConfig({
    port: 0,
    google: { clientId: 'client-id' },
    allowlist: [
      { email: 'owner@example.org', callsign: 'EA4OWN', role: 'owner' },
      { email: 'op1@example.org', callsign: 'EA4AAA', role: 'operator' },
      { email: 'op2@example.org', callsign: 'EA4BBB', role: 'operator' },
      { email: 'ear@example.org', callsign: 'EA4LIS', role: 'listener' },
    ],
    auditLogPath: join(dir, 'audit.log'),
    logbook: { path: ':memory:', ...(lotw ? { lotw: { tqslPath: 'tqsl', stationLocation: 'QO-100' } } : {}) },
  }, env);
  const oidc = createFakeOidc();
  const qrzCalls = [];
  const lotwCalls = [];
  const app = createApp(config, {
    oidc,
    driver: new FakeDriver(),
    logger: silentLogger,
    audit: createFileAudit({ path: config.auditLogPath }),
    qrzFetch: async (url, init) => {
      const form = new URLSearchParams(init.body);
      qrzCalls.push({ url, key: form.get('KEY'), adif: form.get('ADIF') });
      return new Response(form.get('KEY') === QRZ_KEY ? 'RESULT=OK&LOGID=777&COUNT=1' : 'RESULT=AUTH&REASON=invalid api key');
    },
    lotwUploader: lotw ? {
      upload: async (qsos) => {
        lotwCalls.push(qsos.map((q) => q.id));
        return { ok: true, status: 'uploaded', storeStatus: 'uploaded', message: 'Uploaded to LoTW.' };
      },
    } : undefined,
  });
  const { url } = await app.listen();
  return { app, oidc, base: url, qrzCalls, lotwCalls };
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
    headers: { cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { get: (path) => fetch(`${ctx.base}${path}`, { headers: { cookie } }), post: send('POST'), put: send('PUT'), del: send('DELETE') };
}

async function withApp(opts, fn) {
  const ctx = await start(opts);
  try {
    await fn(ctx);
  } finally {
    await ctx.app.close();
  }
}

const qso = (o = {}) => ({ call: 'DL1ABC', mode: 'SSB', freq: 2400.3, freq_rx: 10489.8, ...o });

test('operator logs a QSO, lists it and exports ADIF with the SAT fields', () => withApp({}, async (ctx) => {
  const op = await loggedIn(ctx, 'op1@example.org');
  const add = await op.post('/api/log', qso({ comment: 'Ñandú' }));
  assert.equal(add.status, 201);
  const q = await add.json();
  assert.equal(q.station_callsign, 'EA4AAA');
  assert.equal(q.created_by, 'op1@example.org');
  assert.equal(q.sat_name, 'QO-100');

  const list = await (await op.get('/api/log')).json();
  assert.equal(list.total, 1);
  assert.equal(list.items[0].call, 'DL1ABC');

  const exp = await op.get('/api/log/export.adi');
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-disposition'), /attachment; filename="bricohams-qo100\.adi"/);
  const text = await exp.text();
  for (const piece of ['<ADIF_VER:5>3.1.4', '<PROGRAMID:23>BricoHams-QO100-Station', '<PROP_MODE:3>SAT', '<SAT_NAME:6>QO-100',
    '<BAND:4>13CM', '<BAND_RX:3>3CM', '<FREQ:6>2400.3', '<FREQ_RX:7>10489.8', '<MODE:3>SSB', '<SUBMODE:3>USB', '<COMMENT:7>Ñandú', '<EOR>']) {
    assert.ok(text.includes(piece), `missing ${piece}`);
  }
}));

test('validation errors, duplicates, edit and delete with ownership', () => withApp({}, async (ctx) => {
  const op1 = await loggedIn(ctx, 'op1@example.org');
  const op2 = await loggedIn(ctx, 'op2@example.org');
  const owner = await loggedIn(ctx, 'owner@example.org');

  const bad = await op1.post('/api/log', qso({ call: 'nope', freq: 144 }));
  assert.equal(bad.status, 400);
  const body = await bad.json();
  assert.equal(body.error, 'validation');
  assert.equal(body.fields.call, 'invalid');
  assert.equal(body.fields.freq, 'out_of_range');
  assert.equal((await op1.post('/api/log', qso(), null)).status, 403, 'CSRF required');

  const first = await (await op1.post('/api/log', qso())).json();
  const dup = await op1.post('/api/log', qso());
  assert.equal(dup.status, 409);
  assert.deepEqual(await dup.json(), { error: 'duplicate', existingId: first.id });
  assert.equal((await op1.post('/api/log', qso({ force: true }))).status, 201);

  const edited = await op1.put(`/api/log/${first.id}`, { rst_rcvd: '57', force: true });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).rst_rcvd, '57');
  assert.equal((await op2.put(`/api/log/${first.id}`, { rst_rcvd: '55' })).status, 403);
  assert.equal((await op2.del(`/api/log/${first.id}`)).status, 403);
  assert.equal((await op1.put('/api/log/9999', { rst_rcvd: '55' })).status, 404);
  assert.equal((await owner.del(`/api/log/${first.id}`)).status, 200);
  assert.equal((await op1.get(`/api/log/${first.id}`)).status, 404);
}));

test('listeners and anonymous users are forbidden everywhere', () => withApp({}, async (ctx) => {
  const ear = await loggedIn(ctx, 'ear@example.org');
  const op = await loggedIn(ctx, 'op1@example.org');
  const q = await (await op.post('/api/log', qso())).json();
  for (const [method, path, body] of [
    ['get', '/api/log'], ['post', '/api/log', qso({ call: 'EA4XYZ' })], ['get', '/api/log/export.adi'], ['get', `/api/log/${q.id}`],
    ['put', `/api/log/${q.id}`, { comment: 'x' }], ['del', `/api/log/${q.id}`], ['post', '/api/log/lotw', { ids: [q.id] }],
    ['post', '/api/log/qrz', { ids: [q.id] }], ['put', '/api/log/qrz-key', { apiKey: QRZ_KEY }], ['get', '/api/log/qrz-key'],
  ]) {
    assert.equal((await ear[method](path, body)).status, 403, `${method} ${path}`);
  }
  assert.equal((await fetch(`${ctx.base}/api/log`)).status, 401);
  assert.equal((await op.get(`/api/log/${q.id}`)).status, 200, 'nothing was changed');
}));

test('the QRZ key is write-only, encrypted per user and used for uploads', () => withApp({}, async (ctx) => {
  const op1 = await loggedIn(ctx, 'op1@example.org');
  const op2 = await loggedIn(ctx, 'op2@example.org');
  const q = await (await op1.post('/api/log', qso())).json();

  const noKey = await op1.post('/api/log/qrz', { ids: [q.id] });
  assert.equal(noKey.status, 409);
  assert.equal((await noKey.json()).error, 'qrz_key_missing');
  assert.equal((await op1.put('/api/log/qrz-key', { apiKey: 'bad key!' })).status, 400);

  const set = await op1.put('/api/log/qrz-key', { apiKey: QRZ_KEY });
  assert.equal(set.status, 200);
  assert.deepEqual(await set.json(), { hasKey: true });
  assert.deepEqual(await (await op1.get('/api/log/qrz-key')).json(), { hasKey: true, canStore: true });
  assert.equal((await (await op2.get('/api/log/qrz-key')).json()).hasKey, false);

  const up = await op1.post('/api/log/qrz', { ids: [q.id] });
  assert.equal(up.status, 200);
  assert.deepEqual((await up.json()).results, [{ id: q.id, status: 'inserted', reason: null }]);
  assert.equal(ctx.qrzCalls[0].key, QRZ_KEY);
  assert.match(ctx.qrzCalls[0].adif, /<CALL:6>DL1ABC/);
  const stored = await (await op1.get(`/api/log/${q.id}`)).json();
  assert.deepEqual([stored.qrz_status, stored.qrz_logid], ['sent', '777']);
  assert.equal((await (await op1.post('/api/log/qrz', { ids: [q.id] })).json()).results[0].status, 'already_sent');
  assert.equal(ctx.qrzCalls.length, 1);

  const everything = [
    await (await op1.get('/api/log')).text(),
    await (await op1.get('/api/log/export.adi')).text(),
    await (await op1.get('/api/log/qrz-key')).text(),
  ].join('\n');
  assert.ok(!everything.includes(QRZ_KEY), 'key never returned');

  assert.equal((await op1.del('/api/log/qrz-key')).status, 200);
  assert.equal((await (await op1.get('/api/log/qrz-key')).json()).hasKey, false);
}));

test('QRZ key cannot be stored without BRICOHAMS_SECRETS_KEY', () => withApp({ secretsKey: null }, async (ctx) => {
  const op = await loggedIn(ctx, 'op1@example.org');
  const r = await op.put('/api/log/qrz-key', { apiKey: QRZ_KEY });
  assert.equal(r.status, 503);
  assert.deepEqual(await (await op.get('/api/log/qrz-key')).json(), { hasKey: false, canStore: false });
}));

test('LoTW upload marks the QSOs; unconfigured LoTW reports 503', async () => {
  await withApp({}, async (ctx) => {
    const op = await loggedIn(ctx, 'op1@example.org');
    const q = await (await op.post('/api/log', qso())).json();
    assert.equal((await op.post('/api/log/lotw', { ids: [] })).status, 400);
    assert.equal((await op.post('/api/log/lotw', { ids: [9999] })).status, 404);
    const r = await op.post('/api/log/lotw', { ids: [q.id] });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, status: 'uploaded', message: 'Uploaded to LoTW.', ids: [q.id] });
    assert.deepEqual(ctx.lotwCalls, [[q.id]]);
    assert.equal((await (await op.get(`/api/log/${q.id}`)).json()).lotw_status, 'uploaded');
  });
  await withApp({ lotw: false }, async (ctx) => {
    const op = await loggedIn(ctx, 'op1@example.org');
    const q = await (await op.post('/api/log', qso())).json();
    const r = await op.post('/api/log/lotw', { ids: [q.id] });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error, 'lotw_not_configured');
  });
});

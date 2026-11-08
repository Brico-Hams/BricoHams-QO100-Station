import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../../src/server/app.js';
import { validateConfig } from '../../src/server/config.js';
import { createFileAudit } from '../../src/ptt/audit.js';
import { createFakeOidc } from '../fixtures/fake-oidc.js';
import { FakeDriver, silentLogger } from '../fixtures/fakes.js';

const HB_MS = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'bricohams-func-'));
  const config = validateConfig({
    port: 0,
    google: { clientId: 'client-id' },
    allowlist: [
      { email: 'owner@example.org', callsign: 'EA4OWN', role: 'owner' },
      { email: 'op1@example.org', callsign: 'EA4AAA', role: 'operator' },
      { email: 'op2@example.org', callsign: 'EA4BBB', role: 'operator' },
      { email: 'ear@example.org', callsign: 'EA4LIS', role: 'listener' },
    ],
    tx: { enabled: true, totSeconds: 60, heartbeatTimeoutMs: HB_MS },
    auditLogPath: join(dir, 'audit.log'),
  }, { GOOGLE_CLIENT_SECRET: 'test-secret' });
  const oidc = createFakeOidc();
  const driver = new FakeDriver();
  const app = createApp(config, {
    oidc, driver, logger: silentLogger,
    audit: createFileAudit({ path: config.auditLogPath }),
  });
  const { port, url } = await app.listen();
  return { app, oidc, driver, base: url, port };
}

function cookieOf(res, name) {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return line ? line.split(';')[0] : null;
}

async function login(ctx, email) {
  const r1 = await fetch(`${ctx.base}/auth/login`, { redirect: 'manual' });
  assert.equal(r1.status, 302);
  const { code, state } = ctx.oidc.issueCode(r1.headers.get('location'), { email });
  const r2 = await fetch(`${ctx.base}/auth/callback?code=${code}&state=${state}`, {
    headers: { cookie: cookieOf(r1, 'bh_login') },
  });
  const cookie = cookieOf(r2, 'bh_session');
  return { r2, cookie, status: r2.status };
}

async function loggedIn(ctx, email) {
  const { cookie, status } = await login(ctx, email);
  assert.equal(status, 200);
  const me = await (await fetch(`${ctx.base}/api/me`, { headers: { cookie } })).json();
  return { cookie, csrf: me.csrfToken, me };
}

class WsClient {
  messages = [];

  constructor(ctx, cookie, origin = ctx.base) {
    this.ws = new WebSocket(`${ctx.base.replace('http', 'ws')}/ws/control`, { headers: { Cookie: cookie, Origin: origin } });
    this.ws.on('message', (d) => this.messages.push(JSON.parse(d.toString())));
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('unexpected-response', (_req, res) => reject(Object.assign(new Error('rejected'), { status: res.statusCode })));
      this.ws.once('error', reject);
    });
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  async waitFor(pred, from = 0, timeout = 3000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const m = this.messages.slice(from).find(pred);
      if (m) return m;
      await sleep(10);
    }
    throw new Error(`timeout; got ${JSON.stringify(this.messages)}`);
  }

  close() {
    this.ws.terminate();
  }
}

async function withApp(fn) {
  const ctx = await start();
  try {
    await fn(ctx);
  } finally {
    await ctx.app.close();
  }
}

test('serves static files with security headers, rejects bad hosts and traversal', () => withApp(async (ctx) => {
  const r = await fetch(`${ctx.base}/`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /BricoHams/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(r.headers.get('permissions-policy').includes('microphone=(self)'), true);
  assert.equal(r.headers.get('strict-transport-security'), null, 'no HSTS over plain localhost HTTP');
  assert.equal((await fetch(`${ctx.base}/%2e%2e/%2e%2e/package.json`)).status, 404);
  assert.equal((await fetch(`${ctx.base}/nope.js`)).status, 404);
  assert.equal((await fetch(`${ctx.base}/api/health`)).status, 200);
  const bad = await fetch(`${ctx.base}/api/health`, { headers: { host: 'evil.example' } }).catch(() => null);
  if (bad) assert.equal(bad.status, 421);
}));

test('API requires a session; logout requires CSRF', () => withApp(async (ctx) => {
  assert.equal((await fetch(`${ctx.base}/api/me`)).status, 401);
  assert.equal((await fetch(`${ctx.base}/api/ptt`)).status, 401);
  const { cookie, csrf, me } = await loggedIn(ctx, 'op1@example.org');
  assert.deepEqual(me.user, { email: 'op1@example.org', callsign: 'EA4AAA', role: 'operator' });
  const noCsrf = await fetch(`${ctx.base}/auth/logout`, { method: 'POST', headers: { cookie } });
  assert.equal(noCsrf.status, 403);
  const ok = await fetch(`${ctx.base}/auth/logout`, { method: 'POST', headers: { cookie, 'x-csrf-token': csrf } });
  assert.equal(ok.status, 200);
  assert.equal((await fetch(`${ctx.base}/api/me`, { headers: { cookie } })).status, 401);
}));

test('login sets a hardened session cookie and rejects users outside the allowlist', () => withApp(async (ctx) => {
  const good = await login(ctx, 'op1@example.org');
  const setCookie = good.r2.headers.getSetCookie().find((c) => c.startsWith('bh_session='));
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  const denied = await login(ctx, 'stranger@example.org');
  assert.equal(denied.status, 403);
  assert.equal(denied.cookie, null);
}));

test('WebSocket needs a session and a matching Origin', () => withApp(async (ctx) => {
  const { cookie } = await loggedIn(ctx, 'op1@example.org');
  await assert.rejects(new WsClient(ctx, 'bh_session=bogus').opened, (e) => e.status === 401);
  await assert.rejects(new WsClient(ctx, cookie, 'https://evil.example').opened, (e) => e.status === 403);
}));

test('operator takes the turn, keys TX, and heartbeat loss cuts it within the timeout', () => withApp(async (ctx) => {
  const { cookie } = await loggedIn(ctx, 'op1@example.org');
  const ws = new WsClient(ctx, cookie);
  await ws.opened;
  await ws.waitFor((m) => m.type === 'state' && m.state === 'TX_OFF');

  ws.send({ type: 'turn' });
  await ws.waitFor((m) => m.type === 'result' && m.op === 'turn' && m.ok);
  await ws.waitFor((m) => m.type === 'state' && m.state === 'ARMED' && m.isHolder && m.holder.callsign === 'EA4AAA');

  ws.send({ type: 'ptt', down: true });
  await ws.waitFor((m) => m.type === 'state' && m.state === 'TX_ON');
  assert.equal(ctx.driver.last.on, true);
  const mark = ws.messages.length;
  let lastBeat = 0;
  for (let i = 0; i < 6; i++) {
    ws.send({ type: 'heartbeat' });
    lastBeat = Date.now();
    await sleep(100);
  }
  assert.equal(ctx.app.ptt.state, 'TX_ON');

  await ws.waitFor((m) => m.type === 'state' && m.state === 'TX_OFF', mark);
  const cutAfter = Date.now() - lastBeat;
  assert.equal(ctx.driver.last.on, false);
  assert.ok(cutAfter < HB_MS + 150, `carrier cut ${cutAfter} ms after last heartbeat`);
  ws.close();
}));

test('second operator is rejected, listener is forbidden, and closing the socket cuts TX', () => withApp(async (ctx) => {
  const a = await loggedIn(ctx, 'op1@example.org');
  const b = await loggedIn(ctx, 'op2@example.org');
  const l = await loggedIn(ctx, 'ear@example.org');
  const wa = new WsClient(ctx, a.cookie);
  const wb = new WsClient(ctx, b.cookie);
  const wl = new WsClient(ctx, l.cookie);
  await Promise.all([wa.opened, wb.opened, wl.opened]);

  wa.send({ type: 'turn' });
  await wa.waitFor((m) => m.type === 'result' && m.ok);
  wa.send({ type: 'ptt', down: true });
  await wa.waitFor((m) => m.type === 'state' && m.state === 'TX_ON');

  wb.send({ type: 'turn' });
  assert.deepEqual(await wb.waitFor((m) => m.type === 'result'), { type: 'result', op: 'turn', ok: false, reason: 'busy' });
  wb.send({ type: 'ptt', down: true });
  assert.equal((await wb.waitFor((m) => m.type === 'result' && m.op === 'ptt')).ok, false);
  wl.send({ type: 'turn' });
  assert.equal((await wl.waitFor((m) => m.type === 'result')).reason, 'forbidden');
  const seenByB = await wb.waitFor((m) => m.type === 'state' && m.state === 'TX_ON');
  assert.equal(seenByB.isHolder, false);
  assert.ok(!('email' in (seenByB.holder ?? {})), 'emails are not leaked to other clients');

  const markB = wb.messages.length;
  wa.close();
  await wb.waitFor((m) => m.type === 'state' && m.state === 'TX_OFF', markB);
  assert.equal(ctx.driver.last.on, false);
  wb.close();
  wl.close();
}));

test('malformed WebSocket messages are rejected without affecting state', () => withApp(async (ctx) => {
  const { cookie } = await loggedIn(ctx, 'op1@example.org');
  const ws = new WsClient(ctx, cookie);
  await ws.opened;
  ws.ws.send('not json');
  await ws.waitFor((m) => m.type === 'error' && m.error === 'bad_message');
  ws.send({ type: 'nope' });
  await ws.waitFor((m) => m.type === 'error' && m.error === 'unknown_type');
  assert.equal(ctx.app.ptt.state, 'TX_OFF');
  ws.close();
}));

test('LOCKOUT reset over HTTP needs owner role, CSRF and a local request', () => withApp(async (ctx) => {
  await ctx.app.ptt.fault('test');
  const op = await loggedIn(ctx, 'op1@example.org');
  const own = await loggedIn(ctx, 'owner@example.org');
  const post = (s, csrf = true) => fetch(`${ctx.base}/api/ptt/reset`, {
    method: 'POST', headers: { cookie: s.cookie, ...(csrf ? { 'x-csrf-token': s.csrf } : {}) },
  });
  assert.equal((await post(op)).status, 403);
  assert.equal((await post(own, false)).status, 403);
  assert.equal(ctx.app.ptt.state, 'LOCKOUT');
  assert.deepEqual(await (await post(own)).json(), { ok: true });
  assert.equal(ctx.app.ptt.state, 'TX_OFF');
}));

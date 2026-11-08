import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthError, CSRF_HEADER, SESSION_COOKIE, createAuth, createSessionStore, parseCookies, serializeCookie } from '../../src/auth/index.js';
import { createFakeOidc } from '../fixtures/fake-oidc.js';

const REDIRECT = 'https://qo100.example.org/auth/callback';
const allowlist = [
  { email: 'owner@example.org', callsign: 'EA4XXX', role: 'owner' },
  { email: 'op@example.org', callsign: 'EA4YYY', role: 'operator' },
  { email: 'ear@example.org', callsign: 'EA4ZZZ', role: 'listener' },
];

function setup() {
  const oidc = createFakeOidc();
  const auth = createAuth({ config: { allowlist }, oidc, getRedirectUri: () => REDIRECT });
  return { oidc, auth };
}

async function login(ctx, overrides, { loginIdOverride } = {}) {
  const { url, loginId } = await ctx.auth.startLogin();
  const { code, state } = ctx.oidc.issueCode(url, overrides);
  return ctx.auth.finishLogin({ search: `?code=${code}&state=${state}`, loginId: loginIdOverride ?? loginId });
}

async function rejects(promise, code) {
  await assert.rejects(promise, (err) => err instanceof AuthError && err.code === code);
}

test('valid login creates a session with the allowlisted user', async () => {
  const ctx = setup();
  const { url } = await ctx.auth.startLogin();
  const u = new URL(url);
  assert.ok(u.searchParams.get('state').length >= 40);
  assert.ok(u.searchParams.get('nonce').length >= 40);
  assert.ok(u.searchParams.get('code_challenge'));
  const s = await login(ctx, { email: 'OWNER@example.org' });
  assert.equal(s.user.callsign, 'EA4XXX');
  assert.equal(s.user.role, 'owner');
  assert.equal(Buffer.from(s.id, 'base64url').length, 32);
  assert.notEqual(s.csrfToken, s.id);
  assert.equal(ctx.auth.authenticate({ headers: { cookie: `${SESSION_COOKIE}=${s.id}` } }), s);
});

test('expired token is rejected', async () => {
  await rejects(login(setup(), { exp: Math.floor(Date.now() / 1000) - 3600 }), 'token_expired');
});

test('wrong nonce is rejected', async () => {
  await rejects(login(setup(), { nonce: 'attacker-nonce' }), 'nonce_mismatch');
});

test('email not in allowlist is rejected', async () => {
  await rejects(login(setup(), { email: 'stranger@example.org' }), 'not_allowed');
});

test('unverified email is rejected', async () => {
  await rejects(login(setup(), { email_verified: false }), 'email_not_verified');
  await rejects(login(setup(), { email_verified: 'true' }), 'email_not_verified');
});

test('state is single-use and unknown state is rejected', async () => {
  const ctx = setup();
  const { url, loginId } = await ctx.auth.startLogin();
  const { code, state } = ctx.oidc.issueCode(url);
  await ctx.auth.finishLogin({ search: `?code=${code}&state=${state}`, loginId });
  await rejects(ctx.auth.finishLogin({ search: `?code=${code}&state=${state}`, loginId }), 'invalid_state');
  await rejects(ctx.auth.finishLogin({ search: '?code=x&state=nope', loginId }), 'invalid_state');
  await rejects(ctx.auth.finishLogin({ search: '?code=x', loginId }), 'invalid_state');
});

test('login is bound to the browser that started it', async () => {
  await rejects(login(setup(), {}, { loginIdOverride: 'other-browser' }), 'invalid_login_binding');
  await rejects(login(setup(), {}, { loginIdOverride: undefined }), 'invalid_login_binding');
});

test('pending login expires', async () => {
  let now = 1_700_000_000_000;
  const oidc = createFakeOidc();
  const auth = createAuth({ config: { allowlist }, oidc, getRedirectUri: () => REDIRECT, clock: { now: () => now } });
  const { url, loginId } = await auth.startLogin();
  const { code, state } = oidc.issueCode(url);
  now += 11 * 60 * 1000;
  await rejects(auth.finishLogin({ search: `?code=${code}&state=${state}`, loginId }), 'login_expired');
});

test('IdP error response and failed exchange are rejected', async () => {
  const ctx = setup();
  const { loginId, url } = await ctx.auth.startLogin();
  const state = new URL(url).searchParams.get('state');
  await rejects(ctx.auth.finishLogin({ search: `?error=access_denied&state=${state}`, loginId }), 'idp_error');
  const second = await ctx.auth.startLogin();
  const s2 = new URL(second.url).searchParams.get('state');
  await rejects(ctx.auth.finishLogin({ search: `?code=bogus&state=${s2}`, loginId: second.loginId }), 'token_exchange_failed');
});

test('CSRF token is required for state-changing requests', async () => {
  const ctx = setup();
  const s = await login(ctx, {});
  const headers = { cookie: `${SESSION_COOKIE}=${s.id}` };
  assert.equal(ctx.auth.requireAuth({ headers }).id, s.id);
  assert.throws(() => ctx.auth.requireAuth({ headers }, { csrf: true }), (e) => e.code === 'csrf' && e.status === 403);
  assert.throws(() => ctx.auth.requireAuth({ headers: { ...headers, [CSRF_HEADER]: 'wrong' } }, { csrf: true }), (e) => e.code === 'csrf');
  assert.equal(ctx.auth.requireAuth({ headers: { ...headers, [CSRF_HEADER]: s.csrfToken } }, { csrf: true }).id, s.id);
});

test('role checks', async () => {
  const ctx = setup();
  const listener = await login(ctx, { email: 'ear@example.org' });
  const operator = await login(ctx, { email: 'op@example.org' });
  const h = (s) => ({ headers: { cookie: `${SESSION_COOKIE}=${s.id}` } });
  assert.throws(() => ctx.auth.requireAuth({ headers: {} }), (e) => e.status === 401);
  assert.throws(() => ctx.auth.requireAuth(h(listener), { minRole: 'operator' }), (e) => e.status === 403);
  assert.ok(ctx.auth.requireAuth(h(operator), { minRole: 'operator' }));
  assert.throws(() => ctx.auth.requireAuth(h(operator), { minRole: 'owner' }), (e) => e.status === 403);
});

test('logout and expiry invalidate sessions', async () => {
  let now = 1_700_000_000_000;
  const store = createSessionStore({ clock: { now: () => now }, ttlMs: 1000 });
  const s = store.create({ email: 'a@b.org', callsign: 'X1X', role: 'listener' });
  assert.ok(store.get(s.id));
  now += 1001;
  assert.equal(store.get(s.id), null);
  const s2 = store.create({ email: 'a@b.org', callsign: 'X1X', role: 'listener' });
  store.destroy(s2.id);
  assert.equal(store.get(s2.id), null);
});

test('session ids are unique 256-bit values and the store is bounded', () => {
  const store = createSessionStore({ maxSessions: 2 });
  const a = store.create({ role: 'listener' });
  const b = store.create({ role: 'listener' });
  assert.notEqual(a.id, b.id);
  assert.throws(() => store.create({ role: 'listener' }), /too many/);
});

test('cookie helpers', () => {
  assert.deepEqual({ ...parseCookies('a=1; b=2; =x; c') }, { a: '1', b: '2' });
  const c = serializeCookie('s', 'abc_-', { maxAgeSec: 5, sameSite: 'Strict' });
  assert.match(c, /HttpOnly/);
  assert.match(c, /Secure/);
  assert.match(c, /SameSite=Strict/);
  assert.throws(() => serializeCookie('s', 'a;b', { maxAgeSec: 1, sameSite: 'Strict' }));
});

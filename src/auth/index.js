import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';
import { parseCookies } from './cookies.js';
import { createSessionStore } from './sessions.js';

export { createGoogleOidc } from './oidc.js';
export { createSessionStore } from './sessions.js';
export { parseCookies, serializeCookie } from './cookies.js';

export const SESSION_COOKIE = 'bh_session';
export const LOGIN_COOKIE = 'bh_login';
export const CSRF_HEADER = 'x-csrf-token';

const ROLE_RANK = { listener: 1, operator: 2, owner: 3 };
const LOGIN_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 500;
const CLOCK_SKEW_SEC = 60;

/** Authentication/authorization failure. `code` is machine readable; `message` is safe to show. */
export class AuthError extends Error {
  /**
   * @param {string} code
   * @param {number} [status]
   */
  constructor(code, status = 401) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Whether `role` is at least `min` (listener < operator < owner).
 * @param {string} role
 * @param {string} min
 * @returns {boolean}
 */
export function roleAtLeast(role, min) {
  return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[min] ?? Infinity);
}

/**
 * Create the authentication service.
 * @param {{config: {allowlist: ReadonlyArray<{email: string, callsign: string, role: string}>},
 *   oidc: import('./oidc.js').OidcClient, getRedirectUri: () => string,
 *   clock?: {now(): number}, randomBytes?: (n: number) => Buffer, sessions?: ReturnType<typeof createSessionStore>}} opts
 * @returns {object} Auth service: startLogin, finishLogin, authenticate, requireAuth, logout, sessions.
 */
export function createAuth({ config, oidc, getRedirectUri, clock = { now: Date.now }, randomBytes = nodeRandomBytes, sessions }) {
  const store = sessions ?? createSessionStore({ clock, randomBytes });
  const allow = new Map(config.allowlist.map((e) => [e.email, e]));
  const pending = new Map();
  const rand = () => randomBytes(32).toString('base64url');

  function sweepPending() {
    const now = clock.now();
    for (const [k, v] of pending) if (v.expiresAt <= now) pending.delete(k);
  }

  return {
    sessions: store,

    /**
     * Begin the authorization-code + PKCE flow.
     * @returns {Promise<{url: string, loginId: string}>} `loginId` must be set as a short-lived cookie to bind the browser.
     */
    async startLogin() {
      sweepPending();
      if (pending.size >= MAX_PENDING) throw new AuthError('busy', 503);
      const state = rand();
      const nonce = rand();
      const codeVerifier = rand();
      const loginId = rand();
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
      const url = await oidc.buildAuthUrl({ redirectUri: getRedirectUri(), state, nonce, codeChallenge });
      pending.set(state, { nonce, codeVerifier, loginId, expiresAt: clock.now() + LOGIN_TTL_MS });
      return { url, loginId };
    },

    /**
     * Complete the flow from the callback request.
     * @param {{search: string, loginId?: string}} req Query string of the callback and the login cookie value.
     * @returns {Promise<object>} The new session.
     * @throws {AuthError}
     */
    async finishLogin({ search, loginId }) {
      const currentUrl = new URL(getRedirectUri());
      currentUrl.search = search;
      const state = currentUrl.searchParams.get('state');
      const entry = typeof state === 'string' ? pending.get(state) : undefined;
      if (!entry) throw new AuthError('invalid_state', 400);
      pending.delete(state); // one-shot: a state can never be replayed
      if (entry.expiresAt <= clock.now()) throw new AuthError('login_expired', 400);
      if (!safeEqual(entry.loginId, loginId)) throw new AuthError('invalid_login_binding', 400);
      if (currentUrl.searchParams.has('error')) throw new AuthError('idp_error', 401);

      let claims;
      try {
        claims = await oidc.exchange({
          currentUrl,
          expectedState: state,
          expectedNonce: entry.nonce,
          codeVerifier: entry.codeVerifier,
        });
      } catch {
        throw new AuthError('token_exchange_failed', 401);
      }

      // Re-checked here on top of the OIDC library so that the policy is enforced and testable independently of it.
      if (!claims || typeof claims !== 'object') throw new AuthError('invalid_token', 401);
      if (!safeEqual(claims.nonce, entry.nonce)) throw new AuthError('nonce_mismatch', 401);
      if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SEC <= clock.now() / 1000) {
        throw new AuthError('token_expired', 401);
      }
      if (typeof claims.sub !== 'string' || !claims.sub) throw new AuthError('invalid_token', 401);
      if (claims.email_verified !== true) throw new AuthError('email_not_verified', 403);
      const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
      const user = allow.get(email);
      if (!user) throw new AuthError('not_allowed', 403);
      return store.create({ email: user.email, callsign: user.callsign, role: user.role });
    },

    /**
     * Resolve the session of a request from its cookies.
     * @param {{headers: Record<string, string|string[]|undefined>}} req
     * @returns {object|null}
     */
    authenticate(req) {
      const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      return id ? store.get(id) : null;
    },

    /**
     * Role/CSRF guard for handlers.
     * @param {{headers: Record<string, string|string[]|undefined>}} req
     * @param {{minRole?: string, csrf?: boolean}} [opts] `csrf: true` for state-changing requests.
     * @returns {object} The session.
     * @throws {AuthError} 401 without session, 403 on insufficient role or bad CSRF token.
     */
    requireAuth(req, { minRole = 'listener', csrf = false } = {}) {
      const session = this.authenticate(req);
      if (!session) throw new AuthError('unauthenticated', 401);
      if (!roleAtLeast(session.user.role, minRole)) throw new AuthError('forbidden', 403);
      if (csrf && !safeEqual(String(req.headers[CSRF_HEADER] ?? ''), session.csrfToken)) {
        throw new AuthError('csrf', 403);
      }
      return session;
    },

    /** @param {string} sessionId */
    logout(sessionId) {
      store.destroy(sessionId);
    },
  };
}

import { createHash } from 'node:crypto';

/**
 * Fake OIDC client. `buildAuthUrl` records the request; `issueCode` creates an authorization code whose
 * exchange returns claims bound to that request (nonce) unless overridden. Like a real library it checks
 * `state` and the PKCE verifier, but it deliberately does NOT validate nonce/exp/email so the auth layer's own checks are tested.
 */
export function createFakeOidc() {
  const requests = new Map(); // state -> {nonce, codeChallenge}
  const codes = new Map(); // code -> claims
  let counter = 0;
  const fake = {
    requests,
    async buildAuthUrl({ redirectUri, state, nonce, codeChallenge }) {
      requests.set(state, { nonce, codeChallenge, redirectUri });
      const u = new URL('https://fake-idp.test/authorize');
      u.search = new URLSearchParams({ state, nonce, code_challenge: codeChallenge, redirect_uri: redirectUri }).toString();
      return u.href;
    },
    /**
     * @param {string} authUrl URL produced by buildAuthUrl.
     * @param {object} [overrides] Claim overrides (use `undefined` values to drop claims).
     * @returns {{code: string, state: string}}
     */
    issueCode(authUrl, overrides = {}) {
      const params = new URL(authUrl).searchParams;
      const code = `code-${++counter}`;
      codes.set(code, {
        iss: 'https://fake-idp.test',
        sub: 'sub-123',
        aud: 'client-id',
        email: 'owner@example.org',
        email_verified: true,
        nonce: params.get('nonce'),
        exp: Math.floor(Date.now() / 1000) + 600,
        ...overrides,
      });
      return { code, state: params.get('state') };
    },
    async exchange({ currentUrl, expectedState, codeVerifier }) {
      const code = currentUrl.searchParams.get('code');
      if (currentUrl.searchParams.get('state') !== expectedState) throw new Error('state mismatch');
      const claims = codes.get(code);
      if (!claims) throw new Error('invalid code');
      codes.delete(code);
      const req = requests.get(expectedState);
      const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
      if (req.codeChallenge !== challenge) throw new Error('PKCE mismatch');
      return claims;
    },
  };
  return fake;
}

/**
 * @typedef {object} OidcClient
 * @property {(p: {redirectUri: string, state: string, nonce: string, codeChallenge: string}) => Promise<string>|string} buildAuthUrl
 * @property {(p: {currentUrl: URL, expectedState: string, expectedNonce: string, codeVerifier: string}) => Promise<object>} exchange
 *   Exchanges the code and returns the verified ID token claims. Must reject on any failure.
 */

/**
 * Real OIDC client for Google using openid-client v6 (discovery is lazy and retried on failure).
 * @param {{issuer: string, clientId: string, clientSecret: string}} opts
 * @returns {OidcClient}
 */
export function createGoogleOidc({ issuer, clientId, clientSecret }) {
  let loading = null;
  const load = () => {
    loading ??= import('openid-client')
      .then(async (lib) => ({ lib, cfg: await lib.discovery(new URL(issuer), clientId, clientSecret) }))
      .catch((err) => {
        loading = null;
        throw err;
      });
    return loading;
  };

  return {
    async buildAuthUrl({ redirectUri, state, nonce, codeChallenge }) {
      const { lib, cfg } = await load();
      return lib.buildAuthorizationUrl(cfg, {
        redirect_uri: redirectUri,
        scope: 'openid email',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).href;
    },
    async exchange({ currentUrl, expectedState, expectedNonce, codeVerifier }) {
      const { lib, cfg } = await load();
      const tokens = await lib.authorizationCodeGrant(cfg, currentUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState,
        expectedNonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) throw new Error('no id_token');
      return claims;
    },
  };
}

# auth

Google OIDC login (authorization code + PKCE + `state` + `nonce`), in-memory sessions, CSRF and role checks.

## Public API (`index.js`)
- `createAuth({config, oidc, getRedirectUri, clock?, randomBytes?, sessions?})` returns
  `startLogin()`, `finishLogin({search, loginId})`, `authenticate(req)`, `requireAuth(req, {minRole, csrf})`, `logout(id)`, `sessions`.
- `createGoogleOidc({issuer, clientId, clientSecret})`: real client on openid-client v6. Any object with
  `buildAuthUrl()` and `exchange()` (see `oidc.js` typedef) can be injected; tests use `test/fixtures/fake-oidc.js`.
- `createSessionStore`, `parseCookies`, `serializeCookie`, `AuthError`, `roleAtLeast`.

## Invariants
- Session and CSRF ids are 256-bit random values. Session cookie is `HttpOnly; Secure; SameSite=Strict`.
- `state` is single-use, expires after 10 min and is bound to the browser through the `bh_login` cookie.
- After the IdP exchange the module itself re-checks `nonce`, `exp`, `sub`, `email_verified === true` and the allowlist (case-insensitive email).
- State-changing requests need header `x-csrf-token` equal to the session's token.
- Roles: `listener < operator < owner`.
- Sessions live in memory: restarting the server logs everybody out (by design).
- Secrets and tokens are never logged; errors carry only a short code.

## Testing
`node --test test/unit/auth.test.js`

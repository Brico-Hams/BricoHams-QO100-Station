# server

HTTP(S) server, JSON API, WSS control channel and configuration loading.

## Public API
- `config.js`: `loadConfig({env, readFile})`, `validateConfig(raw, env)`, `redactConfig(config)`, `isLoopbackHost(host)`, `ConfigError`.
- `app.js`: `createApp(config, deps)` returns `{server, ptt, auth, listen(), close()}`; `securityHeaders({https, wsOrigin})`.
  `deps` (all optional, used by tests): `oidc`, `driver`, `audit`, `clock`, `publicDir`, `logger`, `tlsCredentials`.
- `index.js`: `main()`; `npm start`.

## Configuration
JSON file at `BRICOHAMS_CONFIG` (default `./config.json`, see `config.example.json`). Env overrides:
`BRICOHAMS_PORT`, `BRICOHAMS_HOST`, `BRICOHAMS_PUBLIC_URL`, `BRICOHAMS_TLS_CERT`, `BRICOHAMS_TLS_KEY`,
`GOOGLE_CLIENT_ID`, `BRICOHAMS_TX_ENABLED`, `BRICOHAMS_SDRANGEL_URL`. Secrets come **only** from the environment:
`GOOGLE_CLIENT_SECRET` (required) and `BRICOHAMS_SECRETS_KEY` (32 bytes, hex or base64).

## Endpoints
`GET /api/health`, `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout` (CSRF), `GET /api/me`, `GET /api/ptt`,
`POST /api/ptt/reset` (owner + CSRF + loopback client), WebSocket `/ws/control`, everything else is static from `src/web/public`.

WebSocket messages (client to server): `{type:'heartbeat'|'turn'|'release'}`, `{type:'ptt', down:boolean}`.
Server to client: `{type:'state', state, txEnabled, holder:{callsign}|null, isHolder, lockoutReason}`,
`{type:'result', op, ok, reason?}`, `{type:'error', error}`. Heartbeat must be sent every 500 ms while holding the turn.

## Invariants
- Plain HTTP only on a loopback listener; HSTS only when `publicUrl` is https.
- The `Host` header must equal `publicUrl`'s host (DNS-rebinding guard); WS `Origin` must equal `publicUrl`'s origin.
- Closing a control socket always releases the turn (cutting TX). `close()` cuts TX first.
- With `port: 0` (tests) `publicUrl` is rewritten to the actual port after `listen()`.
- No default transmitter driver: until the SDRangel module is wired, keying is refused.

## Testing
`node --test test/unit/config.test.js test/functional/server.test.js`

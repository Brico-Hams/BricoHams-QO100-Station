# server

HTTP(S) server, JSON API, WSS control channel and configuration loading.

## Public API
- `config.js`: `loadConfig({env, readFile})`, `validateConfig(raw, env)`, `redactConfig(config)`, `isLoopbackHost(host)`, `ConfigError`.
- `app.js`: `createApp(config, deps)` returns `{server, ptt, auth, station, beacon, listen(), close()}`; `securityHeaders({https, wsOrigin})`.
  `deps` (all optional, used by tests): `oidc`, `driver`, `audit`, `clock`, `publicDir`, `logger`, `tlsCredentials`,
  `sdrangel` (client), `spectrumSource` (async `() => {powersDb, centerHz, binHz}`; enables the beacon controller), `beaconAutoStart`.
- `index.js`: `main()`; `npm start`.

## Configuration
JSON file at `BRICOHAMS_CONFIG` (default `./config.json`, see `config.example.json`). Env overrides:
`BRICOHAMS_PORT`, `BRICOHAMS_HOST`, `BRICOHAMS_PUBLIC_URL`, `BRICOHAMS_TLS_CERT`, `BRICOHAMS_TLS_KEY`,
`GOOGLE_CLIENT_ID`, `BRICOHAMS_TX_ENABLED`, `BRICOHAMS_SDRANGEL_URL`. Secrets come **only** from the environment:
`GOOGLE_CLIENT_SECRET` (required) and `BRICOHAMS_SECRETS_KEY` (32 bytes, hex or base64).
`station` section (all optional): `lnbLoHz` (9750000000), `rxDeviceSet` (0), `txDeviceSet` (1),
`applyCorrectionToTx` (false: the beacon offset measures LNB drift on RX; enable only with a shared reference), `beaconIntervalMs` (1000).

## Endpoints
`GET /api/health`, `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout` (CSRF), `GET /api/me`, `GET /api/ptt`,
`POST /api/ptt/reset` (owner + CSRF + JSON `{code}` with the one-time 8-digit code from `resetCodePath`; 403 wrong code, 409 not locked, 502 driver error; the client address is not used), WebSocket `/ws/control`, everything else is static from `src/web/public`.
CLI: `node src/server/cli.js reset-lockout [--show]` prints how to reset and where the code file is (`--show` prints the code; local file access is the proof of presence).
Station (phase 2): `GET /api/status` and `GET /api/beacon` (any role); `POST /api/tune` `{downlinkHz}` and
`POST /api/mode` `{mode}` (operator, CSRF, JSON body; mode change is refused with 409 while TX_ON).
Invalid input gives 400, an unreachable SDRangel gives 502 `{error:'sdrangel_unavailable', kind}`.

### WebSocket protocol (`/ws/control`)

| Dir | Message | Meaning |
|---|---|---|
| C→S | `{type:'heartbeat'}` | Keep-alive; every 500 ms while holding the turn. |
| C→S | `{type:'turn'}` / `{type:'release'}` | Arm / disarm TX. |
| C→S | `{type:'ptt', down}` | Key / unkey. |
| C→S | `{type:'subscribe', rxAudio?, spectrum?}` | Booleans; anything else gives `bad_message`. |
| C→S | binary kind 1 (MIC) | Mic PCM; accepted only from the turn holder in TX_ON, otherwise dropped and counted. Not a heartbeat. |
| S→C | `{type:'caps', rxAudio, spectrum, txAudio, totSeconds}` | Sent on connect. |
| S→C | `{type:'state', state, txEnabled, holder, isHolder, lockoutReason}` | PTT state. |
| S→C | `{type:'beacon', status, offsetHz, appliedHz, snrDb, reason}` | Beacon lock. |
| S→C | `{type:'decode', mode, slotStartMs, messages:[{text, snrDb, dtSec, freqHz, to?, from?, grid?, report?, wpm?}]}` | Decoded FT8/FT4 slot, or CW text chunk (`mode:'CW'`, `wpm`). `slotStartMs` is the UTC slot start (CW: chunk time). Only sent when something was decoded. |
| S→C | `{type:'result', op, ok, reason?}`, `{type:'error', error}` | Replies. |
| S→C | binary kind 2 (RX_AUDIO), 3 (SPECTRUM) | Only to subscribed sockets; formats in `src/webrtc/README.md`. |

Config `audio`: `{enabled (default false), rxUdp{host,port}, txUdp{host,port}, spectrumUrl}`; `ws:` URLs must be loopback.
`createApp` deps may inject `rxAudio`, `txSink`, `spectrum`, `spectrumSource` for tests.

## Invariants
- Plain HTTP only on a loopback listener; HSTS only when `publicUrl` is https.
- The `Host` header must equal `publicUrl`'s host (DNS-rebinding guard); WS `Origin` must equal `publicUrl`'s origin.
- Closing a control socket always releases the turn (cutting TX). `close()` cuts TX first.
- With `port: 0` (tests) `publicUrl` is rewritten to the actual port after `listen()`.
- The default PTT driver starts/stops the SDRangel TX device set (`src/sdrangel/ptt-driver.js`); TX stays disabled unless `tx.enabled`.
- Without `spectrumSource` there is no beacon controller and `/api/beacon` reports `no-lock` / `no_source`.

## Testing
`node --test test/unit/config.test.js test/functional/server.test.js test/functional/station.test.js`

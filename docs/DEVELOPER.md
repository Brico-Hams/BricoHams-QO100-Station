# Developer guide

> Español: [docs/help/index.md](help/index.md) (usuarios) y [docs/testing/CHECKLIST.md](testing/CHECKLIST.md) (pruebas). See also [ARCHITECTURE.md](ARCHITECTURE.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Repo tour

| Path | What is in it |
|---|---|
| `package.json` | Scripts: `start`, `desktop`, `dist:win`, `dist:linux`, `test`, `test:unit`, `test:functional`. Runtime deps: `openid-client`, `ws`. Dev deps: `electron`, `electron-builder` |
| `config.example.json` | Template configuration (no secrets) |
| `src/server/config.js` | Load, validate and redact configuration; env overrides |
| `src/server/app.js` | `createApp(config, deps)`: routes, WS, security headers, wiring, `listen()`/`close()` |
| `src/server/index.js` | Process entry; reads `BRICOHAMS_CONFIG`, handles SIGINT/SIGTERM |
| `src/auth/` | `oidc.js` (openid-client v6 wrapper), `index.js` (login flow, `requireAuth`), `sessions.js`, `cookies.js` |
| `src/ptt/` | `index.js` state machine, `audit.js` file audit |
| `src/sdrangel/` | `client.js` (REST client + `ENDPOINTS`, `DEVICE_SETTINGS_KEYS`, `CHANNEL_SETTINGS_KEYS`), `ptt-driver.js`, `mock-server.js` |
| `src/modes/` | `frequencies.js`, `bandplan.js`, `station.js` (`MODE_PROFILES`, tuning), `decoders.js`, `cw-decoder.js`, `ft8-*.js`, `slot-decoder.js`, `decode-service.js` |
| `src/beacon/index.js` | `estimateBeaconOffset`, `createBeaconFilter`, `createBeaconController` |
| `src/webrtc/` | `rx-audio.js`, `tx-audio.js`, `spectrum.js`, `frames.js`, `index.js` |
| `src/log/` | `store.js`, `adif.js`, `lotw.js`, `qrz.js`, `secrets.js`, `routes.js` |
| `src/web/public/` | `index.html`, `app.js`, `rx-player.js`, `mic-capture.js`, `service-worker.js`, `manifest.webmanifest`, `styles.css`, `help.html`, icons |
| `electron/` | `main.js`, `tray.png` |
| `plugins/openwebrx/` | `bricohams.js`, `init.js`, README |
| `packaging/linux/` | `build-deb.sh`, `install.sh`, `postinst`, `control`, `bricohams-qo100.service` |
| `packaging/windows/README.md` | NSIS build notes |
| `.github/workflows/` | `ci.yml` (tests on Windows, Ubuntu x64, Ubuntu arm64), `release.yml` |
| `test/unit/` | adif, auth, beacon, config, log-store, lotw, modes, openwebrx-plugin, packaging, ptt, qrz, rx-audio, sdrangel, secrets, spectrum, tx-audio, web-public |
| `test/functional/` | audio, log, server, station |
| `test/fixtures/` | `fakes.js`, `fake-oidc.js`, `spectrum-frame.js` |
| `docs/` | This documentation; `docs/superpowers/specs/` holds the design |

## Conventions

- Node 24, ES modules, plain JS, no build step, no new dependencies (use `node:` built-ins).
- JSDoc on every exported function; comments only for the non-obvious why. English identifiers and comments.
- Dependency injection everywhere: modules take their collaborators (`client`, `driver`, `clock`, `fetch`, `runner`, `oidc`) so tests need no I/O.
- Errors are classes with a short `code` (`AuthError`, `LogError`, `StationError`, `SdrangelError`); never put secrets in messages.
- Validate input at trust boundaries (HTTP body, WS message, config, SDRangel responses).
- Every module has `src/<module>/README.md`: public API, invariants, how to test. Keep it in sync.

## Running

```bash
npm ci
cp config.example.json config.json         # then edit
export GOOGLE_CLIENT_SECRET=...            # PowerShell: $env:GOOGLE_CLIENT_SECRET='...'
npm start                                  # BRICOHAMS_CONFIG selects another file
npm run desktop                            # Electron shell (config in userData/config.json)
```

For local development without TLS use `host: "127.0.0.1"`, no `tls` section and `publicUrl: "http://localhost:8443"`.
Google accepts `http://localhost` redirect URIs for development clients.

**Mock SDRangel.** `createMockSdrangel()` in `src/sdrangel/mock-server.js` is an in-process HTTP server that mimics the REST surface the client uses
(default: device set 0 RTLSDR RX, set 1 PlutoSDROutput TX). It exposes `start()`, `stop()`, `state`, `calls`, `delayMs` and `failNext(status)`. Start it from a
small script and point `sdrangel.baseUrl` at its URL to exercise the UI without hardware. It does not stream audio or spectrum.

## Testing

```bash
npm test                  # node --test "test/**/*.test.js"
npm run test:unit
npm run test:functional
node --test test/unit/ptt.test.js
```

Tests use no network, hardware, real Google or real SDRangel.

- **Fake clock** (`test/fixtures/fakes.js`): `FakeClock` implements `{now, setTimeout, clearTimeout}` plus `advance(ms)` and `pending()`; `FakeDriver` records `calls` and fails on demand with `failOn`; `tick()` yields to the event loop; `silentLogger`.
- **Fake OIDC** (`test/fixtures/fake-oidc.js`): `createFakeOidc()` returns `{buildAuthUrl, exchange, issueCode(authUrl, overrides), requests}`. It checks `state` and PKCE but deliberately **not** nonce, `exp` or email, so the auth layer's own checks are what is tested; use `overrides` to craft bad tokens.
- **Mock SDRangel**: see above; functional tests start it with `port: 0`.
- **App injection**: `createApp(config, deps)` accepts `oidc`, `driver`, `audit`, `clock`, `publicDir`, `sdrangel`, `spectrumSource`, `beaconAutoStart`, `rxAudio`, `txSink`, `spectrum`, `logStore`, `lotwUploader`, `qrz`, `qrzFetch`, `logger`, `tlsCredentials`. Use `port: 0` in tests.
- Spectrum frames: `test/fixtures/spectrum-frame.js`.

Write a test for every change; see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Extending

### A new SDR device type
1. Add its SDRangel device key to `DEVICE_SETTINGS_KEYS` in `src/sdrangel/client.js` (settings key name from the SDRangel swagger, e.g. `hackRFInputSettings`) and the settings you set (centre frequency, sample rate, gains).
2. If it is TX-capable, check that `ptt-driver.js` can start/stop its device set (it uses the generic device-set `run` endpoint, so no change is normally needed).
3. Add a case to `test/unit/sdrangel.test.js` and extend the mock in `mock-server.js` if the shape differs.
4. Document it in the user help (`docs/help/primera-puesta-en-marcha.md`) and mark it as untested until someone runs the checklist on real hardware.

### A new mode
1. Add a profile to `MODE_PROFILES` in `src/modes/station.js` (SDRangel channel type, bandwidth, offsets).
2. Add the segment and default dial to `src/modes/bandplan.js` and the log mode to `src/log/store.js`/`adif.js` if it is loggable.
3. Add UI buttons in `src/web/public/` and tests in `test/unit/modes.test.js`.

### A new decoder
Implement `{mode, available:true, decode(pcmFrame, utcSlot, nowMs)}` (returns an array, or a Promise of one), register it with `registry.register(decoder)` (see `createDefaultDecoderRegistry` in `src/modes/decoders.js`) and pass the registry to `createStation` / `createApp({decoders})`.
The built-in CW, FT8 and FT4 decoders are pure JavaScript; see `src/modes/README.md`. `decode-service.js` taps the RX audio, runs the decoder of the current mode and broadcasts WebSocket `decode` messages that the PWA lists.

## Debugging common failures

| Symptom | Check |
|---|---|
| Server exits at start with a config error | Run with the same env; messages name the key. Missing `GOOGLE_CLIENT_SECRET`, `google.clientSecret` in file, non-loopback host without TLS, `publicUrl` scheme mismatch |
| Login: `redirect_uri_mismatch` | `publicUrl` + `/auth/callback` must be listed exactly in Google |
| Login: `not_allowed` / `email_not_verified` | Email not in `allowlist` (case-insensitive) or Google account unverified |
| Everything returns 421 | `Host` differs from `publicUrl` (proxy not passing Host) |
| WS closes immediately (403/401) | `Origin` must equal `publicUrl` origin; cookie must be valid |
| `502 sdrangel_unavailable` | `kind` says `timeout`, `network`, `http` or `invalid`; check SDRangel REST on `sdrangel.baseUrl` and the endpoint paths (see verify list) |
| TX refused | WS `result.reason`: `tx_disabled`, `forbidden`, `busy`, `lockout`, `audit_failed` (audit path not writable) |
| LOCKOUT | Check `audit.log` for `lockout`; fix the cause; owner resets from the local machine |
| No spectrum / beacon `no_source` | `audio.enabled` must be true and SDRangel's spectrum server reachable at `audio.spectrumUrl` |
| No RX audio | SDRangel must send "copy audio to UDP" to `audio.rxUdp` at 48 kHz |
| QRZ 503 | `BRICOHAMS_SECRETS_KEY` unset |
| LoTW `cancelled` | TQSL asked for a certificate password; use a certificate without one for unattended upload |

## Release process

1. Update the version in `package.json` and notes; run `npm test` on all platforms (CI does it).
2. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. `.github/workflows/release.yml` builds: Windows NSIS `.exe`, Linux AppImage (x64 and arm64), `.deb` (amd64 and arm64; each job runs `npm test`) with `.sha256` files, then publishes a GitHub Release (tag runs only). Nothing is code-signed (`CSC_IDENTITY_AUTO_DISCOVERY=false`).
4. `workflow_dispatch` builds artifacts without publishing.
5. Smoke-test the artifacts with the checklist section A before announcing.

The `.deb` build (`packaging/linux/build-deb.sh <arch>`) bundles Node `24.20.0` (override with `NODE_VERSION`), verifying its SHA-256 against the official `SHASUMS256.txt`.

## Unconfirmed items (`verify`)

Everything below was written without access to the real system and must be checked by the first person with the hardware or software.

| Where | What is unconfirmed |
|---|---|
| `src/sdrangel/client.js:7` | REST endpoint paths (`ENDPOINTS`) against the SDRangel swagger |
| `src/sdrangel/client.js:20` | Device settings keys per hardware (`DEVICE_SETTINGS_KEYS`) |
| `src/sdrangel/client.js:39` | Channel settings keys (`CHANNEL_SETTINGS_KEYS`) |
| `src/sdrangel/README.md` ("To verify") | POST channel response, TX hardware type names, whether stopping the TX device removes the carrier |
| `src/webrtc/tx-audio.js:21` | SSBMod UDP audio input (`udpAddress`, `udpPort`, `audioInputType`, sample rate, format). Top risk; fallback is a loopback audio device |
| `src/webrtc/spectrum.js:14` | SDRangel spectrum WebSocket binary layout |
| `src/modes/station.js:8` | SSBDemod/SSBMod field names and CW keyer settings |
| `src/modes/bandplan.js:3` | QO-100 NB band plan segment edges |
| `src/modes/bandplan.js:12` | Default FT8/FT4 dial frequencies |
| `plugins/openwebrx/init.js:2` | OpenWebRX+ plugin installation mechanism and paths |
| `src/modes/README.md` | Transponder sideband inversion is not modelled; verify on air |
| `src/log/lotw.js` | TQSL command-line flags per TQSL version |
| `src/log/qrz.js` | QRZ Logbook API response format |
| `electron/README.md` | `electron/tray.png` is empty; Electron 45's Node must support `node:sqlite` |
| `packaging/linux/build-deb.sh:7` | Bundled Node version `24.20.0` exists and is current |
| Spec §12 | arm64 SDRangel device support and Raspberry Pi CPU load |
| `src/modes/ft8-*.js`, `cw-decoder.js` | Decoders are untested on real off-air audio (only synthesized signals); SNR and dt values are estimates |

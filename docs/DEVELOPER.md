# Developer guide

> Español: [docs/help/index.md](help/index.md) (usuarios) y [docs/testing/CHECKLIST.md](testing/CHECKLIST.md) (pruebas). See also [ARCHITECTURE.md](ARCHITECTURE.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Repo tour

| Path | What is in it |
|---|---|
| `package.json` | Scripts: `start`, `desktop`, `dist:win`, `dist:linux`, `diagram`, `test`, `test:unit`, `test:functional`, `sim`. Runtime deps: `openid-client`, `ws`. Dev deps: `electron`, `electron-builder` |
| `config.example.json` | Template configuration (no secrets) |
| `src/server/config.js` | Load, validate and redact configuration; env overrides |
| `src/server/app.js` | `createApp(config, deps)`: routes, WS, security headers, wiring, `listen()`/`close()` |
| `src/server/index.js` | Process entry; reads `BRICOHAMS_CONFIG`, handles SIGINT/SIGTERM |
| `src/auth/` | `oidc.js` (openid-client v6 wrapper), `index.js` (login flow, `requireAuth`), `sessions.js`, `cookies.js` |
| `src/ptt/` | `index.js` state machine, `audit.js` file audit |
| `src/sdrangel/` | `client.js` (REST client + `ENDPOINTS`, `DEVICE_TABLE`, `CHANNEL_TABLE`, `NOT_IN_SDRANGEL_API`), `swagger-lite.js`, `ptt-driver.js`, `mock-server.js` (strict mock), `iq.js` |
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
| `test/unit/` | adif, auth, beacon, config, log-store, lotw, modes, openwebrx-plugin, packaging, ptt, qrz, rx-audio, sdrangel, sdrangel-alignment, secrets, sim-smoke, spectrum, tx-audio, web-public, neural-diagram, … |
| `test/functional/` | audio, log, server, station |
| `test/sim/` | Deterministic simulations (`npm run sim`), see [Simulations](#simulations) and [ADR 0023](adr/0023-simulation-framework.md) |
| `test/fixtures/` | `fakes.js`, `fake-oidc.js`, `spectrum-frame.js`, `dsp.js` |
| `docs/` | This documentation; `docs/superpowers/specs/` holds the design; `docs/references/` the reference material ([index](references/README.md)); `docs/architecture/` the neural diagram |

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
small script and point `sdrangel.baseUrl` at its URL to exercise the UI without hardware. It does not stream audio or spectrum. Every write is validated against the reference copy of the SDRangel swagger (see [Refreshing the SDRangel reference copy](#refreshing-the-sdrangel-reference-copy)): an unknown key or a wrong type returns 400 with details.

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
1. Add its SDRangel device key to `DEVICE_TABLE` in `src/sdrangel/client.js` (settings key name from the SDRangel swagger, e.g. `hackRFInputSettings`) and the settings you set (centre frequency, sample rate, gains), each with a `ref:` to the reference copy. If the device is not in `docs/references/sdrangel-swagger/include/`, add its YAML there first (see below), otherwise the strict mock cannot validate it.
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

## Plugin API

BricoHams has two extension points and **no server-side code plugins** (rationale: [ADR 0018](adr/0018-plugin-api.md)).

### Client plugins

A plugin is a static ES module `plugins/<name>/index.js` (name `[a-z0-9-]`, max 32 chars) that exports `activate(api)`. The owner installs it and lists it in `plugins.enabled` of `config.json`; only listed names are served (`/plugins/<name>/...`, whitelisted path segments and file types, no path traversal) and loaded by `plugin-loader.js`. The CSP stays `self`-only.

`api` is a frozen object:

| Member | Meaning |
|---|---|
| `version` | API version (integer) |
| `topics` | `frequency`, `mode`, `beacon`, `spots`, `decodes` |
| `subscribe(topic, fn)` | Read-only state subscription; returns an unsubscribe function; unknown topics (for example `ptt`) throw `TypeError` |
| `registerPanel({title, render})` | Add a panel to the plugin area; `render(el)` fills a container owned by the plugin |
| `requestTune(downlinkHz)` | Asks for an RX tune through the normal role-checked `POST /api/tune`; never touches TX |
| `prefillLog({call, ...})` | Pre-fills the QSO form (the user still saves it) |

The API has no PTT, microphone, token or raw WebSocket access, and the loader removes `globalThis.BHApp` before plugins run. This is defence in depth, **not a sandbox**: a plugin is same-origin code installed by the owner, so install only code you trust. Example: `plugins/examples/hello-panel/` (copy it to `plugins/hello-panel/` and enable it).

### Outgoing webhooks (server side)

Configure `webhooks.endpoints[]` with `{url, events, secretEnv}`; events: `decode`, `spot`, `qso_logged`, `ptt_state` (informational only). Each delivery is `POST` JSON `{id, type, time, data}` with headers `X-BricoHams-Timestamp` (unix seconds) and `X-BricoHams-Signature: sha256=<hex>`, the HMAC-SHA256 of `"<timestamp>.<body>"` with the endpoint secret read from the environment variable `secretEnv`. Receivers should verify the signature in constant time and reject timestamps older than a few minutes (`verifySignature` in `src/plugins/webhooks.js` does this). Failed deliveries are retried with exponential backoff; redirects are refused; payloads never contain secrets, tokens or cookies.

### Test seams of `createApp`

`deps.clusterConnect`, `deps.clusterTimers`, `deps.calendarFetch`, `deps.webhookFetch`, `deps.webhookTimers`, `deps.iq`, `deps.spots`, `deps.calendar`, `deps.webhooks` replace network and hardware with in-process fakes (see `test/functional/phase13.test.js`).

## Refreshing the SDRangel reference copy

`docs/references/sdrangel-swagger/` is a read-only, unmodified copy of the parts of the SDRangel API that BricoHams uses ([ADR 0022](adr/0022-sdrangel-api-alignment.md)). It is pinned to upstream commit `596a3ac9389d50690b8e08eceb24e8e580cff10a` of [f4exb/sdrangel](https://github.com/f4exb/sdrangel) (retrieved 2026-11-08); the commit and date are recorded in that folder's `README.md`. SDRangel is © Edouard Griffiths F4EXB and contributors, GPL-3.0.

| Files | Upstream location | Used for |
|---|---|---|
| `swagger.yaml` | `swagger/sdrangel/api/swagger/swagger.yaml` | Endpoint paths and methods (`ENDPOINTS`), wrapper schemas |
| `include/*.yaml` (Airspy, AirspyHF, CWKeyer, ChannelActions, ChannelAnalyzer, ChannelSettings, DeviceActions, DeviceSettings, FT8Demod, FileInput, FileSink, FreqTracker, GLSpectrum, HackRF, LocalSink, PlutoSdr, RemoteSource, RtlSdr, SDRPlay, SDRPlayV3, SSBDemod, SSBMod, UDPSink, UDPSource, USRP) | `swagger/sdrangel/api/swagger/include/` | Settings keys and types: `swagger-lite` reads them for the strict mock |
| `source/*.h`, `source/wsspectrum.cpp` (freqtracker, ssbdemod, ssbmod, udpsink, udpsource settings; wsspectrum) | The same-named files elsewhere in the SDRangel tree (find them with `git ls-tree -r <commit>` and the file name) | Enum values (`FormatUSB`=3, `FormatUSBMono`=7, ...) and the spectrum WebSocket frame layout, which the swagger does not specify |

To move to a newer SDRangel (the version your stations run):

1. Pick the upstream commit or tag. Download the same paths from it over the folder, **without editing** the files. Add any new `include/*.yaml` you need (for example a device the client now supports).
2. Update the commit hash and date in `docs/references/sdrangel-swagger/README.md` and in this section.
3. Run `npm test`. The strict mock (`src/sdrangel/mock-server.js`) validates every PATCH/POST/PUT against `include/*.yaml` with `swagger-lite.js` (`validateAgainst`): unknown keys or wrong basic types give 400 and the test that sent them fails. `swagger-lite` reads only the YAML subset these files use; block scalars are skipped and anything it does not understand is ignored, never guessed. If a new file uses syntax it cannot read, extend `swagger-lite.js` and its test rather than editing the YAML.
4. For each failure, fix the entry in `src/sdrangel/client.js` (`DEVICE_TABLE`, `CHANNEL_TABLE`, `ENDPOINTS`) or the value in `src/modes/station.js`, and update its `ref: <file>:<line>` comment (line numbers move). A thing that is not in the API goes in `NOT_IN_SDRANGEL_API` with a reason, never as an unreferenced key.
5. Re-check the spectrum frame parser in `src/webrtc/spectrum.js` against `source/wsspectrum.cpp` (`buildPayload`) and the tests `test/unit/spectrum.test.js`, `test/unit/sdrangel-alignment.test.js`.
6. Run `npm run sim` (the `qso` scenario fails on any swagger-invalid request) and note the SDRangel version in the next release notes.

Still not checkable from the copy: Hermes Lite 2/Metis, LimeSDR and TestSource settings, `ChannelReport.yaml` (the `<Type>Report` wrapper names are inferred) and the file suffix FileSink appends to `fileRecordName`. These need a real instance (see the list below).

## Simulations

`npm run sim` runs `test/sim/*.sim.test.js`: seeded, in-process, no network or hardware. Rationale, models, thresholds and limits: [ADR 0023](adr/0023-simulation-framework.md). User-facing description: [comprobar-sin-hardware.md](help/comprobar-sin-hardware.md). Output: `docs/testing/sim-report.md` (Spanish, generated; do not edit by hand).

```bash
npm run sim                                   # all scenarios, 5-10 min on an idle machine
node --test test/sim/beacon.sim.test.js       # one scenario (still rewrites the report with what is available)
node test/sim/report.js                       # rebuild the report from the last results (< 6 h old)
SIM_BEACON_SECONDS=1800 npm run sim           # PowerShell: $env:SIM_BEACON_SECONDS=1800
```

Knobs: `SIM_BEACON_SECONDS`, `SIM_TRIALS`, `SIM_ASSERT_TRIALS`, `SIM_CW_TRIALS`, `SIM_PTT_SESSIONS`, `SIM_CONTENTION_ATTEMPTS`, `SIM_RESULTS_DIR`. The fast subset `test/unit/sim-smoke.test.js` runs in `npm test`; the full set does not (duration). If a case fails only under load, see "Observed intermittency" in the ADR before touching thresholds.

**Layout.** `band-sim.js` generates the QO-100 NB band (96 kS/s complex baseband: beacon, CW beacon, voice, FT8/FT4, CW, AWGN, common LNB drift, spurs) plus `fftFrame` (SDRangel spectrum format) and `usbDemod`; `beacon-rig.js`, `digital-rig.js`, `cw-rig.js` wrap it into one trial or closed loop; `*.sim.test.js` are the scenarios; `metrics.js` and `report.js` collect and print results.

**Adding a rig or scenario.**
1. Put the signal or system model in `band-sim.js` (or a new `<name>-rig.js` if it is a closed loop). Everything must derive from a seed (`prng` from `test/fixtures/dsp.js`) and use `FakeClock` for time; no `Date.now()` or real sockets, except the loopback mock.
2. Write `test/sim/<scenario>.sim.test.js` with `simTest('<scenario>', 'title', fn)` from `metrics.js` (not bare `test()`, which would not be recorded). Inside, call `record('<scenario>', 'key', value)` with JSON-serializable metrics, then `assert` the thresholds. State the justification for each threshold in a comment and in ADR 0023.
3. Keep one case under the 280 s per-test timeout on a loaded machine; expose runtime-heavy sizes as `SIM_*` variables with defaults.
4. Add the scenario to `SCENARIOS` in `report.js` and write its section function (tables in Spanish). Add a case to `test/unit/sim-smoke.test.js` only if a fast version is worth having in `npm test`.
5. Add the variables to `test/sim/README.md` and the ADR, run `npm run sim` on a quiet machine and commit the regenerated `docs/testing/sim-report.md`.

**Metrics and report pipeline.** Each scenario file runs in its own `node --test` process. `simTest()` records each case (pass/fail, duration, first error) and `record()` the metrics; after the case `saveResults()` writes `<SIM_RESULTS_DIR>/<scenario>.json` atomically (default: `bricohams-qo100-sim-results` in the OS temp dir). After the last test of a file, `report.js` `writeReport()` loads every scenario JSON no older than 6 h, renders the Spanish markdown and writes it atomically to `docs/testing/sim-report.md`.

## Neural diagram

`docs/architecture/neural-diagram.svg` (and `neural-graph.json`) show every module as a neuron and every real import as a synapse; see [docs/architecture/README.md](architecture/README.md) for how to read it.

```bash
npm run diagram        # node docs/architecture/generate-neural.mjs
```

The generator reads `src/**/*.js`, `electron/main.js`, `plugins/openwebrx/*.js` and `services/qo100-calculators/assets/*.js`; only the external links (SDRangel, Google, TQSL, QRZ, DX cluster...) are declared by hand in the generator, each with the file that justifies it. Output is deterministic. Regenerate and commit both files whenever a module is added, removed or renamed, a dependency between modules is added or removed, a file grows or shrinks markedly (node size is proportional to the square root of the lines of code), or an external link changes. `test/unit/neural-diagram.test.js` tests the generator (parsing, layering, no `NaN`, every `src` module covered) but **not** that the committed SVG is current, so regenerate it by hand before a release and when reviewing structural changes.

## Debugging common failures

| Symptom | Check |
|---|---|
| Server exits at start with a config error | Run with the same env; messages name the key. Missing `GOOGLE_CLIENT_SECRET`, `google.clientSecret` in file, non-loopback host without TLS, `publicUrl` scheme mismatch |
| Login: `redirect_uri_mismatch` | `publicUrl` + `/auth/callback` must be listed exactly in Google |
| Login: `not_allowed` / `email_not_verified` | Email not in `allowlist` (case-insensitive) or Google account unverified |
| Everything returns 421 | `Host` differs from `publicUrl` (proxy not passing Host) |
| WS closes immediately (403/401) | `Origin` must equal `publicUrl` origin; cookie must be valid |
| `502 sdrangel_unavailable` | `kind` says `timeout`, `network`, `http` or `invalid`; check SDRangel REST on `sdrangel.baseUrl`. `http` with 400 usually means a setting key unknown to that SDRangel version: compare with the reference copy |
| TX refused | WS `result.reason`: `tx_disabled`, `forbidden`, `busy`, `lockout`, `audit_failed` (audit path not writable) |
| LOCKOUT | Check `audit.log` for `lockout`; fix the cause; owner resets from the local machine |
| No spectrum / beacon `no_source` | `audio.enabled` must be true and SDRangel's spectrum server reachable at `audio.spectrumUrl` |
| No RX audio | `audio.enabled` must be true; `station.provision()` must have created the SDRangel `UDPSink` that sends to `audio.rxUdp` (48 kHz, USBMono); check the log for `SDRangel provisioning failed` and that no other process owns the UDP port |
| No TX audio | The `UDPSource` listening on `audio.txUdp` (provisioned) must exist; audio is only sent in `TX_ON` |
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

Everything below was written without access to a real SDRangel instance or the hardware and must be checked by the first person who has it. Items that phases 14a-14c verified against the real SDRangel swagger and sources (REST endpoint paths, device and channel settings keys, the UDPSource/UDPSink audio path, SSBMod/SSBDemod and CW keyer field names, the spectrum WebSocket frame layout) were removed from this list; they are now checked by the strict mock on every `npm test` ([ADR 0022](adr/0022-sdrangel-api-alignment.md)). What remains is what a copy of the definitions cannot prove.

| Where | What is unconfirmed |
|---|---|
| `src/sdrangel/README.md` ("Reference and refresh") | Settings of Hermes Lite 2/Metis, LimeSDR and TestSource (not in the reference copy); the `<Type>Report` wrapper names (`ChannelReport.yaml` is not copied, so FreqTracker's `trackingDeltaFrequency` report is inferred) |
| `src/sdrangel/iq.js` | The suffix SDRangel adds to `fileRecordName`; recording and playback on a real instance |
| `src/sdrangel/README.md`, `src/webrtc/README.md` | POST channel response, TX hardware type names on real SDRangel, whether stopping the TX device removes the carrier, real UDPSink/UDPSource datagram sizing and latency |
| `src/modes/station.js` `provision()` | Behaviour of the provisioned UDPSink/UDPSource/FreqTracker on a live SDRangel (idempotence, set order, port clashes) |
| `src/beacon/freqtracker.js` | FreqTracker lock range and behaviour on a real beacon (the simulation assumes about +-250 Hz) |
| `src/modes/bandplan.js:3` | QO-100 NB band plan segment edges |
| `src/modes/bandplan.js:12` | Default FT8/FT4 dial frequencies |
| `plugins/openwebrx/init.js:2` | OpenWebRX+ plugin installation mechanism and paths |
| `src/modes/README.md` | Transponder sideband inversion is not modelled; verify on air |
| `src/log/lotw.js` | TQSL command-line flags per TQSL version |
| `src/log/qrz.js` | QRZ Logbook API response format |
| `electron/README.md` | `electron/tray.png` is empty; Electron 45's Node must support `node:sqlite` |
| `packaging/linux/build-deb.sh:7` | Bundled Node version `24.20.0` exists and is current |
| Spec §12 | arm64 SDRangel device support and Raspberry Pi CPU load |
| `src/modes/ft8-*.js`, `cw-decoder.js` | Decoders are untested on real off-air audio (only synthesized signals, [ADR 0023](adr/0023-simulation-framework.md)); SNR and dt values are estimates |
| Beacon on real spectra | Accuracy was measured with synthetic spectra only; real LNB drift, interference and the first real spectrum frames are untested |

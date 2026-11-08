# Security policy

> Español: la guía para el titular de la estación está en [docs/help/acceso-remoto.md](docs/help/acceso-remoto.md).

BricoHams controls a radio transmitter over the internet. A security failure can mean an unattended or hijacked carrier
on a satellite transponder shared by many amateurs, so the design treats **transmit control** as the asset to protect.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

1. Use GitHub's private vulnerability reporting (repository **Security** tab, **Report a vulnerability**), or
2. email the maintainers at the address on the GitHub organisation profile if private reporting is unavailable.

Include the version, how to reproduce, and the impact. Do not include real credentials. We aim to acknowledge within 7 days and
to publish a fix and an advisory once users have had time to update. Reports about "TX can be keyed without authentication",
"carrier survives a lost connection" or "secret is logged" are treated as critical.

## Threat model

Assets: the transmitter and the licence of the owner; Google and QRZ credentials; the logbook; the owner's network.
Attacker: anyone on the internet who can reach the HTTPS port; a malicious or compromised allowlisted user; a malicious web page
visited by an operator; a third-party OpenWebRX+ plugin host.
Out of scope: a compromised host OS or SDRangel, physical access to the station, Google account takeover of an allowlisted user
(mitigate with Google 2-step verification).

| Threat | Controls implemented | Where |
|---|---|---|
| **Remote TX abuse** (unauthenticated or unauthorised keying, two operators at once) | TX disabled unless `tx.enabled` (or `BRICOHAMS_TX_ENABLED`); only roles `operator`/`owner` can take the turn; one holder at a time; every WS command is bound to a server-side connection id; listeners cannot reach TX | `src/ptt/index.js` (`requestTurn`, `TX_ROLES`), `src/server/config.js` |
| **Carrier left on** (connection lost, hung client, bug) | Heartbeat watchdog fires at 75 % of `heartbeatTimeoutMs` (max allowed 2000 ms, so cut < 2 s); closing the WebSocket releases the turn; TOT (default 600 s); armed-without-TX timeout; "off" must be confirmed by SDRangel or the machine enters LOCKOUT; carrier is dropped before any state or audit update; `close()` cuts TX first | `src/ptt/index.js`, `src/sdrangel/ptt-driver.js`, `src/server/app.js` (`ws.on('close')`, `close()`) |
| **No audit trail** | Each turn, denial, TX on/off, lockout and reset is appended to a JSON-lines audit log (mode 0600); if the `tx_on` record cannot be written, TX is refused | `src/ptt/audit.js`, `src/ptt/index.js` (`keyDown`) |
| **LOCKOUT cleared remotely** | A reset needs an `owner` session with CSRF token **and** a one-time 8-digit code that the server writes to a file in its data directory (mode 0600) each time it enters LOCKOUT; only "reset code written to <path>" is logged. The code is compared in constant time, works once, rotates on every LOCKOUT and after 5 wrong attempts. The client address is not trusted for this | `src/ptt/reset-code.js`, `src/ptt/index.js` (`ownerReset`), `src/server/app.js`, `src/server/cli.js` |
| **Hot microphone / overdrive** | Mic frames are accepted only from the turn holder while state is `TX_ON`, checked per frame; sample-rate whitelist; 100 ms frame cap; peak limiter at 0.8 full scale with hard clamp; browser opens the mic only after the turn is granted and closes it when the turn ends; key-up on blur/hidden | `src/webrtc/tx-audio.js`, `src/web/public/app.js` |
| **Session hijack / fixation** | Google OIDC code flow with PKCE (S256), `state` (single use, 10 min, bound to the browser by the `bh_login` cookie) and `nonce`; claims re-checked (`exp`, `sub`, `email_verified`, allowlist); 256-bit random session ids; session cookie `HttpOnly; Secure; SameSite=Strict`, 12 h; logout destroys the session and closes its sockets; sessions in memory only | `src/auth/index.js`, `src/auth/sessions.js`, `src/auth/cookies.js`, `src/auth/oidc.js` |
| **CSRF / cross-site WebSocket** | `X-CSRF-Token` required on every state-changing HTTP request (constant-time compare); WS handshake requires `Origin` equal to `publicUrl` and a valid session cookie; `SameSite=Strict` | `src/auth/index.js` (`requireAuth`), `src/server/app.js` (`upgrade`) |
| **DNS rebinding / host spoofing** | `Host` header must equal the `publicUrl` host (HTTP 421 otherwise) | `src/server/app.js` (`route`) |
| **XSS / clickjacking / injection into the PWA** | CSP `default-src 'self'` with no inline script or style, `frame-ancestors 'none'`, `object-src 'none'`, `nosniff`, `Referrer-Policy: no-referrer`, HSTS over HTTPS, `Permissions-Policy` limited to microphone; server data is rendered with `textContent`; static serving is path-traversal safe | `src/server/app.js` (`securityHeaders`, `serveStatic`), `src/web/public/app.js` |
| **Cleartext exposure** | Non-loopback listen address requires TLS (TLS 1.2+); `publicUrl` must be https unless localhost; `audio.spectrumUrl` must be `wss:` unless loopback | `src/server/config.js`, `src/server/app.js` |
| **Secret leakage** | `google.clientSecret` in the config file is **rejected**; secrets come only from the environment (`GOOGLE_CLIENT_SECRET`, `BRICOHAMS_SECRETS_KEY`) or `secrets.env`/`/etc/bricohams-qo100/env` (mode 0600); `redactConfig` for logging; errors carry codes, never values; QRZ key is encrypted with AES-256-GCM (AAD = owner + name), write-only through the API; QRZ requests use `redirect: 'error'`; TQSL certificates are never read | `src/server/config.js`, `src/log/secrets.js`, `src/log/routes.js`, `src/log/qrz.js`, `src/log/lotw.js`, `packaging/linux/postinst` |
| **Log abuse** | Roles `operator`+ only; operators edit/delete only their own QSOs; client cannot set callsign, band or statuses; parameterised SQL; ADIF field lengths computed in UTF-8 bytes; LoTW run through `execFile` without a shell and with a validated station-location name | `src/log/routes.js`, `src/log/store.js`, `src/log/lotw.js` |
| **Plugin isolation** | The OpenWebRX+ plugin has no network calls, no microphone and no TX/PTT/log code; a unit test fails if such references appear; the PWA link is a plain anchor | `plugins/openwebrx/bricohams.js`, `test/unit/openwebrx-plugin.test.js` |
| **Desktop shell** | Electron: `contextIsolation`, `sandbox`, no `nodeIntegration`, no preload; only the microphone permission for the local origin; navigation only to the local origin and `accounts.google.com`; new windows denied; loopback-only listener | `electron/main.js` |
| **Service hardening (Linux)** | systemd unit runs as unprivileged `bricohams`, `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, read-only config directory; the package never enables TX and never starts the service | `packaging/linux/bricohams-qo100.service`, `packaging/linux/postinst` |
| **Supply chain** | Exact dependency versions and lockfile; `npm ci --omit=dev --ignore-scripts` for the `.deb`; the bundled Node tarball is verified against the official `SHASUMS256.txt`; release artifacts ship `.sha256` files; installer verifies the hash | `package.json`, `packaging/linux/build-deb.sh`, `packaging/linux/install.sh` |
| **Resource exhaustion** | WS payload max 4096 bytes; JSON body max 4096 bytes; max 1000 sessions, 500 pending logins; slow audio/spectrum listeners drop frames instead of queueing | `src/server/app.js`, `src/auth/`, `src/webrtc/` |

### Known limitations and caveats

- **LOCKOUT reset and reverse proxies.** The reset does not depend on the client address, so a same-host reverse proxy does not weaken it:
  a remote owner session still needs the one-time code, which can only be read on the machine (see `node src/server/cli.js reset-lockout`).
  Anyone who can read the data directory (and owns an owner session) can reset; keep it readable only by the service user.
- Sessions are in memory: restarting the server signs everybody out (intentional). There is no login rate limiting beyond Google's own.
- The Windows installer is not code-signed (SmartScreen warning). Verify the published SHA-256.
- The allowlist is the only authorisation list; removing a user takes effect at the next restart (the file is read at startup).
- The first-time local confirmation of TX described in the design is realised as: TX is off by default and only the machine owner can set `tx.enabled`
  in the local configuration. There is no separate in-app confirmation dialog.
- SDRangel REST/UDP interfaces are unauthenticated and must stay on loopback (default). Never expose ports 8091, 8887, 9998 or 9999.

## Operator responsibilities

BricoHams is a tool; **you** are the licensed operator and the station owner.

- You need a valid amateur radio licence that permits operation on the 13 cm uplink (2400 MHz) and you must follow your national rules
  and the QO-100 band plan and usage guidelines (narrow-band transponder: no CW/digital in SSB segments, power limits, no carriers left on).
- The owner decides who is on the allowlist and with which role. Give `operator` only to licensed hams whom you trust; the callsign in the
  allowlist is the one written to the log and the audit trail. A remote operator transmits **under your station's responsibility**.
- Test on a **dummy load** before radiating ([docs/testing/CHECKLIST.md](docs/testing/CHECKLIST.md), sections G and H) and keep a physical way to cut the PA
  (power supply or RF switch) that does not depend on software.
- Keep `tx.enabled` at `false` unless you intend to transmit. Keep `GOOGLE_CLIENT_SECRET` and `BRICOHAMS_SECRETS_KEY` private and back up the key.
- Keep the system, Node.js (when run from source), SDRangel and your reverse proxy updated.
- Review `audit.log` periodically.

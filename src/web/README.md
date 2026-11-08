# src/web: PWA

Static files in `public/`, served by `src/server/app.js` with a self-only CSP. No build step, no CDN.

| File | Purpose |
|---|---|
| `index.html` | Shell: login, radio, log, settings views. No inline script/style. |
| `app.js` | Classic script: API, WS control channel, spectrum/waterfall, tuning, PTT, log, settings. |
| `rx-player.js` | AudioWorklet: jitter buffer for 12 kHz RX audio. |
| `mic-capture.js` | AudioWorklet: mic downsampled to 12 kHz s16, 20 ms frames. |
| `service-worker.js` | Caches static assets only; never `/api`, `/auth` or WebSocket. |
| `styles.css`, `manifest.webmanifest`, `icon*.svg`, `help.html` | Look, install metadata, icons, help. |

Invariants: all server data is rendered via `textContent`; the mic is opened only after the turn is granted and
released when the turn ends; key-up on blur/hidden/pagehide; mic frames are sent only in `TX_ON`.

Test: `node --test test/unit/web-public.test.js` (compiles every `.js`, checks manifest, local references and CSP-friendliness).

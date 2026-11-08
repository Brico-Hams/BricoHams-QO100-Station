# 0018. Plugin API: frozen client plugins and signed webhooks, no server-side code plugins

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
Other SDR programs offer plugins. BricoHams controls a transmitter shared by several users, so any extension point must not be able to key TX, read the microphone, steal session tokens or run arbitrary code on the station.

## Decision
- **Client plugins:** static ES modules in `plugins/<name>/index.js`, installed by the owner and listed in `plugins.enabled`. The PWA (`plugin-loader.js`) loads only enabled names (`GET /api/plugins`), served by `/plugins/<name>/...` with a strict path whitelist. Each plugin gets a **frozen** API: read-only subscriptions (`frequency`, `mode`, `beacon`, `spots`, `decodes`), panel registration, `requestTune` (the normal role-checked API; RX only) and log-form prefill. No PTT, microphone, tokens or raw WebSocket are exposed. CSP stays `self`-only.
- **Server side:** no code plugins. Instead an outgoing, owner-configured webhook feed (`decode`, `spot`, `qso_logged`, `ptt_state`), HMAC-SHA256 signed (`X-BricoHams-Signature`, `X-BricoHams-Timestamp`), with retries and exponential backoff, `https` required (loopback excepted), no redirects.

## Alternatives considered
- **Server-side JS plugins** (`import()` of owner files, `vm`, worker threads): they share the process with the PTT state machine and the secrets; `vm` is not a security boundary. A bug or a malicious plugin could key the transmitter, which is a legal and safety risk. Rejected.
- **Child process with IPC:** more isolation but heavy to document and test; webhooks cover the real use cases.
- **Inbound plugin API (commands):** rejected; the feed is one-way.

## Consequences
- Client plugins are same-origin code installed by the owner: the freeze reduces the surface and prevents accidents but is **not a sandbox**. Only install plugins you trust.
- Integrations that need to act on the station must call the normal authenticated API as a user.

# 0010. OpenWebRX+ plugin is receive-only

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
Many stations expose a public OpenWebRX+ receiver. A QO-100 plugin helps visitors find the beacon, the band plan and the segments. Public pages must never be a path to the transmitter.

## Decision
`plugins/openwebrx/bricohams.js` is a client-side plugin that provides QO-100 bookmarks, downlink/uplink conversion, the band plan and an optional link (`window.BRICOHAMS_PWA_URL`) to the authenticated BricoHams PWA. It makes no network calls, has no microphone access and contains no TX, PTT or log code; a unit test fails if such references appear. Operation requires logging in to the PWA.

## Alternatives considered
- **Embedding the PWA in OpenWebRX+**: mixes origins and auth; widens attack surface; also blocked by frame-ancestors and CSP.
- **A TX-capable plugin with its own login**: duplicates the security model.
- **No plugin**: loses a cheap way to help visitors.

## Consequences
- Public RX and private TX stay separated by origin and authentication.
- The plugin is GPL-3.0-or-later while OpenWebRX+ is AGPL-3.0; the combined deployment is subject to the AGPL network clause.
- Installation paths and the plugin loading mechanism are unverified against the installed OpenWebRX+ version.

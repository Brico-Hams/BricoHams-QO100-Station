# src/cluster — DX cluster spots and QO-100 activity calendar

![BricoHams](../../branding/bricohams_horizontal.png)

BricoHams · Amateur radio · Do it yourself · https://bricohams.org — authors Anatol EA5KAO, Diego EA5JEF, Pedro Roca Molina.

Both features are **disabled by default** and never open an outbound connection unless the owner enables them in `config.json`
(`cluster.enabled`, `calendar.enabled`). Nothing here can key the transmitter: a spot click only tunes the **RX**.

## Public API

| Export | Purpose |
|---|---|
| `parseSpotLine(line)` (`parser.js`) | Parses a `DX de CALL: freq DX comment time` line (kHz). Returns `{spotter, dx, downlinkHz, comment, time}` or `null`. Frequencies in the NB downlink 10489.5–10490.0 MHz are kept; uplink 2400.0–2400.5 MHz is converted with the 8,089,500,000 Hz offset; everything else is dropped. |
| `createSpotStore()` (`spots.js`) | Bounded, de-duplicated list of recent spots. |
| `createClusterClient(opts)` (`client.js`) | Telnet client over `node:net` (injectable `connect`/`timers`): login with the configured callsign, line parser, reconnect with exponential backoff (`backoffDelay`), `postSpot` only if `postSpots` is on. |
| `parseIcs(text, opts)` (`ics.js`) | Minimal RFC 5545 VEVENT parser (folded lines, UTC, `TZID` basic, all-day, safe `URL`). RRULE is **not** expanded. |
| `createCalendar(opts)` (`calendar.js`) | Owner-enabled `.ics` fetch (timeout, size limit) or upload; `upcoming()`. |
| `createClusterApi(deps)` (`routes.js`) | HTTP handlers `GET/POST /api/spots`, `GET /api/calendar`, owner `POST /api/calendar/refresh|upload`. |

## Invariants

- Out-of-band spots never reach the store, the WebSocket or the webhooks.
- Callsign and host come from config; no secret is logged.
- Posting a spot needs `cluster.postSpots` **and** the operator role **and** CSRF.
- The calendar fetch has a timeout, a byte limit and accepts `http(s)` only; event URLs are shown only if `http(s)`.

## Testing

`node --test test/unit/phase13.test.js test/functional/phase13.test.js` — fake socket and fake timers, no network.

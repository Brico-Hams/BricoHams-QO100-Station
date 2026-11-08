# 0005. Fail-safe PTT state machine with a single turn

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
A remote PTT can leave a carrier on the satellite if the browser crashes, the network drops or a bug occurs. Only one person can transmit on a station at a time. Safety must not rely on the client behaving.

## Decision
A server-side state machine (`src/ptt/index.js`) with states `TX_OFF`, `ARMED`, `TX_ON`, `LOCKOUT`:
- `tx.enabled` must be true; only `operator`/`owner` can request the turn; one holder at a time, identified by connection id.
- While holding the turn the client sends a heartbeat every 500 ms; the server watchdog fires at 75 % of `tx.heartbeatTimeoutMs` (maximum 2000 ms), so the carrier is cut in under 2 s. Closing the WebSocket releases the turn.
- TOT (default 600 s) and an armed-inactivity timeout (default 120 s).
- The `tx_on` audit record must be written before keying; failure refuses TX.
- The carrier is switched off *before* state, audit or events are updated. If SDRangel does not confirm "off" (or any driver error), the state is `LOCKOUT`, cleared only by an owner from a local (loopback) client.
- Mic audio is forwarded only from the holder while `TX_ON`.
- TX is off by default and is enabled only in local configuration.

## Alternatives considered
- **Client-side timers only**: a dead client cannot stop itself; rejected.
- **Free-for-all push to talk with last-wins**: causes collisions and accidental takeovers.
- **Queue of operators**: more complex and unnecessary for a single-station use.
- **Hardware watchdog only**: recommended in addition (see SECURITY.md) but cannot know who is authorised.
- **Auto-recovery from LOCKOUT after a delay**: could re-key a faulty chain; a human must look.

## Consequences
- Worst-case unwanted carrier after connection loss is below 2 s (when SDRangel obeys the stop; verify that stopping the TX device removes the carrier on real hardware).
- A flaky link causes turn loss; operators must re-arm.
- LOCKOUT needs physical/local access, which is intentional.
- Behind a same-host reverse proxy the "local" check can be fooled; block the reset route in the proxy.

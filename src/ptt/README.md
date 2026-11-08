# ptt

Push-to-talk state machine with exclusive turn, heartbeat watchdog, TOT and LOCKOUT.

## States
`TX_OFF` -> (`requestTurn`) -> `ARMED` -> (`keyDown`) -> `TX_ON` -> (`keyUp`) -> `ARMED` -> (`release`) -> `TX_OFF`.
`LOCKOUT` is entered on a driver failure or `fault()`; only `ownerReset(actor, {code})` by an owner with the current one-time code leaves it.

## Public API
- `createPtt({tx, driver, audit?, clock?, logger?, resetCode?})` returns a `Ptt` (EventEmitter, event `state`).
  Methods: `requestTurn(actor)`, `heartbeat(id)`, `keyDown(id)`, `keyUp(id)`, `release(id, reason)`, `fault(reason)`,
  `ownerReset(actor, {code})` (reasons `not_locked`, `forbidden`, `reset_unavailable`, `bad_code`, `driver_error`), `snapshot()`, `dispose()`.
- `createResetCode({path, maxBadAttempts?, logger?})` (`reset-code.js`): `rotate()` writes a fresh random 8-digit code to `path`
  (mode 0600 where supported; logs only the path), `check(code)` constant-time compare (rotates after 5 wrong tries), `consume()` single use.
- `driver`: `{setTx(on): Promise<void>}`; must reject on failure. `createUnavailableDriver()` refuses to key.
- `clock`: `{now, setTimeout, clearTimeout}`; inject `FakeClock` from `test/fixtures/fakes.js`.
- `createFileAudit({path})` (`audit.js`): append-only JSON lines (`ts`, `event`, `email`, `callsign`, `reason`, `durationMs`).

## Invariants
- `tx.enabled === false`: every turn request is refused and the driver is never touched.
- One holder at a time (identified by connection id); listeners cannot hold the turn.
- The watchdog fires at 75% of `heartbeatTimeoutMs`, so the cut is always below the timeout; clients send heartbeats every 500 ms.
- The carrier is switched off before state, audit or events are updated. A failed "off" command means LOCKOUT.
- TX is refused if the audit record for `tx_on` cannot be written.
- TOT, ARMED inactivity (`armedTimeoutSeconds`) and heartbeat loss release the turn (TX_OFF); time alone never clears LOCKOUT.
- The reset code never depends on the request's peer address; it is rotated on every LOCKOUT, consumed by a successful (or driver-failed) reset, and never logged.

## Testing
`node --test test/unit/ptt.test.js test/unit/cli.test.js`

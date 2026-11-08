# ptt

Push-to-talk state machine with exclusive turn, heartbeat watchdog, TOT and LOCKOUT.

## States
`TX_OFF` -> (`requestTurn`) -> `ARMED` -> (`keyDown`) -> `TX_ON` -> (`keyUp`) -> `ARMED` -> (`release`) -> `TX_OFF`.
`LOCKOUT` is entered on a driver failure or `fault()`; only `ownerReset(actor, {local:true})` by an owner leaves it.

## Public API
- `createPtt({tx, driver, audit?, clock?, logger?})` returns a `Ptt` (EventEmitter, event `state`).
  Methods: `requestTurn(actor)`, `heartbeat(id)`, `keyDown(id)`, `keyUp(id)`, `release(id, reason)`, `fault(reason)`,
  `ownerReset(actor, {local})`, `snapshot()`, `dispose()`.
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

## Testing
`node --test test/unit/ptt.test.js`

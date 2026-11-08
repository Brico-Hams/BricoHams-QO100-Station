# 0012. RIT, XIT and TX-follows-RX lock

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
On QO-100 the uplink and downlink are separate; operators routinely need a small receive offset (RIT), a small transmit offset (XIT), split operation to answer a station on another frequency, and a way to hear their own downlink signal. Established programs (SDRuno, HDSDR, SDR Console: ideas only) offer RIT/XIT and split.

## Decision
- `station.tuning()` computes, from the dial (downlink) frequency, `ritHz`, `xitHz` and the lock state: `rxHz` (RX channel), `txDownlinkHz` (what the TX should appear at in the downlink) and `uplinkHz`. Pure maths lives in `src/modes/rit.js`.
- RIT moves only the RX channel offset. XIT and an unlocked TX move only the SSBMod channel offset; the TX device centre stays on the beacon-corrected uplink.
- Offsets are integers within ±9999 Hz; RX and TX frequencies must stay inside the narrow-band range (400 `offset_out_of_range`, `tx_frequency_out_of_range`).
- `txFollowsRx` defaults to `true` (TX = dial + XIT). `POST /api/txlock {locked:false, txDownlinkHz}` enables split.
- `ownSignalOffsetHz = txDownlinkHz − rxHz` is reported so the PWA can tell the operator where to listen to their own signal.
- While the carrier is up (`isTxActive()`), changes to the TX channel are stored and applied only after release (`txDirty`). No endpoint changes the radiated frequency during transmission.
- Failed requests restore the previous state. With RIT/XIT at 0 and the lock on, SDRangel patches are identical to before.

## Alternatives considered
- **Move the whole dial for RIT**: changes the TX frequency; wrong for RIT.
- **Retune the TX device**: slow and glitchy; the channel offset is enough for ±10 kHz.
- **Apply changes immediately while keyed**: risks radiating on an unintended frequency.

## Consequences
- The PTT rules of ADR 0005 are untouched.
- Spectrum markers show RX and TX when they differ.

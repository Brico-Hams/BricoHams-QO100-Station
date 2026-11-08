import { downlinkToUplink } from './frequencies.js';

/** Largest RIT/XIT shift in either direction (Hz). */
export const MAX_OFFSET_HZ = 9999;

/**
 * Whether a RIT/XIT value is acceptable.
 * @param {unknown} hz
 * @returns {boolean} True for an integer within +-MAX_OFFSET_HZ.
 */
export function isValidOffset(hz) {
  return Number.isInteger(hz) && Math.abs(hz) <= MAX_OFFSET_HZ;
}

/**
 * Resolve the RX and TX frequencies from the dial, RIT, XIT and the TX lock.
 *
 * RIT shifts only what is heard; XIT shifts only what is sent. With the lock on (TX follows RX) the transmitter
 * tracks the dial, with it off (split) it stays at `txDialHz`. `ownSignalOffsetHz` is where the operator's own
 * downlink lands relative to the frequency being listened to: 0 means the own signal is heard on the carrier,
 * a non-zero value is the pitch shift of the monitoring.
 * @param {{dialHz: number, txDialHz?: number|null, ritHz?: number, xitHz?: number, txFollowsRx?: boolean}} p
 * @returns {{rxHz: number, txDownlinkHz: number, uplinkHz: number, ownSignalOffsetHz: number}}
 */
export function computeTuning({ dialHz, txDialHz = null, ritHz = 0, xitHz = 0, txFollowsRx = true }) {
  const rxHz = dialHz + ritHz;
  const txBase = txFollowsRx || txDialHz === null ? dialHz : txDialHz;
  const txDownlinkHz = txBase + xitHz;
  return {
    rxHz,
    txDownlinkHz,
    uplinkHz: downlinkToUplink(txDownlinkHz),
    ownSignalOffsetHz: txDownlinkHz - rxHz,
  };
}

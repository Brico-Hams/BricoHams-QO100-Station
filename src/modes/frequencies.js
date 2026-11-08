/** Nominal downlink frequency of the QO-100 NB BPSK beacon (Hz). */
export const BEACON_DOWNLINK_HZ = 10_489_750_000;

/** Downlink minus uplink for the QO-100 NB transponder (Hz): 10489.750 - 2400.250 MHz. */
export const TRANSPONDER_OFFSET_HZ = 8_089_500_000;

/** Default LNB local oscillator (Hz); IF = downlink - LO, so the beacon sits at 739.750 MHz. */
export const DEFAULT_LNB_LO_HZ = 9_750_000_000;

/**
 * Downlink to uplink frequency.
 * @param {number} downlinkHz
 * @returns {number} Uplink frequency in Hz.
 */
export function downlinkToUplink(downlinkHz) {
  return downlinkHz - TRANSPONDER_OFFSET_HZ;
}

/**
 * Uplink to downlink frequency.
 * @param {number} uplinkHz
 * @returns {number} Downlink frequency in Hz.
 */
export function uplinkToDownlink(uplinkHz) {
  return uplinkHz + TRANSPONDER_OFFSET_HZ;
}

/**
 * Downlink to the receiver IF behind the LNB.
 * @param {number} downlinkHz
 * @param {number} [lnbLoHz]
 * @returns {number} IF in Hz.
 */
export function downlinkToIf(downlinkHz, lnbLoHz = DEFAULT_LNB_LO_HZ) {
  return downlinkHz - lnbLoHz;
}

/**
 * Receiver IF to downlink frequency.
 * @param {number} ifHz
 * @param {number} [lnbLoHz]
 * @returns {number} Downlink frequency in Hz.
 */
export function ifToDownlink(ifHz, lnbLoHz = DEFAULT_LNB_LO_HZ) {
  return ifHz + lnbLoHz;
}

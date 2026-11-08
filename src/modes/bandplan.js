import { downlinkToUplink } from './frequencies.js';

// verify: QO-100 NB transponder band plan (AMSAT-DL / IARU Region 1), downlink frequencies in Hz.
/** Segment edges are inclusive at the start and exclusive at the end. */
export const BAND_PLAN = Object.freeze([
  Object.freeze({ name: 'cw', startHz: 10_489_505_000, endHz: 10_489_540_000, modes: Object.freeze(['CW']) }),
  Object.freeze({ name: 'digital', startHz: 10_489_540_000, endHz: 10_489_650_000, modes: Object.freeze(['FT8', 'FT4']) }),
  Object.freeze({ name: 'ssb', startHz: 10_489_650_000, endHz: 10_489_990_000, modes: Object.freeze(['USB']) }),
]);

// verify: the CW beacons sit at the transponder edges; the BPSK beacon is the centre reference.
/** Reference markers drawn on the spectrum (downlink, Hz). */
export const BAND_MARKERS = Object.freeze([
  Object.freeze({ name: 'CW beacon (low)', hz: 10_489_500_000, kind: 'cw-beacon' }),
  Object.freeze({ name: 'BPSK beacon', hz: 10_489_750_000, kind: 'bpsk-beacon' }),
  Object.freeze({ name: 'CW beacon (high)', hz: 10_490_000_000, kind: 'cw-beacon' }),
]);

/**
 * Band plan description sent to the PWA for the spectrum overlay.
 * @returns {{segments: object[], markers: object[]}} Plain copies, safe to serialize.
 */
export function describeBandPlan() {
  return {
    segments: BAND_PLAN.map((s) => ({ name: s.name, startHz: s.startHz, endHz: s.endHz, modes: [...s.modes] })),
    markers: BAND_MARKERS.map((m) => ({ ...m })),
  };
}

/** Default FT8 and FT4 dial frequencies (downlink, Hz), inside the digital segment. */
// verify: operators agree on these locally; adjust to the current QO-100 digital calling frequencies.
export const DEFAULT_DIAL_HZ = Object.freeze({
  CW: 10_489_525_000,
  FT8: 10_489_540_000,
  FT4: 10_489_560_000,
  USB: 10_489_700_000,
});

/**
 * Segment containing a downlink frequency.
 * @param {number} downlinkHz
 * @returns {{name: string, startHz: number, endHz: number, modes: readonly string[]}|null} null when outside the plan.
 */
export function segmentFor(downlinkHz) {
  return BAND_PLAN.find((s) => downlinkHz >= s.startHz && downlinkHz < s.endHz) ?? null;
}

/**
 * Whether a mode is allowed at a downlink frequency, and the matching uplink.
 * @param {number} downlinkHz
 * @param {string} mode One of USB, CW, FT8, FT4.
 * @returns {{ok: boolean, segment: string|null, uplinkHz: number, reason?: string}}
 */
export function checkTransmit(downlinkHz, mode) {
  const seg = segmentFor(downlinkHz);
  const uplinkHz = downlinkToUplink(downlinkHz);
  if (!seg) return { ok: false, segment: null, uplinkHz, reason: 'outside_band_plan' };
  if (!seg.modes.includes(mode)) return { ok: false, segment: seg.name, uplinkHz, reason: 'mode_not_in_segment' };
  return { ok: true, segment: seg.name, uplinkHz };
}

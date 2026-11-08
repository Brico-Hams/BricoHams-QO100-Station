import { BAND_PLAN } from '../modes/bandplan.js';
import { downlinkToUplink, uplinkToDownlink } from '../modes/frequencies.js';

const NB_MIN_HZ = BAND_PLAN[0].startHz;
const NB_MAX_HZ = BAND_PLAN.at(-1).endHz;
const UPLINK_MIN_HZ = NB_MIN_HZ - (uplinkToDownlink(0));
const UPLINK_MAX_HZ = NB_MAX_HZ - (uplinkToDownlink(0));
const CALL_RE = /^[A-Z0-9/]{3,14}$/;
const SPOT_RE = /^DX de ([A-Z0-9/#-]{3,16}):?\s+(\d{3,9}(?:\.\d{1,3})?)\s+([A-Z0-9/]{3,14})(?:\s+(.*))?$/i;
const TIME_RE = /(?:^|\s)(\d{2})(\d{2})Z(?:\s|$)/;

/** Callsign check used for the DX call of spots (uppercase letters, digits and `/`). @param {unknown} s @returns {boolean} */
export const isCallsign = (s) => typeof s === 'string' && CALL_RE.test(s);

/** Remove control characters and cap the length of free text received from the network. */
export function cleanText(s, max = 80) {
  return String(s ?? '').replace(/[\p{Cc}\u2028\u2029]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Convert a spot frequency to the QO-100 NB downlink. Accepts a downlink inside the NB transponder or an uplink 2400.0-2400.5 MHz
 * (converted with the transponder offset). Anything else is out of band.
 * @param {number} hz Frequency in Hz.
 * @returns {{downlinkHz: number, uplinkHz: number, given: 'downlink'|'uplink'}|null}
 */
export function toQo100Downlink(hz) {
  if (!Number.isFinite(hz)) return null;
  const f = Math.round(hz);
  if (f >= NB_MIN_HZ && f < NB_MAX_HZ) return { downlinkHz: f, uplinkHz: downlinkToUplink(f), given: 'downlink' };
  if (f >= UPLINK_MIN_HZ && f < UPLINK_MAX_HZ) return { downlinkHz: uplinkToDownlink(f), uplinkHz: f, given: 'uplink' };
  return null;
}

/**
 * Parse one `DX de` cluster line.
 * @param {string} line
 * @param {number} [nowMs] Used to turn the `HHMMZ` stamp into the most recent matching UTC instant.
 * @returns {{spotter: string, freqKhz: number, dx: string, comment: string, time: number|null}|null} `null` if the line is not a spot.
 */
export function parseSpotLine(line, nowMs = Date.now()) {
  if (typeof line !== 'string' || line.length > 300) return null;
  const m = SPOT_RE.exec(line.trim());
  if (!m) return null;
  const freqKhz = Number(m[2]);
  if (!Number.isFinite(freqKhz)) return null;
  const rest = m[4] ?? '';
  const t = TIME_RE.exec(rest);
  let time = null;
  if (t) {
    const hh = Number(t[1]);
    const mm = Number(t[2]);
    if (hh < 24 && mm < 60) {
      const d = new Date(nowMs);
      let ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm);
      if (ms > nowMs + 3_600_000) ms -= 86_400_000;
      time = ms;
    }
  }
  const comment = t ? rest.slice(0, t.index) : rest;
  return { spotter: m[1].toUpperCase(), freqKhz, dx: m[3].toUpperCase(), comment: cleanText(comment, 60), time };
}

/**
 * Parse a cluster line and keep it only if it is a QO-100 NB spot.
 * @param {string} line
 * @param {number} [nowMs]
 * @returns {{spotter: string, dx: string, downlinkHz: number, uplinkHz: number, given: string, comment: string, time: number}|null}
 */
export function parseQo100Spot(line, nowMs = Date.now()) {
  const s = parseSpotLine(line, nowMs);
  if (!s) return null;
  const f = toQo100Downlink(s.freqKhz * 1000);
  if (!f) return null;
  return { spotter: s.spotter, dx: s.dx, downlinkHz: f.downlinkHz, uplinkHz: f.uplinkHz, given: f.given, comment: s.comment, time: s.time ?? nowMs };
}

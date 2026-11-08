import { BEACON_DOWNLINK_HZ, DEFAULT_LNB_LO_HZ, downlinkToIf } from '../modes/frequencies.js';

const DEFAULT_SEARCH_HZ = 10_000;
const DEFAULT_MIN_SNR_DB = 10;

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Locate the beacon peak in an FFT power array and return its offset from the expected frequency.
 * Bin i is centred on `centerHz + (i - N/2) * binHz` (standard fftshifted layout).
 * @param {{powersDb: ArrayLike<number>, centerHz: number, binHz: number, expectedHz: number,
 *   searchHz?: number, minSnrDb?: number}} p `powersDb` must be on a logarithmic scale (dB or dBFS).
 * @returns {{found: false, reason: string} | {found: true, offsetHz: number, peakHz: number, snrDb: number}}
 */
export function estimateBeaconOffset({ powersDb, centerHz, binHz, expectedHz, searchHz = DEFAULT_SEARCH_HZ, minSnrDb = DEFAULT_MIN_SNR_DB }) {
  const n = powersDb?.length ?? 0;
  if (n < 8 || !(binHz > 0) || !Number.isFinite(centerHz) || !Number.isFinite(expectedHz)) return { found: false, reason: 'bad_input' };
  const expectedBin = n / 2 + (expectedHz - centerHz) / binHz;
  const radius = Math.max(2, Math.ceil(searchHz / binHz));
  const lo = Math.max(1, Math.ceil(expectedBin - radius));
  const hi = Math.min(n - 2, Math.floor(expectedBin + radius));
  if (hi - lo < 2) return { found: false, reason: 'outside_span' };

  let peak = lo;
  const window = [];
  for (let i = lo; i <= hi; i++) {
    const v = powersDb[i];
    if (!Number.isFinite(v)) return { found: false, reason: 'bad_input' };
    window.push(v);
    if (v > powersDb[peak]) peak = i;
  }
  // Checked before the edge test so that pure noise is reported as low SNR regardless of where its maximum falls.
  const snrDb = powersDb[peak] - median(window);
  if (snrDb < minSnrDb) return { found: false, reason: 'low_snr' };
  // A maximum on the window edge is a slope of something outside the window, not our beacon.
  if (peak === lo || peak === hi) return { found: false, reason: 'no_peak' };

  const a = powersDb[peak - 1];
  const b = powersDb[peak];
  const c = powersDb[peak + 1];
  const denom = a - 2 * b + c;
  const delta = denom === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom));
  const peakHz = centerHz + (peak + delta - n / 2) * binHz;
  return { found: true, offsetHz: peakHz - expectedHz, peakHz, snrDb };
}

/**
 * Filter turning raw per-frame measurements into a stable offset with lock/unlock hysteresis.
 * Median of the last N detections removes outliers; an EMA smooths the rest. Lock needs `lockCount`
 * consecutive detections, unlock needs `unlockCount` consecutive misses (single misses are ridden out).
 * @param {{medianSize?: number, alpha?: number, lockCount?: number, unlockCount?: number}} [opts]
 * @returns {{update(offsetHz: number|null): {status: 'locked'|'no-lock', offsetHz: number|null}, reset(): void}}
 */
export function createBeaconFilter({ medianSize = 5, alpha = 0.3, lockCount = 3, unlockCount = 5 } = {}) {
  let window = [];
  let ema = null;
  let hits = 0;
  let misses = 0;
  let locked = false;

  const reset = () => {
    window = [];
    ema = null;
    hits = 0;
    misses = 0;
    locked = false;
  };

  return {
    reset,
    update(offsetHz) {
      if (offsetHz === null || !Number.isFinite(offsetHz)) {
        hits = 0;
        misses++;
        if (locked && misses >= unlockCount) reset();
      } else {
        misses = 0;
        hits++;
        window.push(offsetHz);
        if (window.length > medianSize) window.shift();
        const m = median(window);
        ema = ema === null ? m : ema + alpha * (m - ema);
        if (!locked && hits >= lockCount) locked = true;
      }
      return { status: locked ? 'locked' : 'no-lock', offsetHz: locked ? ema : null };
    },
  };
}

/**
 * Beacon controller: reads a spectrum frame, estimates and filters the offset, and applies the correction
 * through the station (RX and TX). Without lock nothing is written to SDRangel.
 * @param {{getSpectrum: () => Promise<{powersDb: ArrayLike<number>, centerHz: number, binHz: number}|null>,
 *   station: {setCorrection(hz: number, source: string): Promise<void>},
 *   lnbLoHz?: number, expectedDownlinkHz?: number, searchHz?: number, minSnrDb?: number, deadbandHz?: number,
 *   filter?: object, onStatus?: (status: object) => void, logger?: {error: Function}}} opts
 * `getSpectrum` returns the IF spectrum (centre = RX centre frequency, in Hz of IF).
 * @returns {{step(): Promise<object>, status(): object}}
 */
export function createBeaconController({
  getSpectrum, station, lnbLoHz = DEFAULT_LNB_LO_HZ, expectedDownlinkHz = BEACON_DOWNLINK_HZ,
  searchHz, minSnrDb, deadbandHz = 2, filter = {}, onStatus = () => {}, logger = console,
}) {
  const flt = createBeaconFilter(filter);
  const expectedIfHz = downlinkToIf(expectedDownlinkHz, lnbLoHz);
  let current = { status: 'no-lock', offsetHz: null, appliedHz: 0, snrDb: null, reason: 'no_data', updatedAt: null };

  const publish = (next) => {
    const changed = next.status !== current.status || next.appliedHz !== current.appliedHz;
    current = { ...next, updatedAt: Date.now() };
    if (changed) {
      try {
        onStatus({ ...current });
      } catch (err) {
        logger.error('beacon: status listener failed:', err.message);
      }
    }
  };

  return {
    /**
     * Process one spectrum frame.
     * @returns {Promise<object>} Beacon status after the frame.
     */
    async step() {
      let frame = null;
      try {
        frame = await getSpectrum();
      } catch (err) {
        logger.error('beacon: spectrum source failed:', err.message);
      }
      // The spectrum is of the IF, so the beacon is expected at IF = downlink - LO.
      const est = frame
        ? estimateBeaconOffset({ ...frame, expectedHz: expectedIfHz, searchHz, minSnrDb })
        : { found: false, reason: 'no_data' };
      const filtered = flt.update(est.found ? est.offsetHz : null);

      let appliedHz = current.appliedHz;
      let reason = est.found ? null : est.reason;
      if (filtered.status === 'locked' && Math.abs(filtered.offsetHz - appliedHz) >= deadbandHz) {
        try {
          await station.setCorrection(filtered.offsetHz, 'beacon');
          appliedHz = Math.round(filtered.offsetHz * 10) / 10;
        } catch (err) {
          logger.error('beacon: applying correction failed:', err.message);
          reason = 'apply_failed';
        }
      }
      publish({
        status: filtered.status,
        offsetHz: filtered.offsetHz,
        appliedHz,
        snrDb: est.found ? est.snrDb : null,
        reason,
      });
      return current;
    },

    /** @returns {{status: string, offsetHz: number|null, appliedHz: number, snrDb: number|null, reason: string|null, updatedAt: number|null}} */
    status: () => ({ ...current }),
  };
}

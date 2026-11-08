/** Default notch state: off, 1 kHz, 50 Hz wide, auto-notch off. */
export const DEFAULT_NOTCH = Object.freeze({ enabled: false, offsetHz: 1000, widthHz: 50, auto: false });

/** Audio-frequency range (Hz) a notch may sit in; the RX audio is 12 kHz sampled so 6 kHz is Nyquist. */
export const NOTCH_RANGE = Object.freeze({ minHz: 20, maxHz: 5900, minWidthHz: 10, maxWidthHz: 1000 });

// verify against SDRangel swagger: stock SSBDemod has no notch; these names only apply to builds/plugins that do.
/** SSBDemod channel keys used when `station.notchEngine` is `sdrangel`. */
export const SDRANGEL_NOTCH_KEYS = Object.freeze({ enabled: 'notchFilterEnabled', offsetHz: 'notchFrequency', widthHz: 'notchBandwidth', auto: 'autoNotch' });

/**
 * Validate a (partial) notch request and merge it over the current state.
 * @param {object} partial Fields `enabled`, `auto` (booleans), `offsetHz`, `widthHz` (integers).
 * @param {{enabled: boolean, offsetHz: number, widthHz: number, auto: boolean}} [current]
 * @returns {{ok: true, value: object} | {ok: false, code: string}} Never throws.
 */
export function parseNotch(partial, current = DEFAULT_NOTCH) {
  if (partial === null || typeof partial !== 'object' || Array.isArray(partial)) return { ok: false, code: 'bad_notch' };
  const next = { ...current };
  for (const key of Object.keys(partial)) {
    if (!(key in DEFAULT_NOTCH)) return { ok: false, code: 'bad_notch' };
  }
  for (const key of ['enabled', 'auto']) {
    if (partial[key] === undefined) continue;
    if (typeof partial[key] !== 'boolean') return { ok: false, code: 'bad_notch' };
    next[key] = partial[key];
  }
  if (partial.offsetHz !== undefined) {
    const v = partial.offsetHz;
    if (!Number.isInteger(v) || v < NOTCH_RANGE.minHz || v > NOTCH_RANGE.maxHz) return { ok: false, code: 'bad_notch_frequency' };
    next.offsetHz = v;
  }
  if (partial.widthHz !== undefined) {
    const v = partial.widthHz;
    if (!Number.isInteger(v) || v < NOTCH_RANGE.minWidthHz || v > NOTCH_RANGE.maxWidthHz) return { ok: false, code: 'bad_notch_width' };
    next.widthHz = v;
  }
  return { ok: true, value: next };
}

/**
 * Map a notch state to SSBDemod channel settings (only meaningful with the `sdrangel` engine).
 * @param {{enabled: boolean, offsetHz: number, widthHz: number, auto: boolean}} notch
 * @returns {object}
 */
export function notchToChannelSettings(notch) {
  const out = {};
  for (const [k, key] of Object.entries(SDRANGEL_NOTCH_KEYS)) out[key] = notch[k];
  return out;
}

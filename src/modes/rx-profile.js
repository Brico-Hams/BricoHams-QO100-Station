// The RX audio leaves SDRangel through a UDPSink (include/UDPSink.yaml), which has rfBandwidth but no lowCutoff:
// only `rfBandwidth` of these presets reaches SDRangel on RX; `lowCutoff` is kept for the TX UDPSource/SSBMod and documentation.

/** RX passband presets per mode. `rfBandwidth` is the upper edge, `lowCutoff` the lower edge (Hz). */
export const FILTER_PRESETS = Object.freeze({
  USB: Object.freeze({
    narrow: Object.freeze({ rfBandwidth: 2400, lowCutoff: 400 }),
    normal: Object.freeze({ rfBandwidth: 2700, lowCutoff: 300 }),
    wide: Object.freeze({ rfBandwidth: 3000, lowCutoff: 100 }),
  }),
  CW: Object.freeze({
    narrow: Object.freeze({ rfBandwidth: 750, lowCutoff: 450 }),
    normal: Object.freeze({ rfBandwidth: 850, lowCutoff: 350 }),
    wide: Object.freeze({ rfBandwidth: 1100, lowCutoff: 200 }),
  }),
  FT8: Object.freeze({
    normal: Object.freeze({ rfBandwidth: 3000, lowCutoff: 100 }),
    wide: Object.freeze({ rfBandwidth: 3000, lowCutoff: 50 }),
  }),
  FT4: Object.freeze({
    normal: Object.freeze({ rfBandwidth: 3000, lowCutoff: 100 }),
    wide: Object.freeze({ rfBandwidth: 3000, lowCutoff: 50 }),
  }),
});

/** Preset every mode starts with. */
export const DEFAULT_FILTER = 'normal';

/**
 * Preset names available for a mode.
 * @param {string} mode
 * @returns {string[]} Empty for an unknown mode.
 */
export function filterNames(mode) {
  return Object.hasOwn(FILTER_PRESETS, mode) ? Object.keys(FILTER_PRESETS[mode]) : [];
}

/**
 * SSBDemod passband settings of a preset.
 * @param {string} mode
 * @param {string} name
 * @returns {{rfBandwidth: number, lowCutoff: number}|null} null when the mode or preset is unknown.
 */
export function resolveFilter(mode, name) {
  if (!Object.hasOwn(FILTER_PRESETS, mode) || typeof name !== 'string' || !Object.hasOwn(FILTER_PRESETS[mode], name)) return null;
  return { ...FILTER_PRESETS[mode][name] };
}

export const AGC_MODES = Object.freeze(['off', 'slow', 'medium', 'fast']);
export const SQUELCH_MIN_DB = -100;
export const SQUELCH_MAX_DB = 0;

// UDPSinkSettings has a single on/off agc (include/UDPSink.yaml), so slow/medium/fast all mean "on".
const SQUELCH_GATE = 5; // squelchGate unit is 1/100 s (include/UDPSink.yaml)
const DSP_KEYS = Object.freeze(['agc', 'squelchDb', 'noiseReduction']);

/** Receiver settings that apply when nothing was configured. */
export const DEFAULT_RX_DSP = Object.freeze({ agc: 'medium', squelchDb: null, noiseReduction: false });

/**
 * Validate a partial receiver DSP request. `noiseReduction: true` is refused: the RX audio leaves SDRangel through a UDPSink,
 * which has no DNR (only SSBDemod does, and it has no UDP output).
 * @param {unknown} input `{agc?: 'off'|'slow'|'medium'|'fast', squelchDb?: number|null, noiseReduction?: false}`.
 * @returns {{ok: true, value: object}|{ok: false, code: string}} `value` only holds the keys that were present.
 */
export function parseRxDsp(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'bad_dsp' };
  const keys = Object.keys(input);
  if (keys.length === 0 || keys.some((k) => !DSP_KEYS.includes(k))) return { ok: false, code: 'bad_dsp' };
  const value = {};
  if (input.agc !== undefined) {
    if (!AGC_MODES.includes(input.agc)) return { ok: false, code: 'bad_agc' };
    value.agc = input.agc;
  }
  if (input.squelchDb !== undefined) {
    const s = input.squelchDb;
    if (s !== null && (!Number.isInteger(s) || s < SQUELCH_MIN_DB || s > SQUELCH_MAX_DB)) return { ok: false, code: 'bad_squelch' };
    value.squelchDb = s;
  }
  if (input.noiseReduction !== undefined) {
    if (typeof input.noiseReduction !== 'boolean') return { ok: false, code: 'bad_noise_reduction' };
    if (input.noiseReduction) return { ok: false, code: 'dnr_unavailable' };
    value.noiseReduction = false;
  }
  return { ok: true, value };
}

/**
 * Translate receiver DSP settings into UDPSink channel settings (include/UDPSink.yaml: agc, squelchEnabled, squelchDB, squelchGate).
 * @param {{agc?: string, squelchDb?: number|null, noiseReduction?: boolean}} dsp Already validated.
 * @returns {object} Only the keys that correspond to settings present in `dsp`; there is nothing to send for noise reduction.
 */
export function toChannelSettings(dsp) {
  const out = {};
  if (dsp.agc !== undefined) out.agc = dsp.agc === 'off' ? 0 : 1;
  if (dsp.squelchDb !== undefined) {
    if (dsp.squelchDb === null) out.squelchEnabled = 0;
    else Object.assign(out, { squelchEnabled: 1, squelchDB: dsp.squelchDb, squelchGate: SQUELCH_GATE });
  }
  return out;
}

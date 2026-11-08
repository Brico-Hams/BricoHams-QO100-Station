import { BEACON_DOWNLINK_HZ, DEFAULT_LNB_LO_HZ, downlinkToIf, downlinkToUplink } from './frequencies.js';
import { BAND_PLAN, DEFAULT_DIAL_HZ, segmentFor } from './bandplan.js';
import { createDefaultDecoderRegistry } from './decoders.js';
import { computeTuning, isValidOffset } from './rit.js';
import { DEFAULT_FILTER, DEFAULT_RX_DSP, filterNames, parseRxDsp, resolveFilter, toChannelSettings } from './rx-profile.js';
import { DEFAULT_NOTCH, notchToChannelSettings, parseNotch } from './notch.js';

/** Supported operating modes. */
export const MODES = Object.freeze(['USB', 'CW', 'FT8', 'FT4']);

// verify against SDRangel swagger: SSBDemod/SSBMod field names and CW keyer settings.
/** Channel settings applied by each mode. `rx` patches the SSBDemod, `tx` the SSBMod. */
export const MODE_PROFILES = Object.freeze({
  USB: { rx: { rfBandwidth: 2700, lowCutoff: 300 }, tx: { bandwidth: 2700, lowCutoff: 300 } },
  CW: { rx: { rfBandwidth: 850, lowCutoff: 350 }, tx: { bandwidth: 850, lowCutoff: 350 } },
  FT8: { rx: { rfBandwidth: 3000, lowCutoff: 100 }, tx: { bandwidth: 3000, lowCutoff: 100 } },
  FT4: { rx: { rfBandwidth: 3000, lowCutoff: 100 }, tx: { bandwidth: 3000, lowCutoff: 100 } },
});

const RX_CHANNEL = 'SSBDemod';
const TX_CHANNEL = 'SSBMod';
const NB_MIN_HZ = BAND_PLAN[0].startHz;
const NB_MAX_HZ = BAND_PLAN.at(-1).endHz;
const MAX_CORRECTION_HZ = 50_000;

/** Invalid request (bad mode or frequency) rather than an SDRangel failure. */
export class StationError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = 'StationError';
    this.code = code;
  }
}

/**
 * Station controller: owns the tuning state (mode, downlink frequency, beacon correction) and pushes it to SDRangel.
 *
 * The RX device stays centred on the beacon IF (plus the correction) so the spectrum always contains the whole NB
 * transponder; the tuned frequency is the SSB channel's `inputFrequencyOffset` relative to the beacon.
 * With correction `e` (beacon seen at nominal + e): RX centre = beaconIF + e, TX centre = beacon uplink - e.
 * All operations run one at a time so tuning and beacon corrections never interleave.
 * @param {{client: object, rxDeviceSet?: number, txDeviceSet?: number|null, lnbLoHz?: number, applyToTx?: boolean,
 *   isTxActive?: () => boolean, decoders?: ReturnType<typeof createDecoderRegistry>, logger?: {error: Function}}} opts
 * @returns {object}
 */
export function createStation({
  client, rxDeviceSet = 0, txDeviceSet = 1, lnbLoHz = DEFAULT_LNB_LO_HZ, applyToTx = true,
  isTxActive = () => false, decoders = createDefaultDecoderRegistry(), logger = console, notchEngine = 'client',
}) {
  const state = {
    mode: null, downlinkHz: null, correctionHz: 0, correctionSource: 'none',
    ritHz: 0, xitHz: 0, txFollowsRx: true, txDialHz: null, filter: DEFAULT_FILTER, rxDsp: {}, notch: { ...DEFAULT_NOTCH },
  };
  const serverNotch = () => (notchEngine === 'sdrangel' ? notchToChannelSettings(state.notch) : {});
  const channels = { rx: null, tx: null };
  let txDirty = false;
  let queue = Promise.resolve();

  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  const beaconIf = () => downlinkToIf(BEACON_DOWNLINK_HZ, lnbLoHz);
  const beaconUplink = () => downlinkToUplink(BEACON_DOWNLINK_HZ);

  async function ensureChannel(deviceSet, type, direction) {
    const ds = await client.getDeviceSet(deviceSet);
    let idx = (ds.channels ?? []).findLastIndex((c) => c.id === type);
    if (idx < 0) {
      await client.addChannel(deviceSet, type, direction);
      const after = await client.getDeviceSet(deviceSet);
      idx = (after.channels ?? []).findLastIndex((c) => c.id === type);
      if (idx < 0) throw new Error(`SDRangel did not create the ${type} channel`);
    }
    return idx;
  }

  const tuning = () => computeTuning({
    dialHz: state.downlinkHz, txDialHz: state.txDialHz, ritHz: state.ritHz, xitHz: state.xitHz, txFollowsRx: state.txFollowsRx,
  });

  // Both the listened and the transmitted frequency must stay inside the NB transponder, whatever RIT/XIT/split say.
  function checkTuning() {
    const t = tuning();
    if (t.rxHz < NB_MIN_HZ || t.rxHz >= NB_MAX_HZ) throw new StationError('frequency_out_of_range');
    if (t.txDownlinkHz < NB_MIN_HZ || t.txDownlinkHz >= NB_MAX_HZ) throw new StationError('tx_frequency_out_of_range');
  }

  async function applyChannelOffsets() {
    if (state.downlinkHz === null || channels.rx === null) return;
    await client.patchChannelSettings(rxDeviceSet, channels.rx, { inputFrequencyOffset: Math.round(tuning().rxHz - BEACON_DOWNLINK_HZ) });
  }

  async function applyRxCenter() {
    await client.setCenterFrequency(rxDeviceSet, beaconIf() + state.correctionHz);
  }

  async function applyTxCenter() {
    if (txDeviceSet === null) return;
    await client.setCenterFrequency(txDeviceSet, beaconUplink() - (applyToTx ? state.correctionHz : 0));
    if (channels.tx !== null && state.downlinkHz !== null) {
      await client.patchChannelSettings(txDeviceSet, channels.tx, { inputFrequencyOffset: Math.round(tuning().txDownlinkHz - BEACON_DOWNLINK_HZ) });
    }
    txDirty = false;
  }

  // Never retune the transmitter (centre or channel offset) while it is keyed; remember to do it afterwards.
  async function applyTx() {
    if (txDeviceSet === null) return;
    if (isTxActive()) {
      txDirty = true;
      return;
    }
    await applyTxCenter();
  }

  async function doTune(downlinkHz) {
    if (!Number.isFinite(downlinkHz) || downlinkHz < NB_MIN_HZ || downlinkHz >= NB_MAX_HZ) throw new StationError('frequency_out_of_range');
    const rounded = Math.round(downlinkHz);
    const previous = state.downlinkHz;
    state.downlinkHz = rounded;
    try {
      checkTuning();
      await applyRxCenter();
      await applyChannelOffsets();
      await applyTx();
    } catch (err) {
      state.downlinkHz = previous;
      throw err;
    }
  }

  async function doSetMode(mode) {
    if (!MODES.includes(mode)) throw new StationError('unknown_mode');
    const profile = MODE_PROFILES[mode];
    channels.rx = await ensureChannel(rxDeviceSet, RX_CHANNEL, 0);
    await client.patchChannelSettings(rxDeviceSet, channels.rx, { ...profile.rx, ...toChannelSettings(state.rxDsp), ...serverNotch() });
    if (txDeviceSet !== null) {
      channels.tx = await ensureChannel(txDeviceSet, TX_CHANNEL, 1);
      await client.patchChannelSettings(txDeviceSet, channels.tx, profile.tx);
    }
    state.mode = mode;
    state.filter = DEFAULT_FILTER;
    const seg = state.downlinkHz === null ? null : segmentFor(state.downlinkHz);
    await doTune(seg?.modes.includes(mode) ? state.downlinkHz : DEFAULT_DIAL_HZ[mode]);
  }

  const station = {
    /**
     * Tune to a downlink frequency inside the NB transponder.
     * @param {number} downlinkHz
     * @returns {Promise<object>} New status.
     * @throws {StationError} `frequency_out_of_range`.
     */
    tune: (downlinkHz) => serial(async () => {
      await doTune(downlinkHz);
      return station.status();
    }),

    /**
     * Switch mode (configures the SDRangel RX and TX channels) and move to the mode's dial frequency if needed.
     * @param {'USB'|'CW'|'FT8'|'FT4'} mode
     * @returns {Promise<object>} New status.
     * @throws {StationError} `unknown_mode`.
     */
    setMode: (mode) => serial(async () => {
      await doSetMode(mode);
      return station.status();
    }),

    /**
     * Set the frequency correction (beacon drift or a manual LNB offset) and apply it to RX and, when idle, TX.
     * @param {number} hz Observed offset of the beacon from its nominal position.
     * @param {'beacon'|'manual'} [source]
     * @returns {Promise<void>}
     */
    setCorrection: (hz, source = 'beacon') => serial(async () => {
      if (!Number.isFinite(hz) || Math.abs(hz) > MAX_CORRECTION_HZ) throw new StationError('correction_out_of_range');
      const previous = { ...state };
      state.correctionHz = Math.round(hz * 10) / 10;
      state.correctionSource = source;
      try {
        await applyRxCenter();
        await applyTx();
      } catch (err) {
        state.correctionHz = previous.correctionHz;
        state.correctionSource = previous.correctionSource;
        throw err;
      }
    }),

    /**
     * Apply a TX retune deferred because the transmitter was keyed. Call when PTT leaves TX_ON.
     * @returns {Promise<void>}
     */
    onTxIdle: () => serial(async () => {
      if (txDirty && !isTxActive()) {
        try {
          await applyTxCenter();
        } catch (err) {
          logger.error('station: deferred TX retune failed:', err.message);
        }
      }
    }),

    /**
     * Set RIT (shifts the received frequency) and/or XIT (shifts the transmitted one). XIT never retunes a keyed transmitter.
     * @param {{ritHz?: number, xitHz?: number}} offsets Integers within +-9999 Hz.
     * @returns {Promise<object>} New status.
     * @throws {StationError} `not_tuned`, `offset_out_of_range`, `frequency_out_of_range`, `tx_frequency_out_of_range`.
     */
    setOffsets: ({ ritHz, xitHz } = {}) => serial(async () => {
      if (state.downlinkHz === null) throw new StationError('not_tuned');
      if ((ritHz !== undefined && !isValidOffset(ritHz)) || (xitHz !== undefined && !isValidOffset(xitHz))) {
        throw new StationError('offset_out_of_range');
      }
      const previous = { ritHz: state.ritHz, xitHz: state.xitHz };
      state.ritHz = ritHz ?? state.ritHz;
      state.xitHz = xitHz ?? state.xitHz;
      try {
        checkTuning();
        if (state.ritHz !== previous.ritHz) await applyChannelOffsets();
        if (state.xitHz !== previous.xitHz) await applyTx();
      } catch (err) {
        Object.assign(state, previous);
        throw err;
      }
      return station.status();
    }),

    /**
     * Lock the transmit frequency to the receive dial (default) or let it stay where it is (split).
     * Unlocking keeps the transmitter on the current frequency unless `txDownlinkHz` is given. A keyed transmitter is not retuned.
     * @param {{locked: boolean, txDownlinkHz?: number}} opts
     * @returns {Promise<object>} New status.
     * @throws {StationError} `bad_tx_lock`, `not_tuned`, `tx_frequency_out_of_range`.
     */
    setTxLock: ({ locked, txDownlinkHz } = {}) => serial(async () => {
      if (typeof locked !== 'boolean' || (txDownlinkHz !== undefined && !Number.isFinite(txDownlinkHz))) throw new StationError('bad_tx_lock');
      if (state.downlinkHz === null) throw new StationError('not_tuned');
      const previous = { txFollowsRx: state.txFollowsRx, txDialHz: state.txDialHz };
      state.txFollowsRx = locked;
      state.txDialHz = locked ? null : Math.round(txDownlinkHz ?? state.txDialHz ?? state.downlinkHz);
      try {
        checkTuning();
        await applyTx();
      } catch (err) {
        Object.assign(state, previous);
        throw err;
      }
      return station.status();
    }),

    /**
     * Select an RX passband preset of the current mode. Only the receiver is touched, never the transmit filter.
     * @param {string} name e.g. `narrow`, `normal`, `wide`.
     * @returns {Promise<object>} New status.
     * @throws {StationError} `no_mode`, `unknown_filter`.
     */
    setFilter: (name) => serial(async () => {
      if (channels.rx === null || state.mode === null) throw new StationError('no_mode');
      const preset = resolveFilter(state.mode, name);
      if (!preset) throw new StationError('unknown_filter');
      await client.patchChannelSettings(rxDeviceSet, channels.rx, preset);
      state.filter = name;
      return station.status();
    }),

    /**
     * Change AGC, squelch and noise reduction of the RX channel. They are remembered and re-applied after a mode change.
     * @param {{agc?: string, squelchDb?: number|null, noiseReduction?: boolean}} partial
     * @returns {Promise<object>} New status.
     * @throws {StationError} `bad_dsp`, `bad_agc`, `bad_squelch`, `bad_noise_reduction`.
     */
    setRxDsp: (partial) => serial(async () => {
      const parsed = parseRxDsp(partial);
      if (!parsed.ok) throw new StationError(parsed.code);
      if (channels.rx !== null) await client.patchChannelSettings(rxDeviceSet, channels.rx, toChannelSettings(parsed.value));
      Object.assign(state.rxDsp, parsed.value);
      return station.status();
    }),

    /**
     * Set the RX notch / auto-notch. With the `client` engine (default) only the state is kept and the PWA filters the audio;
     * with `sdrangel` the settings are also patched into the RX channel (RX only, never the transmitter).
     * @param {{enabled?: boolean, auto?: boolean, offsetHz?: number, widthHz?: number}} partial
     * @returns {Promise<object>} New status.
     * @throws {StationError} `bad_notch`, `bad_notch_frequency`, `bad_notch_width`.
     */
    setNotch: (partial) => serial(async () => {
      const parsed = parseNotch(partial, state.notch);
      if (!parsed.ok) throw new StationError(parsed.code);
      if (notchEngine === 'sdrangel' && channels.rx !== null) {
        await client.patchChannelSettings(rxDeviceSet, channels.rx, notchToChannelSettings(parsed.value));
      }
      state.notch = parsed.value;
      return station.status();
    }),

    /** @returns {object} Current tuning state. */
    status() {
      const seg = state.downlinkHz === null ? null : segmentFor(state.downlinkHz);
      const decoder = state.mode && state.mode !== 'USB' ? decoders.get(state.mode) : null;
      const t = state.downlinkHz === null ? null : tuning();
      return {
        mode: state.mode,
        downlinkHz: state.downlinkHz,
        uplinkHz: t === null ? null : t.uplinkHz,
        ifHz: state.downlinkHz === null ? null : downlinkToIf(state.downlinkHz, lnbLoHz),
        segment: seg?.name ?? null,
        correctionHz: state.correctionHz,
        correctionSource: state.correctionSource,
        txRetunePending: txDirty,
        decoder: decoder ? { available: decoder.available !== false } : null,
        ritHz: state.ritHz,
        xitHz: state.xitHz,
        txFollowsRx: state.txFollowsRx,
        rxHz: t === null ? null : t.rxHz,
        txDownlinkHz: t === null ? null : t.txDownlinkHz,
        ownSignalOffsetHz: t === null ? null : t.ownSignalOffsetHz,
        filter: state.mode === null ? null : { name: state.filter, available: filterNames(state.mode) },
        rxDsp: { ...DEFAULT_RX_DSP, ...state.rxDsp },
        notch: { ...state.notch, engine: notchEngine },
      };
    },
  };
  return station;
}

import { BEACON_DOWNLINK_HZ, DEFAULT_LNB_LO_HZ, downlinkToIf, downlinkToUplink } from './frequencies.js';
import { BAND_PLAN, DEFAULT_DIAL_HZ, segmentFor } from './bandplan.js';
import { createDefaultDecoderRegistry } from './decoders.js';
import { computeTuning, isValidOffset } from './rit.js';
import { DEFAULT_FILTER, DEFAULT_RX_DSP, filterNames, parseRxDsp, resolveFilter, toChannelSettings } from './rx-profile.js';
import { DEFAULT_NOTCH, parseNotch } from './notch.js';

/** Supported operating modes. */
export const MODES = Object.freeze(['USB', 'CW', 'FT8', 'FT4']);

/**
 * Passband per mode. `rx` goes to the RX UDPSink (`rfBandwidth` only; UDPSink has no lowCutoff), `tx` to the TX UDPSource
 * (`rfBandwidth`, `lowCutoff`; include/UDPSource.yaml) and, in CW, to the SSBMod (`bandwidth`, `lowCutoff`).
 */
export const MODE_PROFILES = Object.freeze({
  USB: { rx: { rfBandwidth: 2700, lowCutoff: 300 }, tx: { rfBandwidth: 2700, lowCutoff: 300 } },
  CW: { rx: { rfBandwidth: 850, lowCutoff: 350 }, tx: { rfBandwidth: 850, lowCutoff: 350 } },
  FT8: { rx: { rfBandwidth: 3000, lowCutoff: 100 }, tx: { rfBandwidth: 3000, lowCutoff: 100 } },
  FT4: { rx: { rfBandwidth: 3000, lowCutoff: 100 }, tx: { rfBandwidth: 3000, lowCutoff: 100 } },
});

/** Audio sample rate of the UDP legs (UDPSink output, UDPSource input), mono s16le. */
export const AUDIO_RATE = 48_000;
/** UDPSink sampleFormat FormatUSBMono (ref: source/udpsinksettings.h). */
export const UDP_SINK_FORMAT_USB_MONO = 7;
/** UDPSource sampleFormat FormatUSB (ref: source/udpsourcesettings.h). */
export const UDP_SOURCE_FORMAT_USB = 3;
/** SSBMod modAFInput CWTone (ref: source/ssbmodsettings.h). */
export const SSBMOD_AF_CW_TONE = 4;

const RX_CHANNEL = 'UDPSink';
const TX_CHANNEL = 'UDPSource';
const CW_CHANNEL = 'SSBMod';
const DEFAULT_AUDIO = Object.freeze({ rxUdp: { host: '127.0.0.1', port: 9998 }, txUdp: { host: '127.0.0.1', port: 9999 } });
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
 * transponder; the tuned frequency is the audio channel's `inputFrequencyOffset` relative to the beacon.
 * With correction `e` (beacon seen at nominal + e): RX centre = beaconIF + e, TX centre = beacon uplink - e.
 * Audio: the RX device set carries a UDPSink (USB demodulated, 48 kHz mono s16le to `audio.rxUdp`), the TX device set a
 * UDPSource (USB, 48 kHz, listening on `audio.txUdp`) plus an SSBMod used only for CW. See `provision()`.
 * All operations run one at a time so tuning and beacon corrections never interleave.
 * @param {{client: object, rxDeviceSet?: number, txDeviceSet?: number|null, lnbLoHz?: number, applyToTx?: boolean,
 *   isTxActive?: () => boolean, decoders?: ReturnType<typeof createDecoderRegistry>, logger?: {error: Function},
 *   audio?: {rxUdp: {host: string, port: number}, txUdp: {host: string, port: number}}}} opts
 * @returns {object}
 */
export function createStation({
  client, rxDeviceSet = 0, txDeviceSet = 1, lnbLoHz = DEFAULT_LNB_LO_HZ, applyToTx = true,
  isTxActive = () => false, decoders = createDefaultDecoderRegistry(), logger = console, audio = DEFAULT_AUDIO,
}) {
  const state = {
    mode: null, downlinkHz: null, correctionHz: 0, correctionSource: 'none',
    ritHz: 0, xitHz: 0, txFollowsRx: true, txDialHz: null, filter: DEFAULT_FILTER, rxDsp: {}, notch: { ...DEFAULT_NOTCH },
  };
  const channels = { rx: null, tx: null, cw: null };
  let provisioned = false;
  let txDirty = false;
  let queue = Promise.resolve();

  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  const beaconIf = () => downlinkToIf(BEACON_DOWNLINK_HZ, lnbLoHz);
  const beaconUplink = () => downlinkToUplink(BEACON_DOWNLINK_HZ);

  async function findChannel(deviceSet, type) {
    const ds = await client.getDeviceSet(deviceSet);
    return (ds.channels ?? []).findLastIndex((c) => c.id === type);
  }

  async function ensureChannel(deviceSet, type, direction) {
    let idx = await findChannel(deviceSet, type);
    if (idx < 0) {
      await client.addChannel(deviceSet, type, direction);
      idx = await findChannel(deviceSet, type);
      if (idx < 0) throw new Error(`SDRangel did not create the ${type} channel`);
    }
    return idx;
  }

  const txSettingsFor = (profile) => ({ rfBandwidth: profile.tx.rfBandwidth, lowCutoff: profile.tx.lowCutoff });

  // Idempotent: makes sure the audio channels exist and are configured, then asks SDRangel to serve the spectrum websocket.
  async function doProvision() {
    if (provisioned) return;
    const profile = MODE_PROFILES[state.mode] ?? MODE_PROFILES.USB;
    channels.rx = await ensureChannel(rxDeviceSet, RX_CHANNEL, 0);
    await client.patchChannelSettings(rxDeviceSet, channels.rx, {
      sampleFormat: UDP_SINK_FORMAT_USB_MONO,
      outputSampleRate: AUDIO_RATE,
      udpAddress: audio.rxUdp.host,
      udpPort: audio.rxUdp.port,
      audioActive: 0, // no local SDRangel audio output, the audio goes to BricoHams
      rfBandwidth: profile.rx.rfBandwidth,
    });
    if (txDeviceSet !== null) {
      channels.tx = await ensureChannel(txDeviceSet, TX_CHANNEL, 1);
      await client.patchChannelSettings(txDeviceSet, channels.tx, {
        sampleFormat: UDP_SOURCE_FORMAT_USB,
        inputSampleRate: AUDIO_RATE,
        udpAddress: audio.txUdp.host,
        udpPort: audio.txUdp.port,
        channelMute: 0,
        ...txSettingsFor(profile),
      });
    }
    try {
      await client.setSpectrumServer(rxDeviceSet, true);
    } catch (err) {
      // Not fatal: the operator can enable the spectrum server in SDRangel by hand.
      logger.error('station: could not start the SDRangel spectrum server:', err.message);
    }
    provisioned = true;
  }

  // CW is the only mode that needs the SSBMod (its CW keyer); the UDPSource is muted while it is in use.
  async function configureTxForMode(mode, profile) {
    await client.patchChannelSettings(txDeviceSet, channels.tx, { ...txSettingsFor(profile), channelMute: mode === 'CW' ? 1 : 0 });
    if (mode === 'CW') {
      channels.cw = await ensureChannel(txDeviceSet, CW_CHANNEL, 1);
      await client.patchChannelSettings(txDeviceSet, channels.cw, {
        modAFInput: SSBMOD_AF_CW_TONE,
        usb: 1,
        bandwidth: profile.tx.rfBandwidth,
        lowCutoff: profile.tx.lowCutoff,
        audioMute: 0,
        cwKeyer: { mode: 0 },
      });
    } else {
      channels.cw = null;
      const idx = await findChannel(txDeviceSet, CW_CHANNEL);
      if (idx >= 0) {
        await client.patchChannelSettings(txDeviceSet, idx, { audioMute: 1 });
        channels.cw = idx;
      }
    }
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
      const offset = { inputFrequencyOffset: Math.round(tuning().txDownlinkHz - BEACON_DOWNLINK_HZ) };
      await client.patchChannelSettings(txDeviceSet, channels.tx, offset);
      if (channels.cw !== null) await client.patchChannelSettings(txDeviceSet, channels.cw, offset);
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
    await doProvision();
    const rxPatch = { rfBandwidth: profile.rx.rfBandwidth, ...toChannelSettings(state.rxDsp) };
    await client.patchChannelSettings(rxDeviceSet, channels.rx, rxPatch);
    if (txDeviceSet !== null) await configureTxForMode(mode, profile);
    state.mode = mode;
    state.filter = DEFAULT_FILTER;
    const seg = state.downlinkHz === null ? null : segmentFor(state.downlinkHz);
    await doTune(seg?.modes.includes(mode) ? state.downlinkHz : DEFAULT_DIAL_HZ[mode]);
  }

  const station = {
    /**
     * Make sure the SDRangel side exists: RX UDPSink (USB demodulated audio to `audio.rxUdp`), TX UDPSource (audio from
     * `audio.txUdp`) and the spectrum websocket server. Safe to call repeatedly; `setMode` calls it as well.
     * @returns {Promise<void>}
     */
    provision: () => serial(doProvision),

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
      await client.patchChannelSettings(rxDeviceSet, channels.rx, { rfBandwidth: preset.rfBandwidth });
      state.filter = name;
      return station.status();
    }),

    /**
     * Change AGC and squelch of the RX UDPSink. They are remembered and re-applied after a mode change. Noise reduction
     * cannot be enabled: SDRangel's UDPSink has no DNR (only SSBDemod does, which has no UDP output).
     * @param {{agc?: string, squelchDb?: number|null, noiseReduction?: boolean}} partial
     * @returns {Promise<object>} New status.
     * @throws {StationError} `bad_dsp`, `bad_agc`, `bad_squelch`, `bad_noise_reduction`, `dnr_unavailable`.
     */
    setRxDsp: (partial) => serial(async () => {
      const parsed = parseRxDsp(partial);
      if (!parsed.ok) throw new StationError(parsed.code);
      const patch = toChannelSettings(parsed.value);
      if (channels.rx !== null && Object.keys(patch).length > 0) await client.patchChannelSettings(rxDeviceSet, channels.rx, patch);
      Object.assign(state.rxDsp, parsed.value);
      return station.status();
    }),

    /**
     * Set the RX notch / auto-notch. Client-side only (NOT IN SDRangel API): the server keeps the state and the PWA filters the audio.
     * @param {{enabled?: boolean, auto?: boolean, offsetHz?: number, widthHz?: number}} partial
     * @returns {Promise<object>} New status.
     * @throws {StationError} `bad_notch`, `bad_notch_frequency`, `bad_notch_width`.
     */
    setNotch: (partial) => serial(async () => {
      const parsed = parseNotch(partial, state.notch);
      if (!parsed.ok) throw new StationError(parsed.code);
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
        notch: { ...state.notch, engine: 'client' },
      };
    },
  };
  return station;
}

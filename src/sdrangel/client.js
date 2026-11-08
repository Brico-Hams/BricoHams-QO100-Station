/**
 * REST client for SDRangel's `sdrangelsrv` API.
 * Every endpoint path and settings key lives in the tables below. Each entry carries `ref: <file>:<line>` pointing into the
 * reference copy in docs/references/sdrangel-swagger (paths relative to that folder; `include/` files are the nested schemas)
 * or is marked NOT IN SDRangel API.
 */

export const ENDPOINTS = Object.freeze({
  instance: () => '/sdrangel', // ref: swagger.yaml (path /sdrangel)
  deviceSets: () => '/sdrangel/devicesets', // ref: swagger.yaml (path /sdrangel/devicesets)
  deviceSet: (ds) => `/sdrangel/deviceset/${ds}`, // ref: swagger.yaml (path /sdrangel/deviceset/{deviceSetIndex})
  deviceSettings: (ds) => `/sdrangel/deviceset/${ds}/device/settings`, // ref: swagger.yaml (GET/PUT/PATCH)
  deviceRun: (ds) => `/sdrangel/deviceset/${ds}/device/run`, // ref: swagger.yaml (GET state, POST start, DELETE stop)
  channels: (ds) => `/sdrangel/deviceset/${ds}/channel`, // ref: swagger.yaml (POST {channelType, direction} -> 202 SuccessResponse)
  channelSettings: (ds, ch) => `/sdrangel/deviceset/${ds}/channel/${ch}/settings`, // ref: swagger.yaml
  channelReport: (ds, ch) => `/sdrangel/deviceset/${ds}/channel/${ch}/report`, // ref: swagger.yaml
  channelActions: (ds, ch) => `/sdrangel/deviceset/${ds}/channel/${ch}/actions`, // ref: swagger.yaml (POST ChannelActions -> 202)
  spectrumSettings: (ds) => `/sdrangel/deviceset/${ds}/spectrum/settings`, // ref: swagger.yaml (GET/PUT/PATCH GLSpectrum)
  spectrumServer: (ds) => `/sdrangel/deviceset/${ds}/spectrum/server`, // ref: swagger.yaml (GET SpectrumServer, POST start, DELETE stop)
  device: (ds) => `/sdrangel/deviceset/${ds}/device`, // ref: swagger.yaml (PUT DeviceListItem selects the hardware of a set)
});

/**
 * Settings of the supported device types. `hwType` is the string SDRangel reports in `deviceHwType` (line 2 of each include file);
 * input and output hardware share it and are told apart by `direction` (0 Rx, 1 Tx).
 * `lo` describes the reference-error key: `ppm` = integer ppm, `tenths` = integer tenths of ppm, null = NOT IN SDRangel API.
 * `transverter` is true when the file defines `transverterMode` (integer 0/1) and `transverterDeltaFrequency`.
 * `centerFrequency` is false for FileInput (NOT IN SDRangel API: FileInputSettings has no centre frequency).
 */
export const DEVICE_TABLE = Object.freeze({
  RTLSDR: { in: { key: 'rtlSdrSettings', ref: 'include/DeviceSettings.yaml:103' }, centerFrequency: true, lo: { key: 'loPpmCorrection', unit: 'ppm' }, transverter: true, ref: 'include/RtlSdr.yaml:18,28,67,72' },
  SDRplay1: { in: { key: 'sdrPlaySettings', ref: 'include/DeviceSettings.yaml:115' }, centerFrequency: true, lo: { key: 'LOppmTenths', unit: 'tenths' }, transverter: false, ref: 'include/SDRPlay.yaml:7,14 (no transverter keys)' },
  SDRplayV3: { in: { key: 'sdrPlayV3Settings', ref: 'include/DeviceSettings.yaml:118' }, centerFrequency: true, lo: { key: 'LOppmTenths', unit: 'tenths' }, transverter: true, ref: 'include/SDRPlayV3.yaml:7,11,71,76' },
  Airspy: { in: { key: 'airspySettings', ref: 'include/DeviceSettings.yaml:19' }, centerFrequency: true, lo: { key: 'LOppmTenths', unit: 'tenths' }, transverter: true, ref: 'include/Airspy.yaml:7,11,63,68' },
  AirspyHF: { in: { key: 'airspyHFSettings', ref: 'include/DeviceSettings.yaml:22' }, centerFrequency: true, lo: { key: 'LOppmTenths', unit: 'tenths' }, transverter: true, ref: 'include/AirspyHF.yaml:7,11,22,27' },
  PlutoSDR: {
    in: { key: 'plutoSdrInputSettings', ref: 'include/DeviceSettings.yaml:94' },
    out: { key: 'plutoSdrOutputSettings', ref: 'include/DeviceSettings.yaml:97' },
    centerFrequency: true, lo: { key: 'LOppmTenths', unit: 'tenths' }, transverter: true, ref: 'include/PlutoSdr.yaml:7,14,78,83 (Rx); :118,125,156,161 (Tx)',
  },
  HackRF: {
    in: { key: 'hackRFInputSettings', ref: 'include/DeviceSettings.yaml:64' },
    out: { key: 'hackRFOutputSettings', ref: 'include/DeviceSettings.yaml:67' },
    centerFrequency: true, lo: { key: 'LOppmTenths', unit: 'tenths' }, transverter: true, ref: 'include/HackRF.yaml:7,11,52,57 (Rx); :92,96,124,129 (Tx)',
  },
  USRP: {
    in: { key: 'usrpInputSettings', ref: 'include/DeviceSettings.yaml:139' },
    out: { key: 'usrpOutputSettings', ref: 'include/DeviceSettings.yaml:142' },
    centerFrequency: true, lo: null, transverter: true, ref: 'include/USRP.yaml:7,47,52 (Rx); :90,115,120 (Tx); LO ppm: NOT IN SDRangel API',
  },
  FileInput: { in: { key: 'fileInputSettings', ref: 'include/DeviceSettings.yaml:58' }, centerFrequency: false, lo: null, transverter: false, ref: 'include/FileInput.yaml (fileName, accelerationFactor, loop)' },
});
// HL2/Metis (metisMISOSettings, include/DeviceSettings.yaml:88), LimeSDR and TestSource are not in DEVICE_TABLE: their
// include files are not part of the reference copy, so their keys cannot be verified.

/**
 * Settings key of a device type for a direction.
 * @param {string} hwType `deviceHwType` as reported by SDRangel.
 * @param {number} direction 0 Rx, 1 Tx.
 * @returns {string|null} Wrapper key inside `DeviceSettings`, or null when unsupported.
 */
export function deviceSettingsKey(hwType, direction) {
  const d = Object.hasOwn(DEVICE_TABLE, hwType) ? DEVICE_TABLE[hwType] : null;
  if (!d) return null;
  return (direction === 1 ? d.out : d.in)?.key ?? null;
}

/**
 * Channel types the station uses. `key` is the (capitalised) wrapper in `ChannelSettings`, `actions` the wrapper in `ChannelActions`,
 * `report` the wrapper of the report. Report wrapper names follow the `<Type>Report` convention; ChannelReport.yaml is not in the
 * reference copy, so they are inferred (marked below).
 */
export const CHANNEL_TABLE = Object.freeze({
  SSBMod: { key: 'SSBModSettings', def: 'SSBModSettings', direction: 1, report: 'SSBModReport', ref: 'include/ChannelSettings.yaml:217' },
  SSBDemod: { key: 'SSBDemodSettings', def: 'SSBDemodSettings', direction: 0, report: 'SSBDemodReport', ref: 'include/ChannelSettings.yaml:220' },
  UDPSource: { key: 'UDPSourceSettings', def: 'UDPSourceSettings', direction: 1, report: 'UDPSourceReport', ref: 'include/ChannelSettings.yaml:223' },
  UDPSink: { key: 'UDPSinkSettings', def: 'UDPSinkSettings', direction: 0, report: 'UDPSinkReport', ref: 'include/ChannelSettings.yaml:226' },
  FileSink: { key: 'FileSinkSettings', def: 'FileSinkSettings', direction: 0, report: 'FileSinkReport', actions: 'FileSinkActions', ref: 'include/ChannelSettings.yaml:101; actions include/ChannelActions.yaml:37' },
  FreqTracker: { key: 'FreqTrackerSettings', def: 'FreqTrackerSettings', direction: 0, report: 'FreqTrackerReport', ref: 'include/ChannelSettings.yaml:116' },
  ChannelAnalyzer: { key: 'ChannelAnalyzerSettings', def: 'ChannelAnalyzerSettings', direction: 0, report: 'ChannelAnalyzerReport', ref: 'include/ChannelSettings.yaml:60' },
});

/** Settings that exist in no SDRangel schema and must therefore never be sent (kept so reviews see the decision). */
export const NOT_IN_SDRANGEL_API = Object.freeze({
  'SSBMod UDP audio input': 'SSBModSettings has no UDP input; TX audio goes through UDPSource (include/UDPSource.yaml)',
  'SSBDemod notch / auto-notch': 'SSBDemodSettings has agc and dnr but no notch; notch runs client-side',
  'SSBDemod UDP output': 'SSBDemod only feeds a local audio device; RX audio comes from UDPSink (include/UDPSink.yaml)',
  'FileSink record switch': 'FileSinkSettings has no record key; recording is started by the FileSinkActions.record action',
  'I/Q file list/delete': 'no REST endpoint; BricoHams manages the recordings directory itself',
});

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Error raised for every failure talking to SDRangel. `kind` is one of timeout | network | http | invalid. */
export class SdrangelError extends Error {
  /**
   * @param {'timeout'|'network'|'http'|'invalid'} kind
   * @param {string} message
   * @param {{status?: number}} [extra]
   */
  constructor(kind, message, { status } = {}) {
    super(message);
    this.name = 'SdrangelError';
    this.kind = kind;
    this.status = status;
  }
}

function checkIndex(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 1000) {
    throw new SdrangelError('invalid', `${name} must be a non-negative integer`);
  }
  return value;
}

function checkHz(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 1e12) {
    throw new SdrangelError('invalid', `${name} must be a finite non-negative frequency in Hz`);
  }
  return Math.round(value);
}

/**
 * Create an SDRangel REST client. Requests are made once (no retries) with a hard timeout.
 * @param {{baseUrl?: string, timeoutMs?: number, fetch?: typeof fetch}} [opts]
 * @returns {object} Client with one method per wrapped operation.
 */
export function createSdrangelClient({ baseUrl = 'http://127.0.0.1:8091', timeoutMs = DEFAULT_TIMEOUT_MS, fetch: fetchImpl = globalThis.fetch } = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');

  async function request(method, path, body) {
    let res;
    try {
      res = await fetchImpl(base + path, {
        method,
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new SdrangelError('timeout', `SDRangel did not answer ${method} ${path} within ${timeoutMs} ms`);
      }
      throw new SdrangelError('network', `cannot reach SDRangel (${err?.cause?.code ?? err?.code ?? 'error'})`);
    }
    let text;
    try {
      text = await res.text();
    } catch {
      throw new SdrangelError('network', 'connection to SDRangel dropped while reading the response');
    }
    if (text.length > MAX_BODY_BYTES) throw new SdrangelError('invalid', 'SDRangel response too large');
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (res.ok) throw new SdrangelError('invalid', 'SDRangel returned invalid JSON');
      }
    }
    if (!res.ok) {
      const detail = typeof data?.message === 'string' ? `: ${data.message.slice(0, 200)}` : '';
      throw new SdrangelError('http', `SDRangel ${method} ${path} failed with HTTP ${res.status}${detail}`, { status: res.status });
    }
    return data;
  }

  async function getDeviceSettings(deviceSet) {
    return request('GET', ENDPOINTS.deviceSettings(checkIndex(deviceSet, 'deviceSet')));
  }

  async function patchDeviceSettings(deviceSet, partial) {
    checkIndex(deviceSet, 'deviceSet');
    // SDRangel needs the hardware type in the PATCH body to pick the settings schema.
    const current = await getDeviceSettings(deviceSet);
    const key = deviceSettingsKey(current?.deviceHwType, current?.direction);
    if (!key) throw new SdrangelError('invalid', `unsupported device type ${String(current?.deviceHwType)} (direction ${String(current?.direction)})`);
    return request('PATCH', ENDPOINTS.deviceSettings(deviceSet), {
      deviceHwType: current.deviceHwType,
      direction: current.direction,
      [key]: partial,
    });
  }

  async function getChannelSettings(deviceSet, channel) {
    return request('GET', ENDPOINTS.channelSettings(checkIndex(deviceSet, 'deviceSet'), checkIndex(channel, 'channel')));
  }

  /** Capability lookup of the device behind a set; throws `invalid` for unsupported hardware. */
  async function deviceInfo(deviceSet) {
    const current = await getDeviceSettings(deviceSet);
    const entry = Object.hasOwn(DEVICE_TABLE, current?.deviceHwType) ? DEVICE_TABLE[current.deviceHwType] : null;
    if (!entry || !deviceSettingsKey(current.deviceHwType, current.direction)) {
      throw new SdrangelError('invalid', `unsupported device type ${String(current?.deviceHwType)}`);
    }
    return entry;
  }

  const api = {

    /** @returns {Promise<object>} Instance summary (version, device sets, logging). */
    getInstance: () => request('GET', ENDPOINTS.instance()),

    /** @returns {Promise<object>} `{devicesetcount, deviceSets: [...]}`. */
    listDeviceSets: () => request('GET', ENDPOINTS.deviceSets()),

    /**
     * @param {number} deviceSet
     * @returns {Promise<object>} Device set with its device and channels.
     */
    getDeviceSet: (deviceSet) => request('GET', ENDPOINTS.deviceSet(checkIndex(deviceSet, 'deviceSet'))),

    getDeviceSettings,

    /**
     * Patch the nested device settings object (e.g. `{centerFrequency: 739750000}`).
     * @param {number} deviceSet
     * @param {object} partial
     * @returns {Promise<object>}
     */
    patchDeviceSettings,

    /**
     * Set the device centre frequency.
     * @param {number} deviceSet
     * @param {number} hz
     * @returns {Promise<object>}
     */
    async setCenterFrequency(deviceSet, hz) {
      const value = checkHz(hz, 'centerFrequency');
      if (!(await deviceInfo(deviceSet)).centerFrequency) throw new SdrangelError('invalid', 'device has no centre frequency');
      return patchDeviceSettings(deviceSet, { centerFrequency: value });
    },

    /**
     * Set the LO correction in ppm (device reference error), converted to the unit of the device
     * (integer ppm for RTL-SDR, integer tenths of ppm for the others). Devices without such a key reject with `invalid`.
     * @param {number} deviceSet
     * @param {number} ppm
     * @returns {Promise<object>}
     */
    async setLoPpm(deviceSet, ppm) {
      if (!Number.isFinite(ppm) || Math.abs(ppm) > 1000) throw new SdrangelError('invalid', 'ppm out of range');
      const { lo } = await deviceInfo(deviceSet);
      if (!lo) throw new SdrangelError('invalid', 'device has no LO ppm setting in the SDRangel API');
      return patchDeviceSettings(deviceSet, { [lo.key]: Math.round(lo.unit === 'tenths' ? ppm * 10 : ppm) });
    },

    /**
     * Set the transverter delta frequency (shift applied by an external converter such as an LNB).
     * @param {number} deviceSet
     * @param {number} hz Signed shift in Hz.
     * @param {boolean} [enabled]
     * @returns {Promise<object>}
     */
    async setTransverter(deviceSet, hz, enabled = true) {
      if (!Number.isFinite(hz) || Math.abs(hz) > 1e12) throw new SdrangelError('invalid', 'transverter delta out of range');
      if (!(await deviceInfo(deviceSet)).transverter) throw new SdrangelError('invalid', 'device has no transverter setting in the SDRangel API');
      return patchDeviceSettings(deviceSet, { transverterMode: enabled ? 1 : 0, transverterDeltaFrequency: Math.round(hz) });
    },

    /**
     * Start or stop the device run (for a TX device set this keys/unkeys the transmitter).
     * @param {number} deviceSet
     * @param {boolean} running
     * @returns {Promise<{state?: string}>} Run state as returned by SDRangel (the swagger says: state before the change).
     */
    setRunning: (deviceSet, running) => request(running ? 'POST' : 'DELETE', ENDPOINTS.deviceRun(checkIndex(deviceSet, 'deviceSet'))),

    /**
     * @param {number} deviceSet
     * @returns {Promise<{state?: string}>} Run state of the device (notStarted, idle, ready, running, error).
     */
    getRunning: (deviceSet) => request('GET', ENDPOINTS.deviceRun(checkIndex(deviceSet, 'deviceSet'))),

    /**
     * Add a channel to a device set. SDRangel answers 202 with a message only; look the new index up with `getDeviceSet`.
     * @param {number} deviceSet
     * @param {string} channelType Key of CHANNEL_TABLE.
     * @param {0|1} direction 0 = Rx, 1 = Tx.
     * @returns {Promise<{message?: string}>}
     */
    addChannel(deviceSet, channelType, direction) {
      if (!Object.hasOwn(CHANNEL_TABLE, channelType)) throw new SdrangelError('invalid', `unsupported channel type ${String(channelType)}`);
      if (direction !== 0 && direction !== 1) throw new SdrangelError('invalid', 'direction must be 0 or 1');
      return request('POST', ENDPOINTS.channels(checkIndex(deviceSet, 'deviceSet')), { channelType, direction });
    },

    getChannelSettings,

    /**
     * Patch the nested settings of a channel.
     * @param {number} deviceSet
     * @param {number} channel
     * @param {object} partial e.g. `{inputFrequencyOffset: 1500, rfBandwidth: 2700}`.
     * @returns {Promise<object>}
     */
    async patchChannelSettings(deviceSet, channel, partial) {
      const current = await getChannelSettings(deviceSet, channel);
      const entry = Object.hasOwn(CHANNEL_TABLE, current?.channelType) ? CHANNEL_TABLE[current.channelType] : null;
      if (!entry) throw new SdrangelError('invalid', `unsupported channel type ${String(current?.channelType)}`);
      return request('PATCH', ENDPOINTS.channelSettings(deviceSet, channel), {
        channelType: current.channelType,
        direction: current.direction,
        [entry.key]: partial,
      });
    },

    /**
     * @param {number} deviceSet
     * @param {number} channel
     * @returns {Promise<object>} Channel report: `{channelType, direction, <Type>Report: {...}}`.
     */
    getChannelReport: (deviceSet, channel) => request('GET', ENDPOINTS.channelReport(checkIndex(deviceSet, 'deviceSet'), checkIndex(channel, 'channel'))),

    /**
     * Start or stop a FileSink recording through `FileSinkActions.record` (FileSinkSettings has no record key).
     * @param {number} deviceSet
     * @param {number} channel Index of a FileSink channel.
     * @param {boolean} on
     * @returns {Promise<object>}
     */
    async setRecording(deviceSet, channel, on) {
      const current = await getChannelSettings(deviceSet, channel);
      if (current?.channelType !== 'FileSink') throw new SdrangelError('invalid', 'channel is not a FileSink');
      return request('POST', ENDPOINTS.channelActions(deviceSet, channel), {
        channelType: 'FileSink',
        direction: current.direction,
        FileSinkActions: { record: on ? 1 : 0 },
      });
    },

    /**
     * @param {number} deviceSet
     * @returns {Promise<object>}
     */
    getSpectrumSettings: (deviceSet) => request('GET', ENDPOINTS.spectrumSettings(checkIndex(deviceSet, 'deviceSet'))),

    /**
     * @param {number} deviceSet
     * @param {object} settings Spectrum settings (fftSize, averaging, ...).
     * @returns {Promise<object>}
     */
    patchSpectrumSettings: (deviceSet, settings) => request('PATCH', ENDPOINTS.spectrumSettings(checkIndex(deviceSet, 'deviceSet')), settings),

    /**
     * @param {number} deviceSet
     * @returns {Promise<{run?: number, listeningAddress?: string, listeningPort?: number, clients?: number}>} Spectrum websocket server state.
     */
    getSpectrumServer: (deviceSet) => request('GET', ENDPOINTS.spectrumServer(checkIndex(deviceSet, 'deviceSet'))),

    /**
     * Start (`true`) or stop (`false`) the spectrum websocket server of a device set.
     * @param {number} deviceSet
     * @param {boolean} [on]
     * @returns {Promise<object>}
     */
    setSpectrumServer: (deviceSet, on = true) => request(on ? 'POST' : 'DELETE', ENDPOINTS.spectrumServer(checkIndex(deviceSet, 'deviceSet'))),

    /**
     * Replace the hardware of a device set (e.g. RTLSDR -> FileInput for I/Q playback, and back).
     * @param {number} deviceSet
     * @param {string} hwType Key of DEVICE_TABLE.
     * @param {0|1} direction
     * @param {{serial?: string, sequence?: number}} [pick] Which physical device to select.
     * @returns {Promise<object>}
     */
    switchDevice(deviceSet, hwType, direction, { serial, sequence = 0 } = {}) {
      if (!Object.hasOwn(DEVICE_TABLE, hwType)) throw new SdrangelError('invalid', `unsupported device type ${String(hwType)}`);
      if (direction !== 0 && direction !== 1) throw new SdrangelError('invalid', 'direction must be 0 or 1');
      const body = { hwType, direction, sequence };
      if (serial !== undefined) body.serial = String(serial);
      return request('PUT', ENDPOINTS.device(checkIndex(deviceSet, 'deviceSet')), body);
    },
  };

  api.baseUrl = base;
  // Argument validation throws synchronously in some methods; normalize so callers only ever handle rejections.
  return Object.fromEntries(Object.entries(api).map(([k, v]) => [k, typeof v === 'function'
    ? async (...args) => v(...args)
    : v]));
}

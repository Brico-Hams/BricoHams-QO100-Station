/**
 * REST client for SDRangel's `sdrangelsrv` API.
 * Every endpoint path and settings key lives in the tables below so that a single place needs fixing
 * once they are checked against the real server.
 */

// verify against SDRangel swagger (sdrangel/swagger/sdrangel/api/swagger/swagger.yaml)
export const ENDPOINTS = Object.freeze({
  instance: () => '/sdrangel',
  deviceSets: () => '/sdrangel/devicesets',
  deviceSet: (ds) => `/sdrangel/deviceset/${ds}`,
  deviceSettings: (ds) => `/sdrangel/deviceset/${ds}/device/settings`,
  deviceRun: (ds) => `/sdrangel/deviceset/${ds}/device/run`,
  channels: (ds) => `/sdrangel/deviceset/${ds}/channel`,
  channelSettings: (ds, ch) => `/sdrangel/deviceset/${ds}/channel/${ch}/settings`,
  channelReport: (ds, ch) => `/sdrangel/deviceset/${ds}/channel/${ch}/report`,
  spectrumSettings: (ds) => `/sdrangel/deviceset/${ds}/spectrum/settings`,
  // verify against SDRangel swagger: switching the device of a set (PUT with deviceHwType) is how a FileInput gets selected.
  device: (ds) => `/sdrangel/deviceset/${ds}/device`,
  // verify against SDRangel swagger: stock SDRangel has no file-listing/deleting REST endpoint; these two paths assume a
  // helper (or a future API) exposing the recordings directory. Without it list/delete only act on the station's own table.
  iqFiles: () => '/sdrangel/iq/files',
  iqFile: (name) => `/sdrangel/iq/files/${encodeURIComponent(name)}`,
});

// verify against SDRangel swagger (sdrangel/swagger/sdrangel/api/swagger/swagger.yaml)
/** Key under which each device hardware type nests its settings object. */
export const DEVICE_SETTINGS_KEYS = Object.freeze({
  RTLSDR: 'rtlSdrSettings',
  SDRplay1: 'sdrPlayV3Settings',
  SDRplayV3: 'sdrPlayV3Settings',
  Airspy: 'airspySettings',
  AirspyHF: 'airspyHFSettings',
  PlutoSDR: 'plutoSdrInputSettings',
  PlutoSDROutput: 'plutoSdrOutputSettings',
  USRP: 'usrpInputSettings',
  USRPOutput: 'usrpOutputSettings',
  HackRF: 'hackRFInputSettings',
  LimeSDR: 'limeSdrInputSettings',
  TestSource: 'testSourceSettings',
  TestSink: 'testSinkSettings',
  FileSource: 'fileSourceSettings',
  FileInput: 'fileInputSettings',
});

// verify against SDRangel swagger (sdrangel/swagger/sdrangel/api/swagger/swagger.yaml)
/** Key under which each channel type nests its settings (and report) object. */
export const CHANNEL_SETTINGS_KEYS = Object.freeze({
  SSBDemod: 'ssbDemodSettings',
  SSBMod: 'ssbModSettings',
  ChannelAnalyzer: 'channelAnalyzerSettings',
  FileSink: 'fileSinkSettings',
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
    const key = DEVICE_SETTINGS_KEYS[current?.deviceHwType];
    if (!key) throw new SdrangelError('invalid', `unsupported device type ${String(current?.deviceHwType)}`);
    return request('PATCH', ENDPOINTS.deviceSettings(deviceSet), {
      deviceHwType: current.deviceHwType,
      direction: current.direction,
      [key]: partial,
    });
  }

  async function getChannelSettings(deviceSet, channel) {
    return request('GET', ENDPOINTS.channelSettings(checkIndex(deviceSet, 'deviceSet'), checkIndex(channel, 'channel')));
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
    setCenterFrequency: (deviceSet, hz) => patchDeviceSettings(deviceSet, { centerFrequency: checkHz(hz, 'centerFrequency') }),

    /**
     * Set the LO correction in ppm (device reference error).
     * @param {number} deviceSet
     * @param {number} ppm
     * @returns {Promise<object>}
     */
    setLoPpm(deviceSet, ppm) {
      if (!Number.isFinite(ppm) || Math.abs(ppm) > 1000) throw new SdrangelError('invalid', 'ppm out of range');
      return patchDeviceSettings(deviceSet, { loPpmCorrection: ppm });
    },

    /**
     * Set the transverter delta frequency (shift applied by an external converter such as an LNB).
     * @param {number} deviceSet
     * @param {number} hz Signed shift in Hz.
     * @param {boolean} [enabled]
     * @returns {Promise<object>}
     */
    setTransverter(deviceSet, hz, enabled = true) {
      if (!Number.isFinite(hz) || Math.abs(hz) > 1e12) throw new SdrangelError('invalid', 'transverter delta out of range');
      return patchDeviceSettings(deviceSet, { transverterMode: Boolean(enabled), transverterDeltaFrequency: Math.round(hz) });
    },

    /**
     * Start or stop the device run (for a TX device set this keys/unkeys the transmitter).
     * @param {number} deviceSet
     * @param {boolean} running
     * @returns {Promise<object>}
     */
    setRunning: (deviceSet, running) => request(running ? 'POST' : 'DELETE', ENDPOINTS.deviceRun(checkIndex(deviceSet, 'deviceSet'))),

    /**
     * @param {number} deviceSet
     * @returns {Promise<{state?: string}>} Run state of the device.
     */
    getRunning: (deviceSet) => request('GET', ENDPOINTS.deviceRun(checkIndex(deviceSet, 'deviceSet'))),

    /**
     * Add a channel to a device set.
     * @param {number} deviceSet
     * @param {string} channelType e.g. SSBDemod or SSBMod.
     * @param {0|1} direction 0 = Rx, 1 = Tx.
     * @returns {Promise<object>}
     */
    addChannel(deviceSet, channelType, direction) {
      if (!Object.hasOwn(CHANNEL_SETTINGS_KEYS, channelType)) throw new SdrangelError('invalid', `unsupported channel type ${String(channelType)}`);
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
      const key = CHANNEL_SETTINGS_KEYS[current?.channelType];
      if (!key) throw new SdrangelError('invalid', `unsupported channel type ${String(current?.channelType)}`);
      return request('PATCH', ENDPOINTS.channelSettings(deviceSet, channel), {
        channelType: current.channelType,
        direction: current.direction,
        [key]: partial,
      });
    },

    /**
     * @param {number} deviceSet
     * @param {number} channel
     * @returns {Promise<object>} Channel report (signal level, etc.).
     */
    getChannelReport: (deviceSet, channel) => request('GET', ENDPOINTS.channelReport(checkIndex(deviceSet, 'deviceSet'), checkIndex(channel, 'channel'))),

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
     * Replace the hardware of a device set (e.g. RTLSDR -> FileInput for I/Q playback, and back).
     * @param {number} deviceSet
     * @param {string} hwType Key of DEVICE_SETTINGS_KEYS.
     * @param {0|1} direction
     * @returns {Promise<object>}
     */
    switchDevice(deviceSet, hwType, direction) {
      if (!Object.hasOwn(DEVICE_SETTINGS_KEYS, hwType)) throw new SdrangelError('invalid', `unsupported device type ${String(hwType)}`);
      if (direction !== 0 && direction !== 1) throw new SdrangelError('invalid', 'direction must be 0 or 1');
      return request('PUT', ENDPOINTS.device(checkIndex(deviceSet, 'deviceSet')), { deviceHwType: hwType, direction });
    },

    /** @returns {Promise<{files: Array<{name: string, bytes: number}>}>} I/Q files known to SDRangel's host. */
    listIqFiles: () => request('GET', ENDPOINTS.iqFiles()),

    /**
     * @param {string} name File name previously returned by `listIqFiles` (no path separators).
     * @returns {Promise<object>}
     */
    deleteIqFile(name) {
      if (typeof name !== 'string' || !/^[\w.-]{1,120}$/.test(name)) throw new SdrangelError('invalid', 'bad I/Q file name');
      return request('DELETE', ENDPOINTS.iqFile(name));
    },
  };

  api.baseUrl = base;
  // Argument validation throws synchronously in some methods; normalize so callers only ever handle rejections.
  return Object.fromEntries(Object.entries(api).map(([k, v]) => [k, typeof v === 'function'
    ? async (...args) => v(...args)
    : v]));
}

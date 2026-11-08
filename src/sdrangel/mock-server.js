import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { CHANNEL_TABLE, DEVICE_TABLE, deviceSettingsKey } from './client.js';
import { loadDefinitions, validateAgainst } from './swagger-lite.js';

const MAX_BODY = 64 * 1024;
const REF_DIR = fileURLToPath(new URL('../../docs/references/sdrangel-swagger/include/', import.meta.url));

// Loaded lazily so production code never reads the reference copy; the mock validates against it strictly.
let definitions = null;
const defs = () => (definitions ??= loadDefinitions(REF_DIR));

function defaultDeviceSets() {
  return [
    {
      direction: 0,
      hwType: 'RTLSDR',
      settings: { centerFrequency: 739_750_000, loPpmCorrection: 0, transverterMode: 0, transverterDeltaFrequency: 0 },
      running: true,
      channels: [],
      spectrum: { fftSize: 2048 },
      spectrumServer: { run: 0, listeningAddress: '127.0.0.1', listeningPort: 8887, clients: 0 },
    },
    {
      direction: 1,
      hwType: 'PlutoSDR',
      settings: { centerFrequency: 2_400_250_000, LOppmTenths: 0 },
      running: false,
      channels: [],
      spectrum: { fftSize: 1024 },
      spectrumServer: { run: 0, listeningAddress: '127.0.0.1', listeningPort: 8888, clients: 0 },
    },
  ];
}

/** Definition name of a nested settings object, resolved from the wrapper definition (`DeviceSettings`/`ChannelSettings`/...). */
function nestedDef(wrapper, key) {
  return defs()[wrapper]?.properties?.[key]?.ref ?? null;
}

/**
 * Validate a wrapper body (`DeviceSettings`, `ChannelSettings`, `ChannelActions`) and every nested object against the swagger
 * definitions: unknown keys and wrong types yield messages.
 * @param {string} wrapper
 * @param {unknown} body
 * @returns {string[]}
 */
function validateWrapper(wrapper, body) {
  const errors = validateAgainst(defs(), wrapper, body);
  if (errors.length) return errors;
  for (const [key, value] of Object.entries(body)) {
    const ref = nestedDef(wrapper, key);
    if (ref && defs()[ref]) errors.push(...validateAgainst(defs(), ref, value));
  }
  return errors;
}

/**
 * In-process fake of `sdrangelsrv` implementing the endpoints the client uses, with state.
 * Every PATCH/POST/PUT body is validated against the SDRangel swagger reference copy (unknown key or wrong type -> 400 with
 * details), so tests cannot rely on settings that SDRangel does not have. Used by unit and functional tests;
 * never listens on a non-loopback address.
 * @param {{deviceSets?: object[]}} [opts] Initial device sets (see defaultDeviceSets for the shape).
 * @returns {{start: () => Promise<string>, stop: () => Promise<void>, url: string|null, state: {deviceSets: object[]},
 *   calls: Array<{method: string, path: string, body: unknown}>, delayMs: number, failNext: (status: number) => void,
 *   iqBytes: number}}
 */
export function createMockSdrangel({ deviceSets } = {}) {
  const state = { deviceSets: deviceSets ?? defaultDeviceSets(), version: '7.22.0-mock' };
  const calls = [];
  let failStatus = null;
  const mock = { state, calls, delayMs: 0, url: null, iqBytes: 65_536 };
  let server = null;

  const reply = (res, status, body) => {
    const data = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
    res.end(data);
  };
  const bad = (res, errors) => reply(res, 400, { message: errors.join('; '), details: errors });
  const stateOf = (ds) => (ds.running ? 'running' : 'idle');

  const summary = (ds, i) => ({
    index: i,
    samplingDevice: { index: i, hwType: ds.hwType, direction: ds.direction, state: stateOf(ds) },
    channelcount: ds.channels.length,
    channels: ds.channels.map((c, ci) => ({ index: ci, id: c.channelType, direction: c.direction })),
  });

  function defaultChannelSettings(channelType) {
    return channelType === 'FileSink' ? {} : { inputFrequencyOffset: 0 };
  }

  function defaultReport(channelType) {
    if (channelType === 'FreqTracker') return { channelPowerDB: -100, trackingDeltaFrequency: 0, squelch: 0 };
    return channelType === 'FileSink' ? { recording: 0, recordSize: 0, recordTimeMs: 0 } : { channelPowerDB: -100 };
  }

  /** Validate a DeviceSettings/ChannelSettings write and return the wrapper key when valid. */
  function checkWrite(res, wrapper, body, expectedKey) {
    const errors = validateWrapper(wrapper, body);
    if (!errors.length && (typeof body[expectedKey] !== 'object' || body[expectedKey] === null)) errors.push(`missing ${expectedKey}`);
    if (errors.length) {
      bad(res, errors);
      return false;
    }
    return true;
  }

  function handle(method, path, body, res) {
    if (failStatus !== null) {
      const status = failStatus;
      failStatus = null;
      return reply(res, status, { message: 'injected failure' });
    }
    if (method === 'GET' && path === '/sdrangel') {
      return reply(res, 200, { version: state.version, devicesetcount: state.deviceSets.length });
    }
    if (method === 'GET' && path === '/sdrangel/devicesets') {
      return reply(res, 200, { devicesetcount: state.deviceSets.length, deviceSets: state.deviceSets.map(summary) });
    }
    const m = /^\/sdrangel\/deviceset\/(\d+)(?:\/(.*))?$/.exec(path);
    const ds = m ? state.deviceSets[Number(m[1])] : undefined;
    if (!m || !ds) return reply(res, 404, { message: 'no such device set' });
    const rest = m[2] ?? '';

    if (rest === '' && method === 'GET') return reply(res, 200, summary(ds, Number(m[1])));

    if (rest === 'device' && method === 'PUT') {
      const errors = [];
      if (!body || typeof body !== 'object' || Array.isArray(body)) errors.push('body must be an object');
      else {
        for (const k of Object.keys(body)) if (!['displayedName', 'hwType', 'serial', 'sequence', 'direction', 'deviceNbStreams', 'deviceSetIndex', 'index'].includes(k)) errors.push(`DeviceListItem.${k}: unknown property`);
        if (typeof body.hwType !== 'string') errors.push('DeviceListItem.hwType: expected string');
        if (!Number.isInteger(body.direction)) errors.push('DeviceListItem.direction: expected integer');
        if ('sequence' in body && !Number.isInteger(body.sequence)) errors.push('DeviceListItem.sequence: expected integer');
        if ('serial' in body && typeof body.serial !== 'string') errors.push('DeviceListItem.serial: expected string');
      }
      if (errors.length) return bad(res, errors);
      if (!Object.hasOwn(DEVICE_TABLE, body.hwType) || !deviceSettingsKey(body.hwType, body.direction) || body.direction !== ds.direction) return reply(res, 400, { message: 'bad device' });
      ds.hwType = body.hwType;
      ds.settings = body.hwType === 'FileInput' ? { fileName: '' } : { centerFrequency: 739_750_000 };
      ds.running = body.hwType !== 'FileInput';
      return reply(res, 202, { hwType: ds.hwType, direction: ds.direction, sequence: 0 });
    }

    if (rest === 'device/settings') {
      const key = deviceSettingsKey(ds.hwType, ds.direction);
      if (method === 'GET') return reply(res, 200, { deviceHwType: ds.hwType, direction: ds.direction, [key]: { ...ds.settings } });
      if (method === 'PATCH' || method === 'PUT') {
        if (!checkWrite(res, 'DeviceSettings', body, key)) return undefined;
        if (body.deviceHwType !== ds.hwType) return reply(res, 400, { message: 'deviceHwType mismatch' });
        if (body.direction !== ds.direction) return reply(res, 400, { message: 'direction mismatch' });
        Object.assign(ds.settings, body[key]);
        return reply(res, 200, { deviceHwType: ds.hwType, direction: ds.direction, [key]: { ...ds.settings } });
      }
    }
    if (rest === 'device/run') {
      // Like SDRangel (swagger: "On success return state before change"), POST/DELETE answer with the previous state.
      if (method === 'GET') return reply(res, 200, { state: stateOf(ds) });
      if (method === 'POST' || method === 'DELETE') {
        const before = stateOf(ds);
        ds.running = method === 'POST';
        return reply(res, 200, { state: before });
      }
      return reply(res, 405, { message: 'method not allowed' });
    }
    if (rest === 'spectrum/server') {
      if (method === 'GET') return reply(res, 200, { ...ds.spectrumServer });
      if (method === 'POST' || method === 'DELETE') {
        ds.spectrumServer.run = method === 'POST' ? 1 : 0;
        return reply(res, 200, { ...ds.spectrumServer });
      }
    }
    if (rest === 'channel' && method === 'POST') {
      const errors = [];
      if (!body || typeof body !== 'object' || Array.isArray(body)) errors.push('body must be an object');
      else {
        errors.push(...validateAgainst(defs(), 'ChannelSettings', body));
        if (typeof body.channelType !== 'string') errors.push('channelType: expected string');
      }
      if (errors.length) return bad(res, errors);
      if (!Object.hasOwn(CHANNEL_TABLE, body.channelType)) return reply(res, 400, { message: 'unknown channelType' });
      if (body.direction !== ds.direction) return reply(res, 400, { message: 'direction does not match device set' });
      ds.channels.push({
        channelType: body.channelType, direction: body.direction,
        settings: defaultChannelSettings(body.channelType), report: defaultReport(body.channelType),
      });
      return reply(res, 202, { message: `channel ${body.channelType} added` });
    }
    const c = /^channel\/(\d+)\/(settings|report|actions)$/.exec(rest);
    if (c) {
      const ch = ds.channels[Number(c[1])];
      if (!ch) return reply(res, 404, { message: 'no such channel' });
      const entry = CHANNEL_TABLE[ch.channelType];
      const head = { channelType: ch.channelType, direction: ch.direction };
      if (c[2] === 'report' && method === 'GET') return reply(res, 200, { ...head, [entry.report]: { ...ch.report } });
      if (c[2] === 'settings' && method === 'GET') return reply(res, 200, { ...head, [entry.key]: { ...ch.settings } });
      if (c[2] === 'settings' && (method === 'PATCH' || method === 'PUT')) {
        if (!checkWrite(res, 'ChannelSettings', body, entry.key)) return undefined;
        if (body.channelType !== ch.channelType) return reply(res, 400, { message: 'channelType mismatch' });
        Object.assign(ch.settings, body[entry.key]);
        return reply(res, 200, { ...head, [entry.key]: { ...ch.settings } });
      }
      if (c[2] === 'actions' && method === 'POST') {
        if (!entry.actions) return reply(res, 400, { message: `${ch.channelType} has no actions` });
        if (!checkWrite(res, 'ChannelActions', body, entry.actions)) return undefined;
        if (body.channelType !== ch.channelType) return reply(res, 400, { message: 'channelType mismatch' });
        const { record } = body[entry.actions];
        if (record === 1 && !ch.recording) {
          ch.recording = true;
          ch.report.recording = 1;
        } else if (record === 0 && ch.recording) {
          ch.recording = false;
          ch.report.recording = 0;
          ch.report.recordSize = mock.iqBytes;
          // Like the real sink, the file name gets a suffix appended to fileRecordName.
          if (ch.settings.fileRecordName) writeFileSync(`${ch.settings.fileRecordName}.sdriq`, Buffer.alloc(mock.iqBytes));
        }
        return reply(res, 202, { message: 'action applied' });
      }
    }
    if (rest === 'spectrum/settings') {
      if (method === 'GET') return reply(res, 200, { ...ds.spectrum });
      if (method === 'PATCH' || method === 'PUT') {
        const errors = validateAgainst(defs(), 'GLSpectrum', body);
        if (errors.length) return bad(res, errors);
        Object.assign(ds.spectrum, body);
        return reply(res, 200, { ...ds.spectrum });
      }
    }
    return reply(res, 404, { message: 'unknown endpoint' });
  }

  function onRequest(req, res) {
    const chunks = [];
    let size = 0;
    req.on('data', (d) => {
      size += d.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(d);
    });
    req.on('end', () => {
      let body;
      const text = Buffer.concat(chunks).toString('utf8');
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          return reply(res, 400, { message: 'bad json' });
        }
      }
      const path = req.url.split('?')[0];
      calls.push({ method: req.method, path, body });
      if (mock.delayMs > 0) setTimeout(() => handle(req.method, path, body, res), mock.delayMs).unref();
      else handle(req.method, path, body, res);
    });
  }

  Object.assign(mock, {
    /**
     * Listen on an ephemeral loopback port.
     * @returns {Promise<string>} Base URL.
     */
    start() {
      server = http.createServer(onRequest);
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          mock.url = `http://127.0.0.1:${server.address().port}`;
          resolve(mock.url);
        });
      });
    },
    /** Stop listening and drop connections. */
    stop() {
      return new Promise((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
    /**
     * Make the next request fail with the given HTTP status.
     * @param {number} status
     */
    failNext(status) {
      failStatus = status;
    },
  });
  return mock;
}

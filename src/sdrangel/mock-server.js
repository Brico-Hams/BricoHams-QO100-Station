import http from 'node:http';
import { CHANNEL_SETTINGS_KEYS, DEVICE_SETTINGS_KEYS } from './client.js';

const MAX_BODY = 64 * 1024;

function defaultDeviceSets() {
  return [
    {
      direction: 0,
      hwType: 'RTLSDR',
      settings: { centerFrequency: 739_750_000, loPpmCorrection: 0, transverterMode: false, transverterDeltaFrequency: 0 },
      running: true,
      channels: [],
      spectrum: { fftSize: 2048, averagingNb: 1 },
    },
    {
      direction: 1,
      hwType: 'PlutoSDROutput',
      settings: { centerFrequency: 2_400_250_000, loPpmCorrection: 0 },
      running: false,
      channels: [],
      spectrum: { fftSize: 1024, averagingNb: 1 },
    },
  ];
}

/**
 * In-process fake of `sdrangelsrv` implementing the endpoints the client uses, with state.
 * Used by unit and functional tests; never listens on a non-loopback address.
 * @param {{deviceSets?: object[]}} [opts] Initial device sets (see defaultDeviceSets for the shape).
 * @returns {{start: () => Promise<string>, stop: () => Promise<void>, url: string|null, state: {deviceSets: object[]},
 *   calls: Array<{method: string, path: string, body: unknown}>, delayMs: number, failNext: (status: number) => void}}
 */
export function createMockSdrangel({ deviceSets } = {}) {
  const state = { deviceSets: deviceSets ?? defaultDeviceSets(), version: '7.22.0-mock', iqFiles: [] };
  const calls = [];
  let failStatus = null;
  const mock = { state, calls, delayMs: 0, url: null, iqBytes: 1_048_576 };
  let server = null;

  const reply = (res, status, body) => {
    const data = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
    res.end(data);
  };

  const summary = (ds, i) => ({
    index: i,
    samplingDevice: { index: i, hwType: ds.hwType, direction: ds.direction, state: ds.running ? 'running' : 'idle' },
    channelcount: ds.channels.length,
    channels: ds.channels.map((c, ci) => ({ index: ci, id: c.channelType, direction: c.direction })),
  });

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
    const files = /^\/sdrangel\/iq\/files(?:\/([^/]+))?$/.exec(path);
    if (files) {
      if (!files[1] && method === 'GET') return reply(res, 200, { files: state.iqFiles.map((f) => ({ ...f })) });
      if (files[1] && method === 'DELETE') {
        const name = decodeURIComponent(files[1]);
        const i = state.iqFiles.findIndex((f) => f.name === name);
        if (i < 0) return reply(res, 404, { message: 'no such file' });
        state.iqFiles.splice(i, 1);
        return reply(res, 200, { ok: true });
      }
    }
    const m = /^\/sdrangel\/deviceset\/(\d+)(?:\/(.*))?$/.exec(path);
    const ds = m ? state.deviceSets[Number(m[1])] : undefined;
    if (!m || !ds) return reply(res, 404, { message: 'no such device set' });
    const rest = m[2] ?? '';

    if (rest === '' && method === 'GET') return reply(res, 200, summary(ds, Number(m[1])));

    if (rest === 'device' && method === 'PUT') {
      if (!Object.hasOwn(DEVICE_SETTINGS_KEYS, body?.deviceHwType) || body.direction !== ds.direction) return reply(res, 400, { message: 'bad device' });
      ds.hwType = body.deviceHwType;
      ds.settings = ds.hwType === 'FileInput' ? { fileName: '', centerFrequency: 0 } : { centerFrequency: 739_750_000, loPpmCorrection: 0 };
      ds.running = ds.hwType !== 'FileInput';
      return reply(res, 200, summary(ds, Number(m[1])));
    }

    if (rest === 'device/settings') {
      const key = DEVICE_SETTINGS_KEYS[ds.hwType];
      if (method === 'GET') return reply(res, 200, { deviceHwType: ds.hwType, direction: ds.direction, [key]: { ...ds.settings } });
      if (method === 'PATCH' || method === 'PUT') {
        if (body?.deviceHwType !== ds.hwType) return reply(res, 400, { message: 'deviceHwType mismatch' });
        if (typeof body[key] !== 'object' || body[key] === null) return reply(res, 400, { message: `missing ${key}` });
        Object.assign(ds.settings, body[key]);
        return reply(res, 200, { deviceHwType: ds.hwType, direction: ds.direction, [key]: { ...ds.settings } });
      }
    }
    if (rest === 'device/run') {
      if (method === 'GET') return reply(res, 200, { state: ds.running ? 'running' : 'idle' });
      if (method === 'POST') ds.running = true;
      else if (method === 'DELETE') ds.running = false;
      else return reply(res, 405, { message: 'method not allowed' });
      return reply(res, 200, { state: ds.running ? 'running' : 'idle' });
    }
    if (rest === 'channel' && method === 'POST') {
      if (!Object.hasOwn(CHANNEL_SETTINGS_KEYS, body?.channelType)) return reply(res, 400, { message: 'unknown channelType' });
      if (body.direction !== ds.direction) return reply(res, 400, { message: 'direction does not match device set' });
      ds.channels.push({ channelType: body.channelType, direction: body.direction, settings: { inputFrequencyOffset: 0 }, report: { channelPowerDB: -100 } });
      return reply(res, 202, { index: ds.channels.length - 1 });
    }
    const c = /^channel\/(\d+)\/(settings|report)$/.exec(rest);
    if (c) {
      const ch = ds.channels[Number(c[1])];
      if (!ch) return reply(res, 404, { message: 'no such channel' });
      const key = CHANNEL_SETTINGS_KEYS[ch.channelType];
      if (c[2] === 'report' && method === 'GET') return reply(res, 200, { channelType: ch.channelType, direction: ch.direction, [key]: { ...ch.report } });
      if (c[2] === 'settings' && method === 'GET') return reply(res, 200, { channelType: ch.channelType, direction: ch.direction, [key]: { ...ch.settings } });
      if (c[2] === 'settings' && (method === 'PATCH' || method === 'PUT')) {
        if (body?.channelType !== ch.channelType) return reply(res, 400, { message: 'channelType mismatch' });
        if (typeof body[key] !== 'object' || body[key] === null) return reply(res, 400, { message: `missing ${key}` });
        Object.assign(ch.settings, body[key]);
        // A FileSink that stops recording leaves a file behind, like the real one.
        if (ch.channelType === 'FileSink' && body[key].record === false && ch.recording) {
          ch.recording = false;
          state.iqFiles.push({ name: ch.settings.fileRecordName, bytes: mock.iqBytes });
          ch.report.recordSize = mock.iqBytes;
        }
        if (ch.channelType === 'FileSink' && body[key].record === true) ch.recording = true;
        return reply(res, 200, { channelType: ch.channelType, direction: ch.direction, [key]: { ...ch.settings } });
      }
    }
    if (rest === 'spectrum/settings') {
      if (method === 'GET') return reply(res, 200, { ...ds.spectrum });
      if (method === 'PATCH' || method === 'PUT') {
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

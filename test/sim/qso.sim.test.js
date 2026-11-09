import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../../src/server/app.js';
import { validateConfig } from '../../src/server/config.js';
import { createFileAudit } from '../../src/ptt/audit.js';
import { createMockSdrangel, createSdrangelClient } from '../../src/sdrangel/index.js';
import { createUdpTxSink } from '../../src/webrtc/tx-audio.js';
import { FrameKind, encodeAudioFrame } from '../../src/webrtc/frames.js';
import { createFakeOidc } from '../fixtures/fake-oidc.js';
import { silentLogger } from '../fixtures/fakes.js';
import { record, simTest } from './metrics.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRAMES = 20;
const SAMPLES = 480; // 10 ms at 48 kHz, passes through the TX path without resampling
const FRAME_BYTES = SAMPLES * 2;

simTest('qso', 'complete QSO through the real server and the strict SDRangel mock', async () => {
  const mock = createMockSdrangel();
  const sdrUrl = await mock.start();

  // The mock answers 400 to anything the swagger rejects but keeps no counter, so every exchange is tallied here.
  const exchanges = { byRoute: {}, byStatus: {} };
  const countingFetch = async (url, init = {}) => {
    const res = await fetch(url, init);
    const route = `${init.method ?? 'GET'} ${new URL(url).pathname.replace(/\/\d+(?=\/|$)/g, '/{n}')}`;
    exchanges.byRoute[route] = (exchanges.byRoute[route] ?? 0) + 1;
    exchanges.byStatus[res.status] = (exchanges.byStatus[res.status] ?? 0) + 1;
    return res;
  };

  // Stand-in for SDRangel's UDPSource: a plain UDP socket counting the TX audio it receives.
  const udp = dgram.createSocket('udp4');
  let udpBytes = 0;
  let udpDatagrams = 0;
  udp.on('message', (m) => { udpBytes += m.length; udpDatagrams++; });
  await new Promise((res) => udp.bind(0, '127.0.0.1', res));
  const txSink = createUdpTxSink({ host: '127.0.0.1', port: udp.address().port });

  const dir = mkdtempSync(join(tmpdir(), 'bricohams-qso-'));
  const config = validateConfig({
    port: 0,
    google: { clientId: 'client-id' },
    allowlist: [
      { email: 'owner@example.org', callsign: 'EA4OWN', role: 'owner' },
      { email: 'op@example.org', callsign: 'EA4AAA', role: 'operator' },
    ],
    tx: { enabled: true, totSeconds: 60, heartbeatTimeoutMs: 1000 },
    sdrangel: { baseUrl: sdrUrl },
    station: { applyCorrectionToTx: true },
    auditLogPath: join(dir, 'audit.log'),
    logbook: { path: ':memory:' },
  }, { GOOGLE_CLIENT_SECRET: 'test-secret' });
  const oidc = createFakeOidc();
  const app = createApp(config, {
    oidc,
    logger: silentLogger,
    sdrangel: createSdrangelClient({ baseUrl: sdrUrl, fetch: countingFetch }),
    txSink,
    beaconAutoStart: false,
    audit: createFileAudit({ path: config.auditLogPath }),
  });
  let ws = null;
  let hb = null;
  try {
    const { url: base } = await app.listen();
    await app.whenProvisioned();

    // ---- login
    const r1 = await fetch(`${base}/auth/login`, { redirect: 'manual' });
    const { code, state } = oidc.issueCode(r1.headers.get('location'), { email: 'op@example.org' });
    const loginCookie = r1.headers.getSetCookie().find((c) => c.startsWith('bh_login=')).split(';')[0];
    const r2 = await fetch(`${base}/auth/callback?code=${code}&state=${state}`, { headers: { cookie: loginCookie } });
    const cookie = r2.headers.getSetCookie().find((c) => c.startsWith('bh_session=')).split(';')[0];
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
    const post = (path, body) => fetch(`${base}${path}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': me.csrfToken },
      body: JSON.stringify(body),
    });

    // ---- configure the station
    assert.equal((await post('/api/mode', { mode: 'USB' })).status, 200);
    const tuned = await post('/api/tune', { downlinkHz: 10_489_800_000 });
    assert.equal(tuned.status, 200);
    assert.equal((await tuned.json()).uplinkHz, 2_400_300_000);
    assert.equal(mock.state.deviceSets[0].channels[0].settings.inputFrequencyOffset, 50_000);
    assert.equal((await post('/api/rit', { ritHz: 150, xitHz: 0 })).status, 200);

    // ---- turn, PTT and microphone audio
    const texts = [];
    ws = new WebSocket(`${base.replace('http', 'ws')}/ws/control`, { headers: { Cookie: cookie, Origin: base } });
    ws.on('message', (d, isBinary) => { if (!isBinary) texts.push(JSON.parse(d.toString())); });
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    const until = async (pred, what) => {
      for (let i = 0; i < 300; i++) {
        if (texts.some(pred)) return;
        await sleep(10);
      }
      throw new Error(`timeout waiting for ${what}`);
    };
    const mic = (seq) => ws.send(encodeAudioFrame(FrameKind.MIC, seq, 48_000, Int16Array.from({ length: SAMPLES }, (_, i) => Math.round(8000 * Math.sin(i / 5)))), { binary: true });
    const burst = async () => {
      for (let i = 0; i < FRAMES; i++) {
        mic(i);
        await sleep(2);
      }
    };
    const mark = () => { texts.length = 0; };

    ws.send(JSON.stringify({ type: 'turn' }));
    await until((m) => m.type === 'state' && m.state === 'ARMED', 'ARMED');
    hb = setInterval(() => ws.send(JSON.stringify({ type: 'heartbeat' })), 100);

    await burst();
    await sleep(150);
    const bytesArmed = udpBytes;
    assert.equal(bytesArmed, 0, 'no audio reaches UDPSource while ARMED');

    mark();
    ws.send(JSON.stringify({ type: 'ptt', down: true }));
    await until((m) => m.type === 'state' && m.state === 'TX_ON', 'TX_ON');
    await burst();
    for (let i = 0; i < 100 && udpBytes < FRAMES * FRAME_BYTES; i++) await sleep(10);
    const bytesTx = udpBytes;
    assert.equal(bytesTx, FRAMES * FRAME_BYTES, 'every mic sample sent during TX_ON reached UDPSource');

    mark();
    ws.send(JSON.stringify({ type: 'ptt', down: false }));
    await until((m) => m.type === 'state' && m.state === 'ARMED', 'unkeyed');
    await burst();
    await sleep(150);
    assert.equal(udpBytes, bytesTx, 'no audio after release of PTT');

    ws.send(JSON.stringify({ type: 'release' }));
    await until((m) => m.type === 'state' && m.state === 'TX_OFF', 'TX_OFF');
    clearInterval(hb);
    hb = null;

    // ---- log the QSO and export ADIF
    const logged = await post('/api/log', { call: 'DL1ABC', mode: 'SSB', freq: 2400.3, freq_rx: 10489.8 });
    assert.equal(logged.status, 201);
    const adif = await (await fetch(`${base}/api/log/export.adi`, { headers: { cookie } })).text();
    assert.match(adif, /<CALL:6>DL1ABC/i);
    assert.match(adif, /<EOR>/i);

    // ---- strict SDRangel conformance
    const validationErrors = exchanges.byStatus[400] ?? 0;
    const serverErrors = Object.entries(exchanges.byStatus).filter(([s]) => Number(s) >= 500).reduce((a, [, n]) => a + n, 0);
    assert.equal(validationErrors, 0, `SDRangel rejected requests as swagger-invalid: ${JSON.stringify(exchanges.byRoute)}`);
    assert.equal(serverErrors, 0, 'no 5xx from SDRangel');
    assert.ok(mock.calls.length > 0);
    const tx = app.ptt.snapshot();
    assert.equal(tx.state, 'TX_OFF');

    const total = Object.values(exchanges.byRoute).reduce((a, b) => a + b, 0);
    record('qso', 'summary', {
      sdrangelRequests: total,
      requestsByRoute: exchanges.byRoute,
      requestsByStatus: exchanges.byStatus,
      swaggerValidationErrors: validationErrors,
      udpDatagrams,
      udpBytesArmed: bytesArmed,
      udpBytesTxOn: bytesTx,
      udpBytesAfterRelease: udpBytes - bytesTx,
      micFramesPerPhase: FRAMES,
      adifBytes: adif.length,
    });
  } finally {
    if (hb) clearInterval(hb);
    ws?.terminate();
    await app.close();
    await txSink.close();
    udp.close();
    await mock.stop();
  }
});

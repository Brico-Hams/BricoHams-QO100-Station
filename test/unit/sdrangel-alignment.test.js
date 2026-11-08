import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStation } from '../../src/modes/index.js';
import { createMockSdrangel, createSdrangelClient } from '../../src/sdrangel/index.js';
import { createFreqTrackerBeacon } from '../../src/beacon/freqtracker.js';

const quiet = { error() {} };

async function withStation(fn, opts = {}) {
  const mock = createMockSdrangel();
  const client = createSdrangelClient({ baseUrl: await mock.start(), timeoutMs: 1000 });
  const station = createStation({
    client, logger: quiet, audio: { rxUdp: { host: '127.0.0.1', port: 9998 }, txUdp: { host: '127.0.0.1', port: 9999 } }, ...opts,
  });
  try {
    await fn({ station, mock, client });
  } finally {
    await mock.stop();
  }
}

const rx = (mock) => mock.state.deviceSets[0];
const tx = (mock) => mock.state.deviceSets[1];

test('provision creates the RX UDPSink, the TX UDPSource and starts the spectrum server', () => withStation(async ({ station, mock }) => {
  await station.provision();
  await station.provision();
  assert.equal(rx(mock).channels.length, 1, 'idempotent');
  assert.equal(rx(mock).channels[0].channelType, 'UDPSink');
  assert.deepEqual(
    { f: rx(mock).channels[0].settings.sampleFormat, r: rx(mock).channels[0].settings.outputSampleRate, p: rx(mock).channels[0].settings.udpPort },
    { f: 7, r: 48_000, p: 9998 },
  );
  assert.equal(tx(mock).channels[0].channelType, 'UDPSource');
  const s = tx(mock).channels[0].settings;
  assert.equal(s.sampleFormat, 3);
  assert.equal(s.inputSampleRate, 48_000);
  assert.equal(s.udpPort, 9999);
  assert.equal(rx(mock).spectrumServer.run, 1);
}));

test('SSBMod is only added for CW and takes the CW tone input; the UDPSource is muted meanwhile', () => withStation(async ({ station, mock }) => {
  await station.setMode('USB');
  assert.equal(tx(mock).channels.length, 1);
  assert.equal(tx(mock).channels[0].settings.channelMute, 0);
  await station.setMode('CW');
  assert.equal(tx(mock).channels.length, 2);
  assert.equal(tx(mock).channels[1].channelType, 'SSBMod');
  assert.equal(tx(mock).channels[1].settings.modAFInput, 4);
  assert.equal(tx(mock).channels[0].settings.channelMute, 1);
  await station.setMode('USB');
  assert.equal(tx(mock).channels[0].settings.channelMute, 0);
  assert.equal(tx(mock).channels[1].settings.audioMute, 1);
}));

test('notch is client-side only and DNR is refused', () => withStation(async ({ station, mock }) => {
  await station.setMode('USB');
  const before = JSON.stringify(rx(mock).channels[0].settings);
  const st = await station.setNotch({ enabled: true, offsetHz: 1200 });
  assert.equal(st.notch.engine, 'client');
  assert.equal(JSON.stringify(rx(mock).channels[0].settings), before);
  await assert.rejects(station.setRxDsp({ noiseReduction: true }), (e) => e.code === 'dnr_unavailable');
}));

test('FreqTracker beacon engine reads the report, locks and corrects the station', async () => {
  await withStation(async ({ station, mock, client }) => {
    await station.setMode('USB');
    const beacon = createFreqTrackerBeacon({ client, station, logger: quiet });
    await beacon.step();
    const idx = rx(mock).channels.findIndex((c) => c.channelType === 'FreqTracker');
    assert.ok(idx >= 0, 'tracker channel created');
    assert.equal(rx(mock).channels[idx].settings.tracking, 1);
    assert.equal(beacon.status().status, 'no-lock', 'closed squelch means no detection');

    const report = rx(mock).channels[idx].report;
    report.squelch = 1;
    for (let i = 0; i < 6; i++) {
      // The mock does not simulate tracking: report the beacon's residual offset from the current RX centre.
      report.trackingDeltaFrequency = 600 - (rx(mock).settings.centerFrequency - 739_750_000);
      await beacon.step();
    }
    assert.equal(beacon.status().status, 'locked');
    assert.ok(Math.abs(rx(mock).settings.centerFrequency - (739_750_000 + 600)) <= 2);
  });
});

test('mock rejects settings that are not in the SDRangel API', async () => {
  const mock = createMockSdrangel();
  const client = createSdrangelClient({ baseUrl: await mock.start(), timeoutMs: 1000 });
  try {
    await client.addChannel(0, 'UDPSink', 0);
    await assert.rejects(client.patchChannelSettings(0, 0, { notchFrequency: 1000 }), (e) => e.kind === 'http' && e.status === 400);
  } finally {
    await mock.stop();
  }
});

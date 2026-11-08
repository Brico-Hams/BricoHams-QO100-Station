import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSdrangelClient, SdrangelError, createMockSdrangel, createSdrangelPttDriver } from '../../src/sdrangel/index.js';

async function withMock(fn, opts) {
  const mock = createMockSdrangel(opts);
  const url = await mock.start();
  try {
    await fn(createSdrangelClient({ baseUrl: url, timeoutMs: 500 }), mock);
  } finally {
    await mock.stop();
  }
}

test('instance info and device sets', () => withMock(async (client) => {
  assert.match((await client.getInstance()).version, /mock/);
  const sets = await client.listDeviceSets();
  assert.equal(sets.devicesetcount, 2);
  assert.equal(sets.deviceSets[1].samplingDevice.direction, 1);
}));

test('device settings: centre frequency, ppm and transverter patches reach the device', () => withMock(async (client, mock) => {
  await client.setCenterFrequency(0, 739_750_123.4);
  await client.setLoPpm(0, -1.4);
  await client.setTransverter(0, -9_750_000_000);
  const s = (await client.getDeviceSettings(0)).rtlSdrSettings;
  assert.equal(s.centerFrequency, 739_750_123);
  assert.equal(s.loPpmCorrection, -1, 'RTL-SDR takes integer ppm');
  assert.equal(s.transverterDeltaFrequency, -9_750_000_000);
  assert.equal(s.transverterMode, 1, 'transverterMode is an integer 0/1 in the API');
  assert.equal(mock.state.deviceSets[0].settings.centerFrequency, 739_750_123);
  await client.setLoPpm(1, 1.25);
  assert.equal((await client.getDeviceSettings(1)).plutoSdrOutputSettings.LOppmTenths, 13, 'Pluto takes tenths of ppm');
  assert.equal((await client.getDeviceSettings(1)).deviceHwType, 'PlutoSDR');
}));

test('channels: add, patch settings, read report, actions', () => withMock(async (client, mock) => {
  assert.match((await client.addChannel(0, 'SSBDemod', 0)).message, /added/);
  await client.patchChannelSettings(0, 0, { inputFrequencyOffset: 1500, rfBandwidth: 2700 });
  const s = await client.getChannelSettings(0, 0);
  assert.equal(s.SSBDemodSettings.inputFrequencyOffset, 1500);
  const report = await client.getChannelReport(0, 0);
  assert.equal(report.channelType, 'SSBDemod');
  assert.ok(report.SSBDemodReport);
  assert.equal(mock.state.deviceSets[0].channels.length, 1);
  await assert.rejects(client.addChannel(0, 'Bogus', 0), (e) => e instanceof SdrangelError && e.kind === 'invalid');
  await assert.rejects(client.addChannel(0, 'SSBMod', 1), (e) => e.kind === 'http' && e.status === 400);
  await assert.rejects(client.setRecording(0, 0, true), (e) => e.kind === 'invalid', 'only FileSink records');
}));

test('the mock rejects settings that are not in the SDRangel API', () => withMock(async (client) => {
  await client.addChannel(0, 'SSBDemod', 0);
  await assert.rejects(client.patchChannelSettings(0, 0, { notchFrequency: 1000 }), (e) => e.kind === 'http' && e.status === 400 && /notchFrequency/.test(e.message));
  await assert.rejects(client.patchChannelSettings(0, 0, { rfBandwidth: 'wide' }), (e) => e.status === 400 && /rfBandwidth/.test(e.message));
  await assert.rejects(client.patchDeviceSettings(0, { loPpm: 1 }), (e) => e.status === 400);
  await assert.rejects(client.patchSpectrumSettings(0, { nonsense: 1 }), (e) => e.status === 400);
}));

test('FileSink records through the action and the spectrum server starts through the API', () => withMock(async (client, mock) => {
  await client.addChannel(0, 'FileSink', 0);
  await assert.rejects(client.patchChannelSettings(0, 0, { record: true }), (e) => e.status === 400, 'no record key in FileSinkSettings');
  await client.setRecording(0, 0, true);
  assert.equal((await client.getChannelReport(0, 0)).FileSinkReport.recording, 1);
  await client.setRecording(0, 0, false);
  assert.equal((await client.getChannelReport(0, 0)).FileSinkReport.recording, 0);
  assert.equal((await client.getSpectrumServer(0)).run, 0);
  await client.setSpectrumServer(0, true);
  assert.equal((await client.getSpectrumServer(0)).run, 1);
  const post = mock.calls.find((c) => c.path.endsWith('/actions'));
  assert.deepEqual(post.body, { channelType: 'FileSink', direction: 0, FileSinkActions: { record: 1 } });
}));

test('switchDevice sends hwType (not deviceHwType) and device run answers with the previous state', () => withMock(async (client, mock) => {
  await client.switchDevice(0, 'FileInput', 0);
  assert.deepEqual(mock.calls.at(-1).body, { hwType: 'FileInput', direction: 0, sequence: 0 });
  assert.equal(mock.state.deviceSets[0].hwType, 'FileInput');
  await assert.rejects(client.setCenterFrequency(0, 1_000_000), (e) => e.kind === 'invalid', 'FileInput has no centre frequency');
  assert.equal((await client.setRunning(1, true)).state, 'idle');
  assert.equal((await client.setRunning(1, false)).state, 'running');
}));

test('spectrum settings and run state', () => withMock(async (client) => {
  await client.patchSpectrumSettings(0, { fftSize: 4096 });
  assert.equal((await client.getSpectrumSettings(0)).fftSize, 4096);
  await client.setRunning(1, true);
  assert.equal((await client.getRunning(1)).state, 'running');
  await client.setRunning(1, false);
  assert.equal((await client.getRunning(1)).state, 'idle');
}));

test('error mapping: http, network, timeout and input validation', async () => {
  await withMock(async (client, mock) => {
    await assert.rejects(client.getDeviceSet(9), (e) => e.kind === 'http' && e.status === 404);
    mock.failNext(503);
    await assert.rejects(client.getInstance(), (e) => e.kind === 'http' && e.status === 503 && /injected/.test(e.message));
    mock.delayMs = 1500;
    await assert.rejects(client.getInstance(), (e) => e.kind === 'timeout');
    await assert.rejects(client.setCenterFrequency(-1, 1), (e) => e.kind === 'invalid');
    await assert.rejects(client.setCenterFrequency(0, NaN), (e) => e.kind === 'invalid');
    await assert.rejects(client.setLoPpm(0, 5000), (e) => e.kind === 'invalid');
  });
  const dead = createSdrangelClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
  await assert.rejects(dead.getInstance(), (e) => e.kind === 'network' || e.kind === 'timeout');
});

test('PTT driver starts and stops the TX device set; unconfirmed off is an error', () => withMock(async (client, mock) => {
  const driver = createSdrangelPttDriver({ client, txDeviceSet: 1 });
  await driver.setTx(true);
  assert.equal(mock.state.deviceSets[1].running, true);
  await driver.setTx(false);
  assert.equal(mock.state.deviceSets[1].running, false);
  assert.equal(mock.state.deviceSets[0].running, true, 'RX is never touched');

  const stuck = createSdrangelPttDriver({
    client: { setRunning: async () => {}, getRunning: async () => ({ state: 'running' }) },
    txDeviceSet: 1,
  });
  await assert.rejects(stuck.setTx(false), /still running/);
  mock.failNext(500);
  await assert.rejects(driver.setTx(true), (e) => e.kind === 'http');
}));

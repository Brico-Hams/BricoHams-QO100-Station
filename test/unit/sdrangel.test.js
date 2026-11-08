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
  await client.setLoPpm(0, -1.5);
  await client.setTransverter(0, -9_750_000_000);
  const s = (await client.getDeviceSettings(0)).rtlSdrSettings;
  assert.equal(s.centerFrequency, 739_750_123);
  assert.equal(s.loPpmCorrection, -1.5);
  assert.equal(s.transverterDeltaFrequency, -9_750_000_000);
  assert.equal(s.transverterMode, true);
  assert.equal(mock.state.deviceSets[0].settings.centerFrequency, 739_750_123);
}));

test('channels: add, patch settings, read report', () => withMock(async (client, mock) => {
  await client.addChannel(0, 'SSBDemod', 0);
  await client.patchChannelSettings(0, 0, { inputFrequencyOffset: 1500, rfBandwidth: 2700 });
  const s = await client.getChannelSettings(0, 0);
  assert.equal(s.ssbDemodSettings.inputFrequencyOffset, 1500);
  assert.equal((await client.getChannelReport(0, 0)).channelType, 'SSBDemod');
  assert.equal(mock.state.deviceSets[0].channels.length, 1);
  await assert.rejects(client.addChannel(0, 'Bogus', 0), (e) => e instanceof SdrangelError && e.kind === 'invalid');
  await assert.rejects(client.addChannel(0, 'SSBMod', 1), (e) => e.kind === 'http' && e.status === 400);
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

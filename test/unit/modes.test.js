import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAND_PLAN, BEACON_DOWNLINK_HZ, DEFAULT_DIAL_HZ, DecoderUnavailableError, MODES, StationError, checkTransmit,
  createDecoderRegistry, createStation, createUnavailableDecoder, downlinkToIf, downlinkToUplink, ifToDownlink,
  segmentFor, uplinkToDownlink, utcSlot,
} from '../../src/modes/index.js';
import { createMockSdrangel, createSdrangelClient } from '../../src/sdrangel/index.js';

test('frequency conversions round-trip and match the known beacon figures', () => {
  assert.equal(downlinkToUplink(BEACON_DOWNLINK_HZ), 2_400_250_000);
  assert.equal(uplinkToDownlink(2_400_250_000), BEACON_DOWNLINK_HZ);
  assert.equal(downlinkToIf(BEACON_DOWNLINK_HZ), 739_750_000);
  assert.equal(ifToDownlink(739_750_000), BEACON_DOWNLINK_HZ);
  assert.equal(downlinkToIf(BEACON_DOWNLINK_HZ, 9_360_000_000), 1_129_750_000);
});

test('band plan segments are contiguous and classify frequencies', () => {
  for (let i = 1; i < BAND_PLAN.length; i++) assert.equal(BAND_PLAN[i].startHz, BAND_PLAN[i - 1].endHz);
  assert.equal(segmentFor(10_489_505_000).name, 'cw');
  assert.equal(segmentFor(10_489_539_999).name, 'cw');
  assert.equal(segmentFor(10_489_540_000).name, 'digital');
  assert.equal(segmentFor(10_489_650_000).name, 'ssb');
  assert.equal(segmentFor(BEACON_DOWNLINK_HZ).name, 'ssb');
  assert.equal(segmentFor(10_489_990_000), null);
  assert.equal(segmentFor(10_489_000_000), null);
  for (const m of MODES) assert.equal(segmentFor(DEFAULT_DIAL_HZ[m]).modes.includes(m), true, `default dial for ${m}`);
});

test('checkTransmit validates mode against segment and returns the uplink', () => {
  assert.deepEqual(checkTransmit(10_489_700_000, 'USB'), { ok: true, segment: 'ssb', uplinkHz: 2_400_200_000 });
  assert.equal(checkTransmit(10_489_700_000, 'FT8').reason, 'mode_not_in_segment');
  assert.equal(checkTransmit(10_490_100_000, 'USB').reason, 'outside_band_plan');
});

test('decoder stubs say clearly that they are unavailable; slots are UTC aligned', () => {
  const d = createUnavailableDecoder('FT8');
  assert.equal(d.available, false);
  assert.throws(() => d.decode(new Float32Array(10), utcSlot('FT8', 0)), (e) => e instanceof DecoderUnavailableError && e.code === 'decoder_not_available');
  assert.deepEqual(utcSlot('FT8', 1_700_000_017_000), { index: 113_333_334, startMs: 1_700_000_010_000 });
  assert.equal(utcSlot('FT4', 7_600).startMs, 7_500);
  assert.throws(() => utcSlot('USB'), RangeError);

  const reg = createDecoderRegistry();
  assert.equal(reg.get('FT4').available, false);
  const real = { mode: 'FT4', available: true, decode: () => [{ text: 'CQ TEST' }] };
  reg.register(real);
  assert.equal(reg.get('FT4'), real);
  assert.throws(() => reg.register({}), TypeError);
});

async function withStation(fn, opts = {}) {
  const mock = createMockSdrangel();
  const client = createSdrangelClient({ baseUrl: await mock.start(), timeoutMs: 1000 });
  let txActive = false;
  const station = createStation({ client, isTxActive: () => txActive, ...opts });
  try {
    await fn({ station, mock, setTxActive: (v) => { txActive = v; } });
  } finally {
    await mock.stop();
  }
}

const rx = (mock) => mock.state.deviceSets[0];
const tx = (mock) => mock.state.deviceSets[1];

test('setMode creates channels once, configures them and moves to the dial frequency', () => withStation(async ({ station, mock }) => {
  const st = await station.setMode('FT8');
  assert.equal(st.mode, 'FT8');
  assert.equal(st.downlinkHz, DEFAULT_DIAL_HZ.FT8);
  assert.equal(st.segment, 'digital');
  assert.equal(st.decoder.available, false);
  assert.equal(rx(mock).channels.length, 1);
  assert.equal(tx(mock).channels.length, 1);
  assert.equal(rx(mock).channels[0].settings.rfBandwidth, 3000);
  assert.equal(rx(mock).channels[0].settings.inputFrequencyOffset, DEFAULT_DIAL_HZ.FT8 - BEACON_DOWNLINK_HZ);
  assert.equal(rx(mock).settings.centerFrequency, 739_750_000, 'RX stays centred on the beacon IF');
  assert.equal(tx(mock).settings.centerFrequency, 2_400_250_000);

  await station.setMode('USB');
  assert.equal(rx(mock).channels.length, 1, 'no duplicate channels');
  assert.equal(station.status().downlinkHz, DEFAULT_DIAL_HZ.USB);
  await assert.rejects(station.setMode('AM'), (e) => e instanceof StationError && e.code === 'unknown_mode');
}));

test('setMode keeps the frequency when it is valid for the new mode', () => withStation(async ({ station }) => {
  await station.setMode('USB');
  await station.tune(10_489_800_000);
  await station.setMode('USB');
  assert.equal(station.status().downlinkHz, 10_489_800_000);
  assert.equal(station.status().uplinkHz, 2_400_300_000);
  assert.equal(station.status().ifHz, 739_800_000);
}));

test('tune validates the range and applies channel offsets on RX and TX', () => withStation(async ({ station, mock }) => {
  await station.setMode('USB');
  await assert.rejects(station.tune(10_491_000_000), (e) => e.code === 'frequency_out_of_range');
  await assert.rejects(station.tune(NaN), (e) => e.code === 'frequency_out_of_range');
  assert.equal(station.status().downlinkHz, DEFAULT_DIAL_HZ.USB, 'failed tune leaves the state untouched');
  await station.tune(10_489_730_000);
  assert.equal(rx(mock).channels[0].settings.inputFrequencyOffset, -20_000);
  assert.equal(tx(mock).channels[0].settings.inputFrequencyOffset, -20_000);
}));

test('correction shifts RX centre up and TX centre down; TX retune is deferred while keyed', () => withStation(async ({ station, mock, setTxActive }) => {
  await station.setMode('USB');
  await station.setCorrection(1200, 'beacon');
  assert.equal(rx(mock).settings.centerFrequency, 739_751_200);
  assert.equal(tx(mock).settings.centerFrequency, 2_400_248_800);

  setTxActive(true);
  await station.setCorrection(1500, 'beacon');
  assert.equal(rx(mock).settings.centerFrequency, 739_751_500);
  assert.equal(tx(mock).settings.centerFrequency, 2_400_248_800, 'TX untouched while keyed');
  assert.equal(station.status().txRetunePending, true);
  await station.tune(10_489_760_000);
  assert.equal(tx(mock).settings.centerFrequency, 2_400_248_800);
  assert.equal(tx(mock).channels[0].settings.inputFrequencyOffset, DEFAULT_DIAL_HZ.USB - BEACON_DOWNLINK_HZ, 'TX offset untouched while keyed');

  setTxActive(false);
  await station.onTxIdle();
  assert.equal(tx(mock).settings.centerFrequency, 2_400_248_500);
  assert.equal(tx(mock).channels[0].settings.inputFrequencyOffset, 10_000);
  assert.equal(station.status().txRetunePending, false);
  await assert.rejects(station.setCorrection(1e6), (e) => e.code === 'correction_out_of_range');
}));

test('applyToTx=false leaves the TX centre alone', () => withStation(async ({ station, mock }) => {
  await station.setMode('USB');
  await station.setCorrection(900, 'manual');
  assert.equal(tx(mock).settings.centerFrequency, 2_400_250_000);
  assert.equal(station.status().correctionSource, 'manual');
}, { applyToTx: false }));

test('SDRangel failure during tune is surfaced and does not corrupt state', () => withStation(async ({ station, mock }) => {
  await station.setMode('USB');
  const before = station.status().downlinkHz;
  mock.failNext(500);
  await assert.rejects(station.tune(10_489_800_000), (e) => e.kind === 'http');
  assert.equal(station.status().downlinkHz, before);
  const ok = await station.tune(10_489_800_000);
  assert.equal(ok.downlinkHz, 10_489_800_000, 'queue keeps working after a failure');
}));

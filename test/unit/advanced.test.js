import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdtempSync, rmSync, existsSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BEACON_DOWNLINK_HZ, BAND_PLAN, DEFAULT_DIAL_HZ, FILTER_PRESETS, MemoryError, QO100_PRESETS, computeTuning, createMemoryStore,
  createStation, describeBandPlan, isValidOffset, openStationDb, parseRxDsp, toChannelSettings,
} from '../../src/modes/index.js';
import { createMockSdrangel, createSdrangelClient } from '../../src/sdrangel/index.js';
import { WAV_HEADER_BYTES, createWavWriter, fixWavHeader, parseWavHeader, wavHeader } from '../../src/webrtc/wav.js';
import { RecordingError, createRecorder } from '../../src/webrtc/recorder.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const loadScript = (name) => {
  const ctx = {};
  vm.runInNewContext(read(`src/web/public/${name}`), ctx);
  return ctx;
};

// ---- RIT / XIT maths ----
test('computeTuning: RIT moves RX only, XIT moves TX only, lock decides who follows the dial', () => {
  const dial = 10_489_800_000;
  assert.deepEqual(computeTuning({ dialHz: dial }), { rxHz: dial, txDownlinkHz: dial, uplinkHz: 2_400_300_000, ownSignalOffsetHz: 0 });
  const rit = computeTuning({ dialHz: dial, ritHz: 150 });
  assert.equal(rit.rxHz, dial + 150);
  assert.equal(rit.txDownlinkHz, dial);
  assert.equal(rit.ownSignalOffsetHz, -150);
  const xit = computeTuning({ dialHz: dial, xitHz: -200 });
  assert.equal(xit.uplinkHz, 2_400_299_800);
  assert.equal(xit.ownSignalOffsetHz, -200);
  const split = computeTuning({ dialHz: dial + 20_000, txDialHz: dial, txFollowsRx: false, xitHz: 10 });
  assert.equal(split.txDownlinkHz, dial + 10);
  assert.equal(computeTuning({ dialHz: dial, txDialHz: dial - 5000, txFollowsRx: true }).txDownlinkHz, dial, 'lock ignores the stored TX dial');
});

test('isValidOffset accepts integers within +-9999 Hz only', () => {
  for (const ok of [0, 10, -9999, 9999]) assert.equal(isValidOffset(ok), true);
  for (const bad of [10_000, -10_000, 1.5, NaN, '5', null, undefined]) assert.equal(isValidOffset(bad), false);
});

// ---- station integration ----
async function withStation(fn) {
  const mock = createMockSdrangel();
  const client = createSdrangelClient({ baseUrl: await mock.start(), timeoutMs: 1000 });
  let txActive = false;
  const station = createStation({ client, isTxActive: () => txActive });
  try {
    await fn({ station, mock, setTxActive: (v) => { txActive = v; } });
  } finally {
    await mock.stop();
  }
}
const rx = (mock) => mock.state.deviceSets[0];
const tx = (mock) => mock.state.deviceSets[1];

test('RIT shifts the RX channel only; XIT shifts the TX channel and uplink; bad values are rejected', () => withStation(async ({ station, mock }) => {
  await station.setMode('USB');
  await station.tune(10_489_800_000);
  let st = await station.setOffsets({ ritHz: 150 });
  assert.equal(rx(mock).channels[0].settings.inputFrequencyOffset, 50_150);
  assert.equal(tx(mock).channels[0].settings.inputFrequencyOffset, 50_000);
  assert.equal(st.downlinkHz, 10_489_800_000);
  assert.equal(st.rxHz, 10_489_800_150);
  assert.equal(st.ownSignalOffsetHz, -150);

  st = await station.setOffsets({ xitHz: -200 });
  assert.equal(tx(mock).channels[0].settings.inputFrequencyOffset, 49_800);
  assert.equal(st.uplinkHz, 2_400_299_800);
  assert.equal(st.ownSignalOffsetHz, -350);

  await assert.rejects(station.setOffsets({ ritHz: 10_000 }), (e) => e.code === 'offset_out_of_range');
  await assert.rejects(station.setOffsets({ xitHz: 1.5 }), (e) => e.code === 'offset_out_of_range');
  await station.setOffsets({ xitHz: 0 });
  await station.tune(10_489_505_000);
  await assert.rejects(station.setOffsets({ ritHz: -100 }), (e) => e.code === 'frequency_out_of_range');
  assert.equal(station.status().ritHz, 150, 'a rejected change keeps the previous value');

  st = await station.setOffsets({ ritHz: 0, xitHz: 0 });
  assert.equal(st.ownSignalOffsetHz, 0);
}));

test('XIT is never applied to a keyed transmitter, RIT still is', () => withStation(async ({ station, mock, setTxActive }) => {
  await station.setMode('USB');
  await station.tune(10_489_800_000);
  setTxActive(true);
  await station.setOffsets({ xitHz: 300, ritHz: 40 });
  assert.equal(tx(mock).channels[0].settings.inputFrequencyOffset, 50_000, 'TX untouched while keyed');
  assert.equal(rx(mock).channels[0].settings.inputFrequencyOffset, 50_040);
  assert.equal(station.status().txRetunePending, true);
  setTxActive(false);
  await station.onTxIdle();
  assert.equal(tx(mock).channels[0].settings.inputFrequencyOffset, 50_300);
}));

test('TX lock: unlocked TX stays put while RX tunes; locking again follows the dial', () => withStation(async ({ station, mock }) => {
  await station.setMode('USB');
  await station.tune(10_489_800_000);
  let st = await station.setTxLock({ locked: false });
  assert.equal(st.txFollowsRx, false);
  st = await station.tune(10_489_820_000);
  assert.equal(rx(mock).channels[0].settings.inputFrequencyOffset, 70_000);
  assert.equal(tx(mock).channels[0].settings.inputFrequencyOffset, 50_000);
  assert.equal(st.txDownlinkHz, 10_489_800_000);
  assert.equal(st.uplinkHz, 2_400_300_000);
  assert.equal(st.ownSignalOffsetHz, -20_000);

  st = await station.setTxLock({ locked: true });
  assert.equal(tx(mock).channels[0].settings.inputFrequencyOffset, 70_000);
  assert.equal(st.ownSignalOffsetHz, 0);

  await assert.rejects(station.setTxLock({ locked: false, txDownlinkHz: 10_491_000_000 }), (e) => e.code === 'tx_frequency_out_of_range');
  assert.equal(station.status().txFollowsRx, true);
  await assert.rejects(station.setTxLock({ locked: 'yes' }), (e) => e.code === 'bad_tx_lock');
}));

test('filter presets change the RX passband only and reset on mode change', () => withStation(async ({ station, mock }) => {
  await assert.rejects(station.setFilter('narrow'), (e) => e.code === 'no_mode');
  await station.setMode('CW');
  const st = await station.setFilter('narrow');
  assert.equal(st.filter.name, 'narrow');
  assert.deepEqual(st.filter.available, Object.keys(FILTER_PRESETS.CW));
  assert.equal(rx(mock).channels[0].settings.rfBandwidth, FILTER_PRESETS.CW.narrow.rfBandwidth);
  assert.equal(tx(mock).channels[0].settings.bandwidth, 850, 'TX filter untouched');
  await assert.rejects(station.setFilter('bogus'), (e) => e.code === 'unknown_filter');
  await station.setMode('USB');
  assert.equal(station.status().filter.name, 'normal');
  assert.equal(rx(mock).channels[0].settings.rfBandwidth, 2700);
}));

test('RX DSP settings are validated, mapped to the channel and kept across mode changes', () => withStation(async ({ station, mock }) => {
  await station.setMode('USB');
  assert.equal('dnr' in rx(mock).channels[0].settings, false, 'no DSP keys until configured');
  await station.setRxDsp({ agc: 'fast', squelchDb: -60, noiseReduction: true });
  assert.equal(rx(mock).channels[0].settings.dnr, true);
  assert.equal(rx(mock).channels[0].settings.agcPowerThreshold, -60);
  await station.setMode('CW');
  assert.equal(rx(mock).channels[0].settings.dnr, true);
  assert.deepEqual(station.status().rxDsp, { agc: 'fast', squelchDb: -60, noiseReduction: true });
  for (const [input, code] of [[{ agc: 'turbo' }, 'bad_agc'], [{ squelchDb: 5 }, 'bad_squelch'], [{ noiseReduction: 'x' }, 'bad_noise_reduction'], [{}, 'bad_dsp'], [{ foo: 1 }, 'bad_dsp'], [null, 'bad_dsp']]) {
    await assert.rejects(station.setRxDsp(input), (e) => e.code === code, JSON.stringify(input));
  }
  assert.equal(tx(mock).channels[0].settings.dnr, undefined, 'DSP never touches the TX channel');
}));

test('parseRxDsp and toChannelSettings map the documented values', () => {
  assert.equal(parseRxDsp({ agc: 'off' }).ok, true);
  assert.deepEqual(toChannelSettings({ agc: 'off' }), { agc: false });
  assert.equal(toChannelSettings({ squelchDb: null }).agcThresholdGate, 0);
  assert.deepEqual(toChannelSettings({}), {});
});

// ---- band plan description ----
test('describeBandPlan returns copies of the segments and the beacons', () => {
  const plan = describeBandPlan();
  assert.equal(plan.segments.length, BAND_PLAN.length);
  assert.ok(plan.markers.some((m) => m.hz === BEACON_DOWNLINK_HZ));
  plan.segments[0].name = 'changed';
  assert.equal(BAND_PLAN[0].name, 'cw', 'the plan cannot be mutated through the copy');
});

// ---- memories ----
const owner = { email: 'owner@example.org', role: 'owner', callsign: 'EA4OWN' };
const alice = { email: 'alice@example.org', role: 'operator', callsign: 'EA4AAA' };
const bob = { email: 'bob@example.org', role: 'operator', callsign: 'EA4BBB' };
const good = { name: 'My CW', downlinkHz: 10_489_520_000, mode: 'CW' };

test('memories: CRUD is per user and rows of others look like they do not exist', () => {
  const store = createMemoryStore({ db: openStationDb(':memory:') });
  const m = store.add(alice, good);
  assert.deepEqual([m.name, m.downlinkHz, m.mode, m.shared, m.mine], ['My CW', 10_489_520_000, 'CW', false, true]);
  assert.equal(store.list(alice).length, 1);
  assert.equal(store.list(bob).length, 0);
  assert.throws(() => store.get(bob, m.id), (e) => e instanceof MemoryError && e.code === 'not_found' && e.status === 404);
  assert.throws(() => store.update(bob, m.id, good), (e) => e.status === 404);
  assert.throws(() => store.remove(bob, m.id), (e) => e.status === 404);
  const u = store.update(alice, m.id, { ...good, name: 'Renamed', filter: 'narrow' });
  assert.equal(u.filter, 'narrow');
  store.remove(alice, m.id);
  assert.equal(store.list(alice).length, 0);
});

test('memories: validation rejects bad names, frequencies, modes and filters', () => {
  const store = createMemoryStore({ db: openStationDb(':memory:') });
  const bad = [
    [{ ...good, name: '' }, 'name'], [{ ...good, name: 'x'.repeat(33) }, 'name'], [{ ...good, name: 'a\u0007b' }, 'name'],
    [{ ...good, downlinkHz: 10_489_000_000 }, 'downlinkHz'], [{ ...good, downlinkHz: 10_489_990_000 }, 'downlinkHz'], [{ ...good, downlinkHz: 1.5 }, 'downlinkHz'],
    [{ ...good, mode: 'AM' }, 'mode'], [{ ...good, filter: 'huge' }, 'filter'], [{ ...good, shared: 'yes' }, 'shared'],
  ];
  for (const [input, field] of bad) {
    assert.throws(() => store.add(alice, input), (e) => e.code === 'validation' && e.fields[field] !== undefined, JSON.stringify(input));
  }
  assert.throws(() => store.add(alice, null), (e) => e.code === 'validation');
  store.add(alice, good);
  assert.throws(() => store.add(alice, { ...good, name: 'my cw' }), (e) => e.code === 'duplicate_name' && e.status === 409);
});

test('memories: shared ones are created and edited by the owner role only; everybody can read them', () => {
  const store = createMemoryStore({ db: openStationDb(':memory:') });
  assert.throws(() => store.add(alice, { ...good, shared: true }), (e) => e.code === 'forbidden' && e.status === 403);
  const s = store.add(owner, { ...good, shared: true });
  assert.equal(s.shared, true);
  assert.equal(store.list(bob).length, 1);
  assert.throws(() => store.update(bob, s.id, good), (e) => e.status === 403);
  assert.throws(() => store.remove(bob, s.id), (e) => e.status === 403);
  assert.throws(() => store.update(owner, s.id, { ...good, shared: false }), (e) => e.status === 403, 'scope cannot change');
  store.remove(owner, s.id);
  assert.equal(store.list(bob).length, 0);
});

test('memories: per-user limit applies', () => {
  const store = createMemoryStore({ db: openStationDb(':memory:') });
  for (let i = 0; i < 200; i++) store.add(alice, { ...good, name: `m${i}` });
  assert.throws(() => store.add(alice, { ...good, name: 'one more' }), (e) => e.code === 'too_many_memories');
  store.add(bob, good);
});

test('QO-100 presets are valid for the band plan and the mode of their segment', () => {
  const plan = describeBandPlan();
  for (const p of QO100_PRESETS) {
    const seg = plan.segments.find((s) => p.downlinkHz >= s.startHz && p.downlinkHz < s.endHz);
    assert.ok(seg, `${p.key} is inside the plan`);
    assert.ok(seg.modes.includes(p.mode), `${p.key} mode fits ${seg.name}`);
  }
  assert.equal(QO100_PRESETS.find((p) => p.key === 'bpsk-beacon').downlinkHz, BEACON_DOWNLINK_HZ);
  assert.ok(QO100_PRESETS.some((p) => p.downlinkHz === DEFAULT_DIAL_HZ.FT8));
});

// ---- WAV ----
function tmp() {
  return mkdtempSync(join(tmpdir(), 'bh-wav-'));
}

test('wavHeader / parseWavHeader describe 16-bit mono PCM correctly', () => {
  const h = wavHeader({ dataBytes: 24_000, sampleRate: 12_000 });
  assert.equal(h.length, WAV_HEADER_BYTES);
  assert.equal(h.toString('ascii', 0, 4), 'RIFF');
  assert.equal(h.readUInt32LE(4), 36 + 24_000);
  assert.equal(h.readUInt32LE(28), 24_000, 'byte rate = rate * 2');
  assert.equal(h.readUInt16LE(32), 2, 'block align');
  assert.deepEqual(parseWavHeader(h), { sampleRate: 12_000, channels: 1, bits: 16, dataBytes: 24_000, riffBytes: 24_036 });
  assert.equal(parseWavHeader(Buffer.alloc(10)), null);
  assert.equal(parseWavHeader(Buffer.alloc(44)), null);
});

test('createWavWriter writes little-endian samples and a correct final header', () => {
  const dir = tmp();
  try {
    const path = join(dir, 'a.wav');
    const w = createWavWriter({ path, sampleRate: 12_000, maxBytes: 10_000 });
    assert.equal(w.write(Int16Array.from([1, -2, 300])), true);
    assert.equal(w.close(), WAV_HEADER_BYTES + 6);
    assert.equal(w.close(), WAV_HEADER_BYTES + 6, 'close is idempotent');
    const file = readFileSync(path);
    assert.equal(file.length, WAV_HEADER_BYTES + 6);
    const info = parseWavHeader(file);
    assert.equal(info.dataBytes, 6);
    assert.equal(info.riffBytes, 36 + 6);
    assert.deepEqual([file.readInt16LE(44), file.readInt16LE(46), file.readInt16LE(48)], [1, -2, 300]);
    assert.throws(() => createWavWriter({ path, sampleRate: 12_000, maxBytes: 1000 }), (e) => e.code === 'EEXIST', 'never overwrites');
    assert.throws(() => createWavWriter({ path: join(dir, 'b.wav'), sampleRate: 12_000, maxBytes: 44 }), RangeError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createWavWriter enforces the size cap and reports full', () => {
  const dir = tmp();
  try {
    const path = join(dir, 'cap.wav');
    const w = createWavWriter({ path, sampleRate: 12_000, maxBytes: WAV_HEADER_BYTES + 100 });
    assert.equal(w.write(new Int16Array(30)), true);
    assert.equal(w.write(new Int16Array(30)), false, 'the frame that does not fit is cut and the writer is full');
    assert.equal(w.full, true);
    assert.equal(w.write(new Int16Array(10)), false);
    assert.equal(w.close(), WAV_HEADER_BYTES + 100);
    assert.equal(statSync(path).size, WAV_HEADER_BYTES + 100);
    assert.equal(parseWavHeader(readFileSync(path)).dataBytes, 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fixWavHeader repairs a recording that was never closed', () => {
  const dir = tmp();
  try {
    const path = join(dir, 'crash.wav');
    writeFileSync(path, wavHeader({ dataBytes: 0, sampleRate: 12_000 }));
    appendFileSync(path, Buffer.alloc(1001)); // odd length: a torn last sample is dropped
    assert.equal(fixWavHeader(path), WAV_HEADER_BYTES + 1000);
    assert.equal(parseWavHeader(readFileSync(path)).dataBytes, 1000);
    writeFileSync(join(dir, 'junk.wav'), Buffer.alloc(100));
    assert.equal(fixWavHeader(join(dir, 'junk.wav')), -1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- recorder ----
function fakeRxAudio() {
  const taps = new Set();
  return { addTap: (fn) => { taps.add(fn); return () => taps.delete(fn); }, feed: (frames) => { for (let i = 0; i < frames; i++) for (const t of taps) t(new Int16Array(240).fill(i)); }, taps };
}
const settle = () => new Promise((r) => setImmediate(() => setImmediate(r)));

test('recorder: start/stop produces a valid WAV owned by the user; others cannot see or fetch it', async () => {
  const dir = tmp();
  try {
    const rxAudio = fakeRxAudio();
    const rec = createRecorder({ db: openStationDb(':memory:'), rxAudio, dir, maxFileMb: 1, maxUserMb: 5, logger: { error() {} } });
    const r = rec.start(alice, { downlinkHz: 10_489_800_000, mode: 'USB' });
    assert.equal(r.recording, true);
    assert.throws(() => rec.start(alice), (e) => e instanceof RecordingError && e.code === 'already_recording');
    rxAudio.feed(50);
    const done = rec.stop(alice);
    assert.equal(rxAudio.taps.size, 0, 'tap removed');
    assert.equal(done.bytes, WAV_HEADER_BYTES + 50 * 480);
    assert.equal(done.durationSec, 1);
    assert.throws(() => rec.stop(alice), (e) => e.code === 'not_recording');

    const f = rec.locate(alice, r.id);
    assert.equal(parseWavHeader(readFileSync(f.path)).sampleRate, 12_000);
    assert.equal(f.size, done.bytes);
    assert.equal(rec.list(alice).items.length, 1);
    assert.equal(rec.list(bob).items.length, 0);
    assert.throws(() => rec.locate(bob, r.id), (e) => e.status === 404);
    assert.throws(() => rec.remove(bob, r.id), (e) => e.status === 404);
    assert.equal(rec.list(owner).items[0].owner, alice.email, 'the owner role sees every recording');
    rec.remove(alice, r.id);
    assert.equal(existsSync(f.path), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recorder: file cap stops the recording; quota blocks the next one; owner can disable', async () => {
  const dir = tmp();
  try {
    const rxAudio = fakeRxAudio();
    const rec = createRecorder({ db: openStationDb(':memory:'), rxAudio, dir, maxFileMb: 1, maxUserMb: 1, logger: { error() {} } });
    rec.start(alice);
    rxAudio.feed(2300); // > 1 MiB
    await settle();
    const [item] = rec.list(alice).items;
    assert.equal(item.endReason, 'size_limit');
    assert.ok(item.bytes <= 1024 * 1024, 'never above the cap');
    assert.equal(rxAudio.taps.size, 0);
    assert.throws(() => rec.start(alice), (e) => e.code === 'quota_exceeded' && e.status === 413);
    assert.doesNotThrow(() => rec.start(bob), 'quota is per user');
    rec.setEnabled(false);
    assert.equal(rec.status(bob), null, 'disabling stops running recordings');
    assert.throws(() => rec.start(alice), (e) => e.code === 'recording_disabled' && e.status === 403);
    assert.equal(rec.policy().enabled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recorder: refuses without an audio source and honours the config switch', () => {
  const dir = tmp();
  try {
    const db = openStationDb(':memory:');
    assert.throws(() => createRecorder({ db, rxAudio: null, dir }).start(alice), (e) => e.code === 'no_audio_source');
    const off = createRecorder({ db, rxAudio: fakeRxAudio(), dir, enabled: false });
    assert.throws(() => off.start(alice), (e) => e.code === 'recording_disabled');
    off.setEnabled(true);
    assert.equal(off.policy().enabled, false, 'the owner switch cannot override the configuration');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recorder: unfinished recordings are repaired on start-up', () => {
  const dir = tmp();
  try {
    const db = openStationDb(':memory:');
    const rxAudio = fakeRxAudio();
    const rec = createRecorder({ db, rxAudio, dir, logger: { error() {} } });
    const r = rec.start(alice);
    rxAudio.feed(5);
    const again = createRecorder({ db, rxAudio, dir, logger: { error() {} } });
    assert.equal(again.recoverUnfinished(), 1);
    const row = again.list(alice).items.find((x) => x.id === r.id);
    assert.equal(row.endReason, 'recovered');
    rec.stopAll();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- PWA scripts ----
test('scope-math: contrast, palettes, linear averaging, peak hold and zoom windows', () => {
  const { BHScope: S } = loadScript('scope-math.js');
  const gray = S.buildLut('grayscale', 0);
  assert.equal(gray.length, 768);
  assert.deepEqual([gray[0], gray[1], gray[2]], [0, 0, 0]);
  assert.deepEqual([gray[765], gray[766], gray[767]], [255, 255, 255]);
  const steep = S.buildLut('grayscale', 100);
  assert.ok(steep[100 * 3] < gray[100 * 3], 'positive contrast darkens the lower half');
  assert.equal(steep[255 * 3], 255);
  assert.equal(S.buildLut('nope', 0).length, 768, 'unknown palette falls back');
  assert.equal(S.applyContrast(0.5, 100), 0.5);
  assert.equal(S.applyContrast(1, 100), 1);

  const avg = S.createAverager(4);
  avg.push(new Uint8Array(4).fill(100));
  const out = avg.push(new Uint8Array(4).fill(200));
  assert.equal(out[0], 188, 'power-domain average, not a dB average (which would be 150)');
  const one = S.createAverager(1);
  assert.equal(one.push(new Uint8Array([10]))[0], 10);
  assert.equal(one.push(new Uint8Array([90]))[0], 90, 'one frame = no averaging');

  const ph = S.createPeakHold(0.5);
  ph.push(new Uint8Array([200]));
  assert.equal(ph.push(new Uint8Array([100]))[0], 199);
  assert.equal(S.createPeakHold(0).push(new Uint8Array([50]))[0], 50);

  assert.deepEqual({ ...S.zoomWindow(1, 0.3) }, { start: 0, end: 1 });
  assert.deepEqual({ ...S.zoomWindow(4, 0.9) }, { start: 0.75, end: 1 });
  assert.equal(S.zoomWindow(100, 0.5).end - S.zoomWindow(100, 0.5).start, 1 / 16, 'zoom is capped at 16x');
  assert.equal(S.windowToFull({ start: 0.5, end: 1 }, 0.5), 0.75);
  assert.equal(S.fullToWindow({ start: 0.5, end: 1 }, 0.75), 0.5);
});

test('shortcuts: Space is bound to PTT only and no other shortcut can arm or key the transmitter', () => {
  const { BHShortcuts: K } = loadScript('shortcuts.js');
  const keys = K.SHORTCUTS.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, 'one action per key');
  assert.equal(new Set(K.SHORTCUTS.map((s) => s.action)).size, K.SHORTCUTS.length, 'one key per action');
  const space = K.SHORTCUTS.filter((s) => s.key === ' ');
  assert.equal(space.length, 1);
  assert.equal(space[0].action, 'ptt');
  assert.equal(K.resolveShortcut({ key: ' ' }), 'ptt');
  for (const s of K.SHORTCUTS) {
    if (s.action !== 'ptt') assert.doesNotMatch(s.action, /(^|-)(ptt|key|arm|transmit|tx-on|tot)(-|$)/, s.action);
  }
  assert.ok(!keys.includes('Enter') && !keys.includes('Tab'), 'form and focus keys stay untouched');
  assert.equal(K.resolveShortcut({ key: 'r', ctrlKey: true }), null, 'browser combinations are not shortcuts');
  assert.equal(K.resolveShortcut({ key: 'r', metaKey: true }), null);
  assert.equal(K.resolveShortcut({ key: 'r' }), 'listen-toggle');
  assert.equal(K.resolveShortcut({ key: 'q' }), null);
});

test('features.js handles every shortcut except ptt and cannot reach PTT or the microphone', () => {
  const src = read('src/web/public/features.js');
  const { BHShortcuts: K } = loadScript('shortcuts.js');
  for (const s of K.SHORTCUTS) if (s.action !== 'ptt') assert.ok(src.includes(`'${s.action}'`) || new RegExp(`\\b${s.action}:`).test(src), s.action);
  assert.doesNotMatch(src, /\/api\/ptt|btn-ptt|btn-arm|keyDown|keyUp|openMic|getUserMedia/);
  assert.match(src, /e\.code === 'Space'/, 'Space events are explicitly ignored');
  assert.match(src, /isTyping\(e\.target\)/, 'typing in fields never triggers shortcuts');
  const app = read('src/web/public/app.js');
  assert.doesNotMatch(app.slice(app.indexOf('globalThis.BHApp')), /keyDown|keyUp|openMic|toggleArm/, 'the bridge exposes no TX function');
});

// ---- packaging ----
test('udev rules grant the bricohams group access to the supported SDR front ends', () => {
  const rules = read('packaging/linux/99-bricohams-sdr.rules');
  const wanted = ['0bda:2838', '0bda:2832', '1d50:60a1', '03eb:800c', '1df7:2500', '1d50:6089', '1d50:604b', '0456:b673'];
  for (const id of wanted) {
    const [v, p] = id.split(':');
    assert.match(rules, new RegExp(`idVendor\\}=="${v}", ATTRS\\{idProduct\\}=="${p}"`), id);
  }
  const lines = rules.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  assert.ok(lines.length >= wanted.length);
  for (const l of lines) {
    assert.match(l, /GROUP="bricohams"/);
    assert.match(l, /MODE="0660"/, 'never world-accessible');
    assert.doesNotMatch(l, /MODE="066[67]"|MODE="0666"/);
  }
});

test('kernel module blacklist covers the DVB-T drivers that grab RTL-SDR dongles', () => {
  const conf = read('packaging/linux/blacklist-bricohams-rtl.conf');
  for (const m of ['dvb_usb_rtl28xxu', 'rtl2832', 'rtl2830']) assert.match(conf, new RegExp(`^blacklist ${m}$`, 'm'));
});

test('the .deb installs rules and blacklist; postinst reloads udev; postrm removes the blacklist on purge', () => {
  const build = read('packaging/linux/build-deb.sh');
  assert.match(build, /99-bricohams-sdr\.rules"?\s+"\$PKG\/lib\/udev\/rules\.d\/99-bricohams-sdr\.rules/);
  assert.match(build, /blacklist-bricohams-rtl\.conf"?\s+"\$PKG\/etc\/modprobe\.d\/blacklist-bricohams-rtl\.conf/);
  assert.match(build, /DEBIAN\/postrm/);
  assert.match(build, /conffiles/);
  const post = read('packaging/linux/postinst');
  assert.match(post, /udevadm control --reload-rules/);
  assert.match(post, /plugdev/);
  assert.match(post, /dialout/);
  assert.doesNotMatch(post, /systemctl\s+(start|restart)/);
  const postrm = read('packaging/linux/postrm');
  assert.match(postrm, /purge/);
  assert.match(postrm, /rm -f \/etc\/modprobe\.d\/blacklist-bricohams-rtl\.conf/);
  assert.match(postrm, /udevadm control --reload-rules/);
});

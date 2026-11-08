import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { parseNotch, DEFAULT_NOTCH } from '../../src/modes/notch.js';
import { backoffDelay, createClusterClient } from '../../src/cluster/client.js';
import { parseQo100Spot, parseSpotLine, toQo100Downlink } from '../../src/cluster/parser.js';
import { parseIcs, upcoming } from '../../src/cluster/ics.js';
import { createCalendar } from '../../src/cluster/calendar.js';
import { createSpotStore } from '../../src/cluster/spots.js';
import { createWebhookDispatcher, signPayload, verifySignature, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../../src/plugins/webhooks.js';
import { resolvePluginFile } from '../../src/plugins/static.js';
import { openStationDb } from '../../src/modes/station-db.js';
import { createMemoryStore } from '../../src/modes/memories.js';
import { exportMemories, importMemories } from '../../src/modes/memory-io.js';
import { ConfigError, validateConfig } from '../../src/server/config.js';

const NOW = Date.UTC(2026, 10, 8, 12, 40);
const tick = () => new Promise((r) => setImmediate(r));

// ---- notch ----
test('parseNotch validates and merges', () => {
  assert.deepEqual(parseNotch({ enabled: true, offsetHz: 1500 }, DEFAULT_NOTCH).value, { enabled: true, offsetHz: 1500, widthHz: 50, auto: false });
  for (const bad of [{ offsetHz: 5 }, { offsetHz: 1500.5 }, { offsetHz: 99999 }]) assert.equal(parseNotch(bad).code, 'bad_notch_frequency');
  assert.equal(parseNotch({ widthHz: 5 }).code, 'bad_notch_width');
  assert.equal(parseNotch({ enabled: 'yes' }).code, 'bad_notch');
  assert.equal(parseNotch({ evil: 1 }).code, 'bad_notch');
  assert.equal(parseNotch(null).code, 'bad_notch');
});

// ---- DX cluster ----
test('spot lines in several real formats are parsed', () => {
  const a = parseQo100Spot('DX de EA4XXX:    10489700.0  A71AB        CQ QO-100 NB                  1234Z', NOW);
  assert.equal(a.dx, 'A71AB');
  assert.equal(a.spotter, 'EA4XXX');
  assert.equal(a.downlinkHz, 10_489_700_000);
  assert.equal(a.comment, 'CQ QO-100 NB');
  assert.equal(a.time, Date.UTC(2026, 10, 8, 12, 34));
  const b = parseQo100Spot('DX de dl1abc-#: 10489612.5 EA5KAO/P SSB 59 1101Z JN58', NOW);
  assert.equal(b.dx, 'EA5KAO/P');
  assert.equal(b.downlinkHz, 10_489_612_500);
  const c = parseSpotLine('DX de K1ABC: 14074.0 JA1XYZ FT8 1200Z', NOW);
  assert.equal(c.freqKhz, 14074);
  assert.equal(parseSpotLine('WWV de VE7CC <18>: SFI=100', NOW), null);
  assert.equal(parseSpotLine('x'.repeat(400), NOW), null);
});

test('uplink spots are converted to the downlink', () => {
  const s = parseQo100Spot('DX de DL1ABC: 2400200.0 EA5KAO USB 0800Z', NOW);
  assert.equal(s.given, 'uplink');
  assert.equal(s.downlinkHz, 10_489_700_000);
  assert.equal(s.uplinkHz, 2_400_200_000);
  assert.equal(toQo100Downlink(10_489_700_000).given, 'downlink');
});

test('out-of-band spots are dropped', () => {
  assert.equal(parseQo100Spot('DX de K1ABC: 14074.0 JA1XYZ FT8 1200Z', NOW), null);
  assert.equal(parseQo100Spot('DX de K1ABC: 10490500.0 JA1XYZ 1200Z', NOW), null);
  assert.equal(parseQo100Spot('DX de K1ABC: 10489400.0 JA1XYZ 1200Z', NOW), null);
  assert.equal(toQo100Downlink(Number.NaN), null);
});

test('spot store dedupes the same station on the same frequency', () => {
  const store = createSpotStore({ now: () => NOW });
  const spot = { spotter: 'A1B', dx: 'EA5KAO', downlinkHz: 10_489_700_000, uplinkHz: 2_400_200_000, comment: '', time: NOW };
  store.add(spot);
  store.add({ ...spot, downlinkHz: 10_489_700_050 });
  assert.equal(store.list().length, 1);
});

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.written = [];
    this.destroyed = false;
  }

  write(d) { this.written.push(String(d)); }

  destroy() { this.destroyed = true; }
}

test('backoffDelay doubles and is capped', () => {
  assert.deepEqual([0, 1, 2, 5].map((n) => backoffDelay(n)), [1000, 2000, 4000, 32000]);
  assert.equal(backoffDelay(30), 300_000);
});

test('cluster client logs in, emits spots and reconnects with backoff', () => {
  const sockets = [];
  const scheduled = [];
  const timers = { setTimeout: (fn, ms) => { scheduled.push({ fn, ms }); return { unref() {} }; }, clearTimeout() {} };
  const spots = [];
  const c = createClusterClient({
    host: 'cluster.example.org', port: 7300, callsign: 'EA4XXX', onSpot: (s) => spots.push(s), now: () => NOW, timers,
    connect: () => { const s = new FakeSocket(); sockets.push(s); return s; }, logger: { error() {} },
  });
  c.start();
  assert.equal(sockets.length, 1);
  sockets[0].emit('connect');
  sockets[0].emit('data', Buffer.from([255, 253, 1]));
  sockets[0].emit('data', Buffer.from('Please enter your call: '));
  assert.ok(sockets[0].written.includes('EA4XXX\r\n'));
  sockets[0].emit('data', Buffer.from('DX de A1B:  10489700.0  EA5KAO  test  1234Z\r\nDX de A1B: 14074.0 K1ABC FT8 1234Z\r\n'));
  assert.equal(spots.length, 1);
  assert.equal(c.status().state, 'online');
  sockets[0].emit('close');
  assert.equal(scheduled.at(-1).ms, 1000);
  scheduled.at(-1).fn();
  assert.equal(sockets.length, 2);
  sockets[1].emit('close');
  assert.equal(scheduled.at(-1).ms, 2000);
  scheduled.at(-1).fn();
  sockets[2].emit('close');
  assert.equal(scheduled.at(-1).ms, 4000);
  c.stop();
  const n = scheduled.length;
  sockets[2].emit('close');
  assert.equal(scheduled.length, n);
  assert.equal(c.status().state, 'stopped');
});

test('cluster client never posts unless the owner allowed it', () => {
  const sock = new FakeSocket();
  const mk = (allowPost) => createClusterClient({
    host: 'h.example.org', port: 7300, callsign: 'EA4XXX', onSpot() {}, allowPost, connect: () => sock,
    timers: { setTimeout: () => ({ unref() {} }), clearTimeout() {} }, logger: { error() {} },
  });
  const off = mk(false);
  off.start();
  assert.throws(() => off.post({ dx: 'EA5KAO', downlinkHz: 10_489_700_000 }), /posting_disabled/);
  const on = mk(true);
  assert.throws(() => on.post({ dx: 'EA5KAO', downlinkHz: 10_489_700_000 }), /not_connected/);
});

// ---- iCalendar ----
const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'UID:a1', 'DTSTART:20261108T190000Z', 'DTEND:20261108T200000Z',
  'SUMMARY:Weekly QO-100 net', '  folded', 'DESCRIPTION:Line one\\nline two', 'URL:https://example.org/net',
  'BEGIN:VALARM', 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a2', 'DTSTART;TZID=Europe/Madrid:20261115T200000', 'SUMMARY:CET event', 'URL:javascript:alert(1)', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a3', 'DTSTART;TZID=Europe/Madrid:20260708T200000', 'SUMMARY:CEST event', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a4', 'DTSTART;VALUE=DATE:20261201', 'SUMMARY:Contest', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:No start', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');

test('ics parser handles folded lines, UTC and TZID', () => {
  const ev = parseIcs(ICS);
  const by = Object.fromEntries(ev.map((e) => [e.uid, e]));
  assert.equal(ev.length, 4);
  assert.equal(by.a1.summary, 'Weekly QO-100 net folded');
  assert.equal(by.a1.start, Date.UTC(2026, 10, 8, 19));
  assert.equal(by.a1.end, Date.UTC(2026, 10, 8, 20));
  assert.equal(by.a1.description, 'Line one\nline two');
  assert.equal(by.a1.url, 'https://example.org/net');
  assert.equal(by.a2.start, Date.UTC(2026, 10, 15, 19));
  assert.equal(by.a2.url, null);
  assert.equal(by.a3.start, Date.UTC(2026, 6, 8, 18));
  assert.equal(by.a4.allDay, true);
});

test('upcoming keeps only current and near-future events', () => {
  const list = upcoming(parseIcs(ICS), NOW, { days: 30 });
  assert.deepEqual(list.map((e) => e.uid), ['a1', 'a2', 'a4']);
});

test('calendar is off unless enabled, enforces the size limit and never fetches when disabled', async () => {
  let calls = 0;
  const fetch = async () => { calls += 1; return new Response(ICS, { status: 200 }); };
  const off = createCalendar({ enabled: false, url: 'https://x.example/a.ics', fetch, logger: { error() {} } });
  await assert.rejects(off.refresh(), /calendar_disabled/);
  assert.equal(calls, 0);
  const small = createCalendar({ enabled: true, url: 'https://x.example/a.ics', fetch, maxBytes: 50, logger: { error() {} } });
  await assert.rejects(small.refresh(), /too_large/);
  const ok = createCalendar({ enabled: true, url: 'https://x.example/a.ics', fetch, now: () => NOW, logger: { error() {} } });
  assert.deepEqual(await ok.refresh(), { events: 4 });
  assert.ok(ok.list().length >= 2);
  const bad = createCalendar({ enabled: true, url: 'https://x.example/a.ics', fetch: async () => new Response('x', { status: 500 }), logger: { error() {} } });
  await assert.rejects(bad.refresh(), /http_500/);
  assert.throws(() => ok.load('not a calendar'), /no_events/);
});

// ---- memories import / export ----
const owner = { email: 'a@example.org', role: 'operator', callsign: 'EA4XXX' };
const other = { email: 'b@example.org', role: 'operator', callsign: 'EA4YYY' };
const mkStore = () => createMemoryStore({ db: openStationDb(':memory:') });

test('memories round trip through JSON and CSV', () => {
  const a = mkStore();
  a.add(owner, { name: 'Net, main', downlinkHz: 10_489_700_000, mode: 'USB', shared: false });
  a.add(owner, { name: '=Beacon', downlinkHz: 10_489_750_000, mode: 'CW', shared: false });
  for (const format of ['json', 'csv']) {
    const out = exportMemories(a.list(owner).filter((m) => m.mine), format, () => NOW);
    const b = mkStore();
    const res = importMemories({ store: b, user: other, format, content: out.body });
    assert.equal(res.imported, 2, format);
    assert.deepEqual(res.invalid, []);
    const names = b.list(other).filter((m) => m.mine).map((m) => m.name).sort();
    assert.deepEqual(names, ['=Beacon', 'Net, main']);
  }
});

test('import reports invalid rows, dedupes and supports dry run', () => {
  const s = mkStore();
  s.add(owner, { name: 'Existing', downlinkHz: 10_489_600_000, mode: 'USB', shared: false });
  const csv = [
    'Name,Frequency,Mode',
    'New one,10489.7,USB',
    'existing,10489.8,USB',
    'Same freq,10489.6,USB',
    'Bad freq,144.8,USB',
    'Bad mode,10489.9,WFM',
    'Dup in file,10489.7,USB',
  ].join('\n');
  const dry = importMemories({ store: s, user: owner, format: 'csv', content: csv, dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.imported, 1);
  assert.equal(dry.invalid.length, 2);
  assert.equal(dry.duplicates.length, 3);
  assert.equal(s.list(owner).filter((m) => m.mine).length, 1);
  const real = importMemories({ store: s, user: owner, format: 'csv', content: csv });
  assert.equal(real.imported, 1);
  assert.equal(s.list(owner).filter((m) => m.mine).length, 2);
});

test('import rejects malformed documents', () => {
  const s = mkStore();
  const run = (format, content) => importMemories({ store: s, user: owner, format, content });
  assert.throws(() => run('json', '{nope'), { code: 'bad_json' });
  assert.throws(() => run('json', JSON.stringify({ schema: 'other', version: 1, items: [] })), { code: 'bad_schema' });
  assert.throws(() => run('json', JSON.stringify({ schema: 'bricohams.memories', version: 99, items: [] })), { code: 'unsupported_version' });
  assert.throws(() => run('xml', '<a/>'), { code: 'bad_format' });
  assert.throws(() => run('csv', 'Foo,Bar\n1,2'), { code: 'missing_columns' });
});

// ---- webhooks ----
test('signature verifies and rejects tampering, wrong secret and replay', () => {
  const body = '{"a":1}';
  const sig = signPayload('s3cret-s3cret-s3cret', 1000, body);
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
  const ok = { secret: 's3cret-s3cret-s3cret', timestamp: 1000, body, signature: sig, nowSec: 1100 };
  assert.equal(verifySignature(ok), true);
  assert.equal(verifySignature({ ...ok, body: '{"a":2}' }), false);
  assert.equal(verifySignature({ ...ok, secret: 'other-other-other' }), false);
  assert.equal(verifySignature({ ...ok, nowSec: 5000 }), false);
  assert.equal(verifySignature({ ...ok, signature: 'sha256=00' }), false);
});

test('webhook events are signed, allow-listed and never carry secrets', async () => {
  const sent = [];
  const secret = 'whsec-0123456789abcdef';
  const d = createWebhookDispatcher({
    endpoints: [{ url: 'https://hooks.example.org/in', events: ['qso_logged', 'ptt_state', 'decode', 'spot'], secret }],
    fetch: async (url, opts) => { sent.push({ url, opts }); return { ok: true }; },
    now: () => NOW,
    logger: { error() {} },
  });
  d.emit('qso_logged', { call: 'EA5KAO', mode: 'SSB', apiKey: 'QRZ-KEY-123', email: 'op@example.org', token: 'tok' });
  d.emit('ptt_state', { state: 'TX_ON', txEnabled: true, holder: { callsign: 'EA4XXX', email: 'op@example.org' }, sessionId: 'sid' });
  d.emit('decode', { mode: 'FT8', slotStartMs: NOW, messages: [{ text: 'CQ EA5KAO IN80', snr: -5, cookie: 'c' }], csrf: 'x' });
  d.emit('nope', { call: 'x' });
  await tick();
  assert.equal(sent.length, 3);
  for (const { opts } of sent) {
    for (const bad of ['QRZ-KEY-123', 'op@example.org', 'tok', 'sid', 'whsec', 'cookie']) assert.ok(!opts.body.includes(bad), bad);
    assert.equal(opts.redirect, 'error');
    assert.equal(verifySignature({
      secret, timestamp: opts.headers[TIMESTAMP_HEADER], body: opts.body, signature: opts.headers[SIGNATURE_HEADER], nowSec: Math.floor(NOW / 1000),
    }), true);
  }
  assert.equal(JSON.parse(sent[0].opts.body).data.call, 'EA5KAO');
  assert.equal(d.stats().sent, 3);
});

test('webhook retries with exponential backoff then gives up, logging only the host', async () => {
  const scheduled = [];
  const logs = [];
  let calls = 0;
  const d = createWebhookDispatcher({
    endpoints: [{ url: 'https://hooks.example.org/path/SECRETTOKEN', events: ['spot'], secret: 'whsec-0123456789abcdef' }],
    fetch: async () => { calls += 1; return { ok: false }; },
    timers: { setTimeout: (fn, ms) => { scheduled.push({ fn, ms }); return { unref() {} }; } },
    maxRetries: 2,
    baseMs: 10,
    logger: { error: (...a) => logs.push(a.join(' ')) },
  });
  d.emit('spot', { dx: 'EA5KAO', downlinkHz: 10_489_700_000 });
  await tick();
  assert.equal(scheduled[0].ms, 10);
  scheduled[0].fn();
  await tick();
  assert.equal(scheduled[1].ms, 20);
  scheduled[1].fn();
  await tick();
  assert.equal(calls, 3);
  assert.equal(d.stats().failed, 1);
  assert.equal(d.stats().pending, 0);
  assert.ok(logs.length === 1 && !logs[0].includes('SECRETTOKEN'));
});

// ---- plugins ----
test('plugin files are served only for enabled names and never outside the plugin folder', () => {
  const root = resolve('plugins');
  const hit = resolvePluginFile(root, ['hello-panel'], '/plugins/hello-panel/index.js');
  assert.ok(hit && hit.file.startsWith(root) && hit.contentType.startsWith('text/javascript'));
  const denied = [
    '/plugins/other/index.js', '/plugins/hello-panel/../../config.json', '/plugins/hello-panel/%2e%2e/x.js', '/plugins/../index.js',
    '/plugins/hello-panel/..\\x.js', '/plugins/hello-panel/run.exe', '/plugins/hello-panel/', '/plugins//index.js', '/plugins/Hello-Panel/index.js',
    '/plugins/hello-panel/.env', '/plugins/examples/hello-panel/index.js',
  ];
  for (const p of denied) assert.equal(resolvePluginFile(root, ['hello-panel'], p), null, p);
});

const loaderSrc = readFileSync(new URL('../../src/web/public/plugin-loader.js', import.meta.url), 'utf8');
const loaderCtx = {};
vm.runInNewContext(loaderSrc, loaderCtx);

test('plugin API is frozen and exposes no ptt, mic, token or socket', () => {
  const { createPluginApi, validNames } = loaderCtx.BHPluginApi;
  const tuned = [];
  const B = {
    hooks: { station: [], message: [] },
    app: { station: { downlinkHz: 10_489_700_000, mode: 'USB' }, beacon: { status: 'locked', offsetHz: 1 }, csrf: 'SECRET', ws: {} },
    tune: (hz) => tuned.push(hz),
    $: () => null,
  };
  const api = createPluginApi(B, { name: 'x', panelHost: null });
  assert.ok(Object.isFrozen(api));
  assert.ok(Object.isFrozen(loaderCtx.BHPluginApi));
  const keys = Object.keys(api);
  assert.deepEqual(keys.sort(), ['prefillLog', 'registerPanel', 'requestTune', 'subscribe', 'topics', 'version']);
  assert.ok(!keys.some((k) => /ptt|mic|key|arm|token|csrf|socket|ws|send/i.test(k)));
  assert.throws(() => { api.ptt = () => {}; });
  const seen = [];
  api.subscribe('frequency', (v) => seen.push(v));
  B.hooks.station[0]({ downlinkHz: 10_489_800_000, mode: 'USB' });
  assert.deepEqual(seen, [10_489_700_000, 10_489_800_000]);
  assert.throws(() => api.subscribe('ptt', () => {}), { name: 'TypeError' });
  api.requestTune(10_489_900_000);
  assert.deepEqual(tuned, [10_489_900_000]);
  assert.deepEqual([...validNames(['ok-one', '../x', 'A', 'ok-one', 5, 'a/b'])], ['ok-one']);
});

// ---- config ----
const baseConfig = () => JSON.parse(readFileSync(new URL('../../config.example.json', import.meta.url), 'utf8'));
const ENV = { GOOGLE_CLIENT_SECRET: 'test-secret' };

test('new features are disabled by default and validated', () => {
  const raw = baseConfig();
  for (const k of ['iq', 'cluster', 'calendar', 'webhooks', 'plugins']) delete raw[k];
  const c = validateConfig(raw, ENV);
  assert.equal(c.iq.enabled, false);
  assert.equal(c.cluster.enabled, false);
  assert.equal(c.calendar.enabled, false);
  assert.equal(c.webhooks.enabled, false);
  assert.deepEqual([...c.plugins.enabled], []);
  assert.equal(c.beacon.engine, 'bricohams');
  assert.match(c.iq.dir, /iq/);
  const ex = validateConfig(baseConfig(), ENV);
  assert.equal(ex.cluster.enabled, false);
  assert.equal(ex.iq.enabled, false);
});

test('config rejects unsafe plugin names, missing webhook secrets and bad cluster settings', () => {
  const bad = (mutate) => {
    const raw = baseConfig();
    mutate(raw);
    return assert.throws(() => validateConfig(raw, ENV), ConfigError);
  };
  bad((r) => { r.plugins.enabled = ['../etc']; });
  bad((r) => { r.webhooks.enabled = true; });
  bad((r) => { r.webhooks.endpoints[0].url = 'http://hooks.example.org/x'; });
  bad((r) => { r.cluster.enabled = true; r.cluster.callsign = 'no good'; });
  bad((r) => { r.calendar.url = 'file:///etc/passwd'; });
  bad((r) => { r.beacon = { engine: 'magic' }; });
  bad((r) => { r.iq.dir = ''; });
  const raw = baseConfig();
  raw.webhooks.enabled = true;
  const c = validateConfig(raw, { ...ENV, BRICOHAMS_WEBHOOK_SECRET_1: 'a-long-enough-secret' });
  assert.equal(c.webhooks.endpoints[0].secret, 'a-long-enough-secret');
});

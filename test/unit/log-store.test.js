import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createLogStore, LogError, validateQso } from '../../src/log/store.js';
import { createSecretBox } from '../../src/log/secrets.js';

const NOW = new Date('2026-11-08T10:00:00Z');
const USER = { email: 'op@example.org', callsign: 'EA4AAA' };
const mk = (opts = {}) => createLogStore({ path: ':memory:', clock: () => NOW, ...opts });
const base = (o = {}) => ({
  call: 'DL1ABC', qso_date: '20261108', time_on: '0945', mode: 'SSB', freq: 2400.3, freq_rx: 10489.8, ...o,
});
const fails = (fn, code) => assert.throws(fn, (e) => e instanceof LogError && e.code === code);

test('adds a QSO with the fixed satellite fields and the session identity', () => {
  const s = mk();
  const q = s.add(base({ call: 'dl1abc', gridsquare: 'jn58' }), USER);
  assert.equal(q.call, 'DL1ABC');
  assert.equal(q.time_on, '094500');
  assert.equal(q.submode, 'USB');
  assert.equal(q.rst_sent, '59');
  assert.equal(q.gridsquare, 'JN58');
  assert.deepEqual([q.band, q.band_rx, q.prop_mode, q.sat_name], ['13CM', '3CM', 'SAT', 'QO-100']);
  assert.deepEqual([q.station_callsign, q.operator, q.created_by], ['EA4AAA', 'EA4AAA', 'op@example.org']);
  assert.equal([q.lotw_status, q.qrz_status].join(), 'none,none');
  assert.equal(s.schemaVersion(), 1);
});

test('client cannot override identity or satellite fields', () => {
  const q = mk().add(base({ station_callsign: 'W1AW', created_by: 'x', band: '70CM', sat_name: 'ISS', lotw_status: 'uploaded' }), USER);
  assert.deepEqual([q.station_callsign, q.created_by, q.band, q.sat_name, q.lotw_status], ['EA4AAA', 'op@example.org', '13CM', 'QO-100', 'none']);
});

test('RST rules per mode', () => {
  assert.equal(validateQso(base({ mode: 'CW' }), { now: NOW }).value.rst_sent, '599');
  assert.equal(validateQso(base({ mode: 'CW', rst_sent: '579' }), { now: NOW }).value.rst_sent, '579');
  assert.equal(validateQso(base({ mode: 'CW', rst_sent: '59' }), { now: NOW }).errors.rst_sent, 'invalid');
  assert.equal(validateQso(base({ rst_rcvd: '599' }), { now: NOW }).errors.rst_rcvd, 'invalid');
  assert.equal(validateQso(base({ mode: 'FT8' }), { now: NOW }).errors.rst_sent, 'required');
  const ft = validateQso(base({ mode: 'FT4', rst_sent: -7, rst_rcvd: '+3' }), { now: NOW }).value;
  assert.deepEqual([ft.rst_sent, ft.rst_rcvd, ft.submode], ['-07', '+03', null]);
  assert.equal(validateQso(base({ mode: 'FT8', rst_sent: '-99', rst_rcvd: '0' }), { now: NOW }).errors.rst_sent, 'invalid');
});

test('input validation', () => {
  const e = (o) => validateQso(base(o), { now: NOW }).errors;
  assert.equal(e({ call: 'NOTACALL!' }).call, 'invalid');
  assert.equal(e({ call: "X'); DROP TABLE qsos;--" }).call, 'invalid');
  assert.equal(e({ mode: 'AM' }).mode, 'invalid');
  assert.equal(e({ freq: 145.5 }).freq, 'out_of_range');
  assert.equal(e({ freq_rx: 'abc' }).freq_rx, 'out_of_range');
  assert.equal(e({ qso_date: '20261331' }).time_on, 'invalid');
  assert.equal(e({ time_on: '2561' }).time_on, 'invalid');
  assert.equal(e({ time_on: '2359', qso_date: '20261109' }).time_on, 'in_future');
  assert.equal(e({ gridsquare: 'ZZ99' }).gridsquare, 'invalid');
  assert.equal(e({ comment: 'x'.repeat(201) }).comment, 'too_long');
  assert.equal(e({ call: { $ne: 1 } }).call, 'invalid_type');
  assert.equal(validateQso(base({ comment: 'a\nb\u0000c' }), { now: NOW }).value.comment, 'a b c');
  assert.equal(validateQso(base({ freq: '2400.123456789' }), { now: NOW }).value.freq, 2400.123457);
});

test('duplicates: same call and mode within 10 minutes', () => {
  const s = mk();
  const first = s.add(base(), USER);
  assert.throws(() => s.add(base({ time_on: '0954' }), USER), (e) => e.code === 'duplicate' && e.status === 409 && e.existingId === first.id);
  assert.throws(() => s.add(base({ time_on: '0935' }), USER), (e) => e.code === 'duplicate');
  s.add(base({ time_on: '0956' }), USER); // 11 min away
  s.add(base({ mode: 'CW', time_on: '0946' }), USER); // other mode
  s.add(base({ call: 'DL1ABD', time_on: '0946' }), USER); // other call
  s.add(base({ time_on: '0946' }), USER, { force: true });
});

test('list, get, update, remove', () => {
  const s = mk();
  const a = s.add(base(), USER);
  s.add(base({ call: 'EA4XYZ', time_on: '0950' }), USER);
  const l = s.list();
  assert.equal(l.total, 2);
  assert.equal(l.items[0].call, 'EA4XYZ');
  assert.equal(s.list({ call: 'dl1' }).total, 1);
  assert.equal(s.list({ call: '%' }).total, 0, 'LIKE wildcards are escaped');
  assert.equal(s.list({ limit: 1, offset: 1 }).items[0].id, a.id);

  const u = s.update(a.id, { rst_rcvd: '57', comment: 'nice', id: 99, station_callsign: 'W1AW', lotw_status: 'uploaded' });
  assert.deepEqual([u.rst_rcvd, u.comment, u.id, u.station_callsign, u.lotw_status], ['57', 'nice', a.id, 'EA4AAA', 'none']);
  fails(() => s.update(a.id, { mode: 'FT8' }), 'validation'); // 59 is not a dB report
  fails(() => s.update(a.id, { call: 'EA4XYZ', time_on: '0951' }), 'duplicate');
  fails(() => s.update(999, {}), 'not_found');
  assert.equal(s.remove(a.id), true);
  assert.equal(s.remove(a.id), false);
  assert.equal(s.get(a.id), null);
});

test('upload status is whitelisted', () => {
  const s = mk();
  const q = s.add(base(), USER);
  s.setUploadStatus(q.id, { lotw_status: 'uploaded', qrz_status: 'sent', qrz_logid: 123 });
  assert.deepEqual([s.get(q.id).lotw_status, s.get(q.id).qrz_status, s.get(q.id).qrz_logid], ['uploaded', 'sent', '123']);
  fails(() => s.setUploadStatus(q.id, { lotw_status: "x'; --" }), 'validation');
});

test('secrets are encrypted at rest, per user, and survive reopening', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bh-log-'));
  const path = join(dir, 'sub', 'logbook.db');
  const key = randomBytes(32);
  let s = createLogStore({ path, secretBox: createSecretBox(key) });
  s.setSecret('op@example.org', 'qrz_api_key', 'AAAA-BBBB-CCCC-DDDD');
  assert.equal(s.getSecret('op@example.org', 'qrz_api_key'), 'AAAA-BBBB-CCCC-DDDD');
  assert.equal(s.getSecret('other@example.org', 'qrz_api_key'), null);
  assert.equal(s.hasSecret('op@example.org', 'qrz_api_key'), true);
  s.close();
  assert.ok(!readFileSync(path).includes('AAAA-BBBB'), 'plaintext not in the database file');
  s = createLogStore({ path, secretBox: createSecretBox(key) });
  assert.equal(s.getSecret('op@example.org', 'qrz_api_key'), 'AAAA-BBBB-CCCC-DDDD');
  assert.equal(s.schemaVersion(), 1, 'migrations are idempotent');
  assert.equal(s.deleteSecret('op@example.org', 'qrz_api_key'), true);
  s.close();
  fails(() => mk().setSecret('a', 'b', 'c'), 'secrets_unavailable');
});

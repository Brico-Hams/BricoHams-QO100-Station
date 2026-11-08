import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLogStore } from '../../src/log/store.js';
import { field, importAdif, parseAdif, programVersion, qsoToAdifRecord, toAdif } from '../../src/log/adif.js';

const NOW = new Date('2026-11-08T10:00:00Z');
const USER = { email: 'op@example.org', callsign: 'EA4AAA' };
const mk = () => createLogStore({ path: ':memory:', clock: () => NOW });
const base = (o = {}) => ({ call: 'DL1ABC', qso_date: '20261108', time_on: '094500', mode: 'SSB', freq: 2400.3, freq_rx: 10489.8, ...o });

test('SAT fields and header', () => {
  const s = mk();
  const q = s.add(base({ gridsquare: 'JN58', my_gridsquare: 'IN80' }), USER);
  const adif = toAdif([q], { now: NOW });
  const { header, records } = parseAdif(adif);
  assert.equal(header.ADIF_VER, '3.1.4');
  assert.equal(header.PROGRAMID, 'BricoHams-QO100-Station');
  assert.equal(header.PROGRAMVERSION, JSON.parse(readFileSync('package.json', 'utf8')).version);
  assert.equal(header.PROGRAMVERSION, programVersion());
  assert.equal(header.CREATED_TIMESTAMP, '20261108 100000');
  assert.equal(records.length, 1);
  const r = records[0];
  assert.deepEqual(
    [r.PROP_MODE, r.SAT_NAME, r.BAND, r.BAND_RX, r.FREQ, r.FREQ_RX, r.MODE, r.SUBMODE, r.STATION_CALLSIGN, r.OPERATOR],
    ['SAT', 'QO-100', '13CM', '3CM', '2400.3', '10489.8', 'SSB', 'USB', 'EA4AAA', 'EA4AAA'],
  );
  assert.ok(adif.includes('<FREQ:6>2400.3'));
  assert.ok(adif.includes('<EOH>'));
});

test('FT4 is MFSK/FT4, FT8 and CW are plain modes', () => {
  const s = mk();
  const ft4 = s.add(base({ mode: 'FT4', rst_sent: -5, rst_rcvd: -9 }), USER);
  const ft8 = s.add(base({ mode: 'FT8', time_on: '0900', rst_sent: -5, rst_rcvd: -9 }), USER);
  const cw = s.add(base({ mode: 'CW', time_on: '0800' }), USER);
  const rec = (q) => parseAdif(qsoToAdifRecord(q)).records[0];
  assert.deepEqual([rec(ft4).MODE, rec(ft4).SUBMODE], ['MFSK', 'FT4']);
  assert.deepEqual([rec(ft8).MODE, rec(ft8).SUBMODE], ['FT8', undefined]);
  assert.deepEqual([rec(cw).MODE, rec(cw).SUBMODE, rec(cw).RST_SENT], ['CW', undefined, '599']);
});

test('lengths are UTF-8 bytes', () => {
  assert.equal(field('COMMENT', 'Ñandú 日本'), `<COMMENT:${Buffer.byteLength('Ñandú 日本')}>Ñandú 日本`);
  assert.equal(Buffer.byteLength('Ñandú 日本'), 14);
  assert.equal(field('X', ''), '');
  const s = mk();
  const q = s.add(base({ comment: 'Ñandú 日本 <EOR> <CALL:3>XXX' }), USER);
  const parsed = parseAdif(Buffer.from(toAdif([q]), 'utf8'));
  assert.equal(parsed.records[0].COMMENT, 'Ñandú 日本 <EOR> <CALL:3>XXX');
  assert.equal(parsed.records.length, 1);
});

test('round trip through export and import preserves every field', () => {
  const src = mk();
  src.add(base({ gridsquare: 'JN58QL', my_gridsquare: 'IN80', comment: 'Ñ ok', rst_rcvd: '57' }), USER);
  src.add(base({ call: 'EA4XYZ', mode: 'FT4', time_on: '0930', rst_sent: '-12', rst_rcvd: '+03' }), USER);
  src.add(base({ call: 'G4ABC', mode: 'CW', time_on: '0915', freq: 2400.123456 }), USER);
  src.add(base({ call: 'F6AAA', mode: 'FT8', time_on: '0920', rst_sent: '-20', rst_rcvd: '-18' }), USER);
  const adif = toAdif(src.listForExport(), { now: NOW });

  const dst = mk();
  const r = importAdif(dst, adif, USER);
  assert.equal(r.imported, 4);
  assert.deepEqual(r.skipped, []);
  const strip = ({ id, created_at, ...rest }) => rest;
  assert.deepEqual(dst.listForExport().map(strip), src.listForExport().map(strip));
  assert.equal(toAdif(dst.listForExport(), { now: NOW }), adif);
});

test('import skips unsupported modes, duplicates and invalid records without aborting', () => {
  const adif = '<ADIF_VER:5>3.1.4<EOH>\n'
    + '<CALL:6>DL1ABC<QSO_DATE:8>20261108<TIME_ON:4>0945<MODE:3>SSB<FREQ:6>2400.3<FREQ_RX:7>10489.8<EOR>\n'
    + '<CALL:6>DL1ABC<QSO_DATE:8>20261108<TIME_ON:4>0950<MODE:3>SSB<FREQ:6>2400.3<FREQ_RX:7>10489.8<EOR>\n'
    + '<CALL:6>DL1ABD<QSO_DATE:8>20261108<TIME_ON:4>0945<MODE:2>FM<FREQ:6>2400.3<FREQ_RX:7>10489.8<EOR>\n'
    + '<CALL:3>BAD<QSO_DATE:8>20261108<TIME_ON:4>0945<MODE:3>USB<FREQ:6>145.50<EOR>\n';
  const r = importAdif(mk(), adif, USER);
  assert.equal(r.imported, 1);
  assert.deepEqual(r.skipped.map((s) => [s.index, s.reason]).sort(), [[1, 'duplicate'], [2, 'unsupported_mode'], [3, 'validation']]);
});

test('parser handles files without header and rejects truncated fields', () => {
  assert.equal(parseAdif('<CALL:3>EA4<EOR>').records[0].CALL, 'EA4');
  assert.deepEqual(parseAdif('').records, []);
  assert.throws(() => parseAdif('<CALL:30>EA4<EOR>'), /truncated/);
  assert.throws(() => parseAdif('<CALL:x>EA4<EOR>'), /length/);
});

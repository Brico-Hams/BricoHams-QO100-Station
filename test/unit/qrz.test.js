import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQrzClient, parseQrzResponse } from '../../src/log/qrz.js';

const QSO = {
  call: 'DL1ABC', qso_date: '20261108', time_on: '094500', mode: 'SSB', submode: 'USB', freq: 2400.3, freq_rx: 10489.8,
  rst_sent: '59', rst_rcvd: '59', station_callsign: 'EA4AAA', operator: 'EA4AAA',
};
const KEY = 'AAAA-BBBB-CCCC-DDDD';

function client(reply, calls = []) {
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (reply instanceof Error) throw reply;
    return new Response(reply.body, { status: reply.status ?? 200 });
  };
  return createQrzClient({ fetch });
}

test('success: posts KEY, ACTION=INSERT and one ADIF record', async () => {
  const calls = [];
  const r = await client({ body: 'RESULT=OK&LOGID=130877825&COUNT=1' }, calls).insert(KEY, QSO);
  assert.deepEqual(r, { status: 'inserted', ok: true, logId: '130877825', reason: null });
  assert.equal(calls[0].url, 'https://logbook.qrz.com/api');
  assert.equal(calls[0].init.method, 'POST');
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get('KEY'), KEY);
  assert.equal(form.get('ACTION'), 'INSERT');
  assert.match(form.get('ADIF'), /^<CALL:6>DL1ABC.*<SAT_NAME:6>QO-100.*<EOR>/s);
  assert.equal((form.get('ADIF').match(/<EOR>/g) ?? []).length, 1);
  assert.match(calls[0].init.headers['User-Agent'], /^BricoHams-QO100-Station\/\d/);
});

test('authentication failure', async () => {
  for (const reply of [{ body: 'RESULT=AUTH&REASON=invalid api key' }, { body: '', status: 403 }]) {
    const r = await client(reply).insert(KEY, QSO);
    assert.equal(r.status, 'auth_failed');
    assert.equal(r.ok, false);
  }
});

test('duplicate QSO', async () => {
  const r = await client({ body: 'RESULT=FAIL&REASON=Unable to add QSO to database: duplicate' }).insert(KEY, QSO);
  assert.equal(r.status, 'duplicate');
  assert.equal(r.ok, false);
});

test('other failures never throw and never echo the key', async () => {
  const fail = await client({ body: 'RESULT=FAIL&REASON=wrong station callsign for this logbook' }).insert(KEY, QSO);
  assert.deepEqual([fail.status, fail.reason], ['error', 'wrong station callsign for this logbook']);
  assert.equal((await client({ body: 'oops', status: 500 }).insert(KEY, QSO)).reason, 'http_500');
  const net = await client(new Error(`connect failed for ${KEY}`)).insert(KEY, QSO);
  assert.deepEqual([net.status, net.reason], ['error', 'network']);
  assert.ok(!JSON.stringify([fail, net]).includes(KEY));
});

test('response parser', () => {
  assert.deepEqual(parseQrzResponse('RESULT=OK&LOGID=5\n'), { result: 'OK', logId: '5', reason: null });
  assert.equal(parseQrzResponse('').result, '');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLotwUploader, mapExitCode } from '../../src/log/lotw.js';

const QSO = {
  call: 'DL1ABC', qso_date: '20261108', time_on: '094500', mode: 'SSB', submode: 'USB', freq: 2400.3, freq_rx: 10489.8,
  rst_sent: '59', rst_rcvd: '59', station_callsign: 'EA4AAA', operator: 'EA4AAA',
};

function fakeRunner(exitCode, seen = {}) {
  return async (file, args, opts) => {
    seen.file = file;
    seen.args = args;
    seen.opts = opts;
    seen.path = args.at(-1);
    seen.existedDuring = existsSync(seen.path);
    seen.content = readFileSync(seen.path, 'utf8');
    return { exitCode, stdout: '', stderr: '' };
  };
}

test('invokes tqsl with an argument array and a temp ADIF file that is removed afterwards', async () => {
  const seen = {};
  const up = createLotwUploader({ tqslPath: '/opt/tqsl/tqsl', stationLocation: 'QO-100 EA4AAA', runner: fakeRunner(0, seen) });
  const r = await up.upload([QSO]);
  assert.equal(seen.file, '/opt/tqsl/tqsl');
  assert.deepEqual(seen.args.slice(0, -1), ['-q', '-d', '-u', '-a', 'compliant', '-l', 'QO-100 EA4AAA', '-x']);
  assert.match(seen.path, /\.adi$/);
  assert.equal(seen.existedDuring, true);
  assert.match(seen.content, /<PROP_MODE:3>SAT/);
  assert.equal(existsSync(seen.path), false);
  assert.equal(existsSync(dirname(seen.path)), false);
  assert.equal(r.ok, true);
  assert.equal(r.status, 'uploaded');
  assert.equal(r.storeStatus, 'uploaded');
});

test('temp file is removed even when the runner throws', async () => {
  let path;
  const up = createLotwUploader({
    tqslPath: 'tqsl',
    stationLocation: 'loc',
    runner: async (_f, args) => { path = args.at(-1); throw new Error('boom'); },
  });
  await assert.rejects(up.upload([QSO]), /boom/);
  assert.equal(existsSync(path), false);
});

test('exit codes map to clear statuses', () => {
  const s = (c) => mapExitCode(c).status;
  assert.equal(s(0), 'uploaded');
  assert.equal(s(9), 'uploaded_with_duplicates');
  assert.equal(mapExitCode(9).ok, true);
  assert.equal(s(8), 'duplicate');
  assert.equal(mapExitCode(8).storeStatus, 'duplicate');
  assert.equal(s(1), 'cancelled');
  assert.equal(s(2), 'rejected');
  assert.equal(s(6), 'file_error');
  assert.equal(s(10), 'usage_error');
  assert.equal(s(11), 'network_error');
  assert.equal(s(3), 'error');
  assert.equal(s(99), 'error');
  assert.equal(s('ENOENT'), 'not_found');
  assert.equal(s('TIMEOUT'), 'timeout');
  for (const c of [1, 2, 3, 4, 5, 6, 7, 10, 11, 99, 'ENOENT']) {
    assert.equal(mapExitCode(c).ok, false);
    assert.equal(mapExitCode(c).storeStatus, 'failed');
  }
});

test('failure exit codes surface through upload()', async () => {
  const up = createLotwUploader({ tqslPath: 'tqsl', stationLocation: 'loc', runner: fakeRunner(11) });
  const r = await up.upload([QSO]);
  assert.deepEqual([r.ok, r.status, r.exitCode], [false, 'network_error', 11]);
});

test('rejects bad configuration and empty uploads', async () => {
  assert.throws(() => createLotwUploader({ tqslPath: '', stationLocation: 'x' }), TypeError);
  assert.throws(() => createLotwUploader({ tqslPath: 'tqsl', stationLocation: '-evil' }), TypeError);
  await assert.rejects(createLotwUploader({ tqslPath: 'tqsl', stationLocation: 'x', runner: fakeRunner(0) }).upload([]), TypeError);
});

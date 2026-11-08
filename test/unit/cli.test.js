import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../../src/server/cli.js';

function run(argv, deps = {}) {
  const out = [];
  const err = [];
  const code = runCli(argv, {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    loadConfig: () => ({ resetCodePath: '/data/ptt-reset-code' }),
    readFile: () => '12345678\n',
    ...deps,
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('reset-lockout prints instructions and the code file path but not the code', () => {
  const r = run(['reset-lockout']);
  assert.equal(r.code, 0);
  assert.match(r.out, /\/data\/ptt-reset-code/);
  assert.doesNotMatch(r.out, /12345678/);
});

test('reset-lockout --show prints the current code', () => {
  const r = run(['reset-lockout', '--show']);
  assert.equal(r.code, 0);
  assert.match(r.out, /12345678/);
});

test('reset-lockout --show fails cleanly when there is no valid code', () => {
  const r = run(['reset-lockout', '--show'], { readFile: () => { throw new Error('ENOENT'); } });
  assert.equal(r.code, 1);
  assert.match(r.err, /no valid reset code/);
});

test('unknown commands print usage', () => {
  assert.equal(run(['bogus']).code, 2);
  assert.equal(run([]).code, 2);
});

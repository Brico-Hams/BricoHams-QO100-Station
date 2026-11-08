import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('electron shell is sandboxed and restricts permissions', () => {
  const src = read('electron/main.js');
  assert.match(src, /sandbox:\s*true/);
  assert.match(src, /nodeIntegration:\s*false/);
  assert.match(src, /contextIsolation:\s*true/);
  assert.match(src, /setPermissionRequestHandler/);
  assert.match(src, /requestSingleInstanceLock/);
  assert.doesNotMatch(src, /preload/);
});

test('systemd unit is hardened and runs as bricohams', () => {
  const unit = read('packaging/linux/bricohams-qo100.service');
  assert.match(unit, /^NoNewPrivileges=true$/m);
  assert.match(unit, /^User=bricohams$/m);
  assert.match(unit, /^ProtectSystem=strict$/m);
  assert.match(unit, /^EnvironmentFile=\/etc\/bricohams-qo100\/env$/m);
});

test('build-deb.sh verifies the Node tarball SHA256 and fails on error', () => {
  const sh = read('packaging/linux/build-deb.sh');
  assert.match(sh, /set -euo pipefail/);
  assert.match(sh, /SHASUMS256\.txt/);
  assert.match(sh, /sha256sum/);
  assert.match(sh, /mismatch/);
});

test('postinst never enables or starts TX', () => {
  const post = read('packaging/linux/postinst');
  assert.doesNotMatch(post, /BRICOHAMS_TX_ENABLED/);
  assert.doesNotMatch(post, /"enabled"\s*:\s*true/);
  assert.doesNotMatch(post, /systemctl\s+(start|restart)/);
  assert.match(post, /0640/);
});

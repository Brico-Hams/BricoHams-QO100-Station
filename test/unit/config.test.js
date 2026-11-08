import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ConfigError, loadConfig, redactConfig, validateConfig } from '../../src/server/config.js';

const ENV = { GOOGLE_CLIENT_SECRET: 'shh-secret' };

function base(extra = {}) {
  return {
    port: 8443,
    host: '127.0.0.1',
    google: { clientId: 'id.apps.googleusercontent.com' },
    allowlist: [
      { email: 'Owner@Example.org', callsign: 'ea4xxx', role: 'owner' },
      { email: 'op@example.org', callsign: 'W1AW', role: 'operator' },
    ],
    ...extra,
  };
}

function problems(raw, env = ENV) {
  try {
    validateConfig(raw, env);
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    return err.problems.join('\n');
  }
  assert.fail('expected ConfigError');
}

test('recording and stationDbPath get safe defaults and are validated', () => {
  const c = validateConfig(base(), ENV);
  assert.deepEqual({ ...c.recording }, { enabled: true, dir: './data/recordings', maxFileMb: 100, maxUserMb: 1000 });
  assert.equal(c.stationDbPath, './data/station.db');
  assert.ok(Object.isFrozen(c.recording));
  assert.match(problems(base({ recording: { maxFileMb: 0 } })), /recording\.maxFileMb/);
  assert.match(problems(base({ recording: { maxFileMb: 50, maxUserMb: 10 } })), /recording\.maxUserMb/);
  assert.match(problems(base({ recording: { enabled: 'maybe' } })), /recording\.enabled/);
  assert.match(problems(base({ stationDbPath: '' })), /stationDbPath/);
});

test('valid config gets defaults and normalization', () => {
  const c = validateConfig(base(), ENV);
  assert.equal(c.tx.enabled, false);
  assert.equal(c.tx.totSeconds, 600);
  assert.equal(c.tx.heartbeatTimeoutMs, 2000);
  assert.equal(c.publicUrl, 'http://localhost:8443');
  assert.equal(c.allowlist[0].email, 'owner@example.org');
  assert.equal(c.allowlist[0].callsign, 'EA4XXX');
  assert.equal(c.google.clientSecret, 'shh-secret');
  assert.equal(c.secretsKey, null);
  assert.ok(Object.isFrozen(c));
});

test('client secret is rejected in the file and required in env', () => {
  assert.match(problems(base({ google: { clientId: 'x', clientSecret: 'bad' } })), /GOOGLE_CLIENT_SECRET/);
  assert.match(problems(base(), {}), /GOOGLE_CLIENT_SECRET environment variable is required/);
});

test('plain HTTP is only allowed for localhost', () => {
  assert.match(problems(base({ host: '0.0.0.0' })), /loopback/);
  assert.match(problems(base({ publicUrl: 'http://example.org' })), /localhost/);
  const tlsCfg = base({ host: '0.0.0.0', tls: { certPath: 'c', keyPath: 'k' }, publicUrl: 'https://example.org' });
  assert.equal(validateConfig(tlsCfg, ENV).publicUrl, 'https://example.org');
  assert.match(problems({ ...tlsCfg, publicUrl: 'http://localhost:8443' }), /https/);
});

test('tls needs both cert and key', () => {
  assert.match(problems(base({ tls: { certPath: 'c' } })), /both/);
});

test('allowlist validation', () => {
  assert.match(problems(base({ allowlist: [] })), /non-empty/);
  assert.match(problems(base({ allowlist: [{ email: 'bad', callsign: 'EA4XXX', role: 'owner' }] })), /email is invalid/);
  assert.match(problems(base({ allowlist: [{ email: 'a@b.org', callsign: '???', role: 'owner' }] })), /callsign is invalid/);
  assert.match(problems(base({ allowlist: [{ email: 'a@b.org', callsign: 'EA4XXX', role: 'root' }] })), /role must be/);
  assert.match(problems(base({ allowlist: [{ email: 'a@b.org', callsign: 'EA4XXX', role: 'operator' }] })), /at least one owner/);
  const dup = [
    { email: 'a@b.org', callsign: 'EA4XXX', role: 'owner' },
    { email: 'A@b.org', callsign: 'EA4YYY', role: 'operator' },
  ];
  assert.match(problems(base({ allowlist: dup })), /duplicated/);
});

test('tx limits: heartbeat timeout may not exceed 2 s', () => {
  assert.match(problems(base({ tx: { heartbeatTimeoutMs: 5000 } })), /heartbeatTimeoutMs/);
  assert.match(problems(base({ tx: { totSeconds: 0 } })), /totSeconds/);
  assert.equal(validateConfig(base({ tx: { enabled: true } }), ENV).tx.enabled, true);
});

test('env overrides', () => {
  const c = validateConfig(base(), {
    ...ENV,
    BRICOHAMS_PORT: '9000',
    BRICOHAMS_TX_ENABLED: 'true',
    BRICOHAMS_SDRANGEL_URL: 'http://10.0.0.5:8091/',
    GOOGLE_CLIENT_ID: 'env-id',
    BRICOHAMS_SECRETS_KEY: 'ab'.repeat(32),
  });
  assert.equal(c.port, 9000);
  assert.equal(c.tx.enabled, true);
  assert.equal(c.sdrangel.baseUrl, 'http://10.0.0.5:8091');
  assert.equal(c.google.clientId, 'env-id');
  assert.equal(c.secretsKey.length, 32);
  assert.match(problems(base(), { ...ENV, BRICOHAMS_SECRETS_KEY: 'short' }), /SECRETS_KEY/);
  assert.match(problems(base(), { ...ENV, BRICOHAMS_PORT: '99999' }), /port/);
});

test('redactConfig hides secrets', () => {
  const c = validateConfig(base(), { ...ENV, BRICOHAMS_SECRETS_KEY: 'cd'.repeat(32) });
  const text = JSON.stringify(redactConfig(c));
  assert.ok(!text.includes('shh-secret'));
  assert.ok(!text.includes('cdcd'));
});

test('loadConfig reads BRICOHAMS_CONFIG and reports unreadable/invalid files', () => {
  const files = { '/etc/b.json': JSON.stringify(base()), '/etc/bad.json': '{nope' };
  const readFile = (p) => {
    if (!(p in files)) throw Object.assign(new Error('x'), { code: 'ENOENT' });
    return files[p];
  };
  assert.equal(loadConfig({ env: { ...ENV, BRICOHAMS_CONFIG: '/etc/b.json' }, readFile }).port, 8443);
  assert.throws(() => loadConfig({ env: { ...ENV, BRICOHAMS_CONFIG: '/nope' }, readFile }), /cannot read/);
  assert.throws(() => loadConfig({ env: { ...ENV, BRICOHAMS_CONFIG: '/etc/bad.json' }, readFile }), /not valid JSON/);
});

test('config.example.json is valid and contains no secrets', () => {
  const raw = JSON.parse(readFileSync(new URL('../../config.example.json', import.meta.url), 'utf8'));
  const c = validateConfig(raw, ENV);
  assert.equal(c.tx.enabled, false);
});

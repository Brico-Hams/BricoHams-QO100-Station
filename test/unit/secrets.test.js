import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createSecretBox, secretsKeyFromEnv, SecretsError } from '../../src/log/secrets.js';

const box = () => createSecretBox(randomBytes(32));

test('round trip, including non-ASCII and empty strings', () => {
  const b = box();
  for (const s of ['abcd-1234-efgh-5678', '', 'clave ñ 日本']) {
    assert.equal(b.decrypt(b.encrypt(s)), s);
  }
});

test('token does not contain the plaintext and uses a fresh IV each time', () => {
  const b = box();
  const t1 = b.encrypt('SECRET-API-KEY');
  const t2 = b.encrypt('SECRET-API-KEY');
  assert.ok(!t1.includes('SECRET'));
  assert.notEqual(t1, t2);
  const [v, iv] = t1.split('.');
  assert.equal(v, 'v1');
  assert.equal(Buffer.from(iv, 'base64url').length, 12);
});

test('tampering with any part is detected', () => {
  const b = box();
  const parts = b.encrypt('secret').split('.');
  for (let i = 1; i < 4; i++) {
    const buf = Buffer.from(parts[i], 'base64url');
    buf[0] ^= 1;
    const bad = [...parts];
    bad[i] = buf.toString('base64url');
    assert.throws(() => b.decrypt(bad.join('.')), (e) => e instanceof SecretsError && e.code === 'decrypt_failed');
  }
  assert.throws(() => b.decrypt('garbage'), SecretsError);
});

test('wrong key or wrong associated data fails', () => {
  const a = box();
  const t = a.encrypt('secret', 'user@example.org\nqrz');
  assert.throws(() => box().decrypt(t, 'user@example.org\nqrz'), SecretsError);
  assert.throws(() => a.decrypt(t, 'other@example.org\nqrz'), SecretsError);
  assert.equal(a.decrypt(t, 'user@example.org\nqrz'), 'secret');
});

test('key parsing', () => {
  const k = randomBytes(32);
  assert.deepEqual(secretsKeyFromEnv({ BRICOHAMS_SECRETS_KEY: k.toString('base64') }), k);
  assert.deepEqual(secretsKeyFromEnv({ BRICOHAMS_SECRETS_KEY: k.toString('hex') }), k);
  assert.equal(secretsKeyFromEnv({}), null);
  assert.throws(() => secretsKeyFromEnv({ BRICOHAMS_SECRETS_KEY: 'c2hvcnQ=' }), SecretsError);
  assert.throws(() => createSecretBox(Buffer.alloc(16)), SecretsError);
});

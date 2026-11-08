import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Thrown for any key or ciphertext problem. Messages never contain plaintext or key material. */
export class SecretsError extends Error {
  /** @param {string} code Stable machine-readable code. */
  constructor(code) {
    super(code);
    this.name = 'SecretsError';
    this.code = code;
  }
}

/**
 * Parse BRICOHAMS_SECRETS_KEY (32 bytes, base64 or 64 hex chars) from an environment object.
 * @param {Record<string, string | undefined>} [env]
 * @returns {Buffer|null} The key, or null when the variable is unset.
 * @throws {SecretsError} `bad_key` when it is set but malformed.
 */
export function secretsKeyFromEnv(env = process.env) {
  const v = env.BRICOHAMS_SECRETS_KEY;
  if (v === undefined || v === '') return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
  if (buf.length !== 32) throw new SecretsError('bad_key');
  return buf;
}

/**
 * Create an AES-256-GCM secret box.
 * Token format: `v1.<iv>.<tag>.<ciphertext>` (base64url). A fresh random 12-byte IV is used per call.
 * @param {Buffer} key 32-byte key.
 * @returns {{encrypt: (plaintext: string, aad?: string) => string, decrypt: (token: string, aad?: string) => string}}
 * @throws {SecretsError} `bad_key` when the key is not 32 bytes.
 */
export function createSecretBox(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new SecretsError('bad_key');
  return {
    /**
     * Encrypt a string.
     * @param {string} plaintext
     * @param {string} [aad] Associated data bound to the ciphertext (e.g. owner and secret name); must match on decrypt.
     * @returns {string} Opaque token safe to store.
     */
    encrypt(plaintext, aad = '') {
      if (typeof plaintext !== 'string') throw new SecretsError('bad_input');
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
    },
    /**
     * Decrypt a token produced by `encrypt`.
     * @param {string} token
     * @param {string} [aad]
     * @returns {string} Plaintext.
     * @throws {SecretsError} `decrypt_failed` for a wrong key, wrong aad, tampering or a malformed token (deliberately indistinct).
     */
    decrypt(token, aad = '') {
      try {
        const parts = String(token).split('.');
        if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('format');
        const iv = Buffer.from(parts[1], 'base64url');
        const tag = Buffer.from(parts[2], 'base64url');
        if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('format');
        const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
        decipher.setAAD(Buffer.from(aad, 'utf8'));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
      } catch {
        throw new SecretsError('decrypt_failed');
      }
    },
  };
}

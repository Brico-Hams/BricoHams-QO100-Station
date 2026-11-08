import { readFileSync } from 'node:fs';

/** Thrown for any invalid or unreadable configuration. The message never contains secret values. */
export class ConfigError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`Invalid configuration:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

export const ROLES = Object.freeze(['listener', 'operator', 'owner']);

const CALLSIGN_RE = /^[A-Z0-9]{1,3}\d[A-Z0-9]{0,4}[A-Z](?:\/[A-Z0-9]{1,4})?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Whether a hostname or address designates the local machine.
 * @param {string} host Hostname as found in a URL or listen address.
 * @returns {boolean}
 */
export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(?:\.\d{1,3}){3}$/.test(h) || h === '::ffff:127.0.0.1';
}

function isInt(v, min, max) {
  return Number.isInteger(v) && v >= min && v <= max;
}

function parseBool(v, name, problems) {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  problems.push(`${name} must be true or false`);
  return false;
}

function parseHttpUrl(value, name, problems) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
    if (u.username || u.password) {
      problems.push(`${name} must not contain credentials`);
      return null;
    }
    return u;
  } catch {
    problems.push(`${name} must be a valid http(s) URL`);
    return null;
  }
}

function parseSecretsKey(value, problems) {
  if (value === undefined || value === '') return null;
  let buf = null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) buf = Buffer.from(value, 'hex');
  else if (/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) buf = Buffer.from(value, 'base64');
  if (!buf || buf.length !== 32) {
    problems.push('BRICOHAMS_SECRETS_KEY must be 32 bytes encoded as 64 hex chars or base64');
    return null;
  }
  return buf;
}

/**
 * Validate a raw configuration object and apply environment overrides.
 * Secrets (Google client secret, secrets key) are accepted only from the environment.
 * @param {unknown} raw Parsed JSON config.
 * @param {Record<string, string | undefined>} [env] Environment variables.
 * @returns {Readonly<object>} Normalized, frozen configuration.
 * @throws {ConfigError} Listing every problem found.
 */
export function validateConfig(raw, env = process.env) {
  const problems = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError(['config root must be a JSON object']);
  }

  const portRaw = env.BRICOHAMS_PORT !== undefined ? Number(env.BRICOHAMS_PORT) : (raw.port ?? 8443);
  if (!isInt(portRaw, 0, 65535)) problems.push('port must be an integer between 0 and 65535');

  const host = env.BRICOHAMS_HOST ?? raw.host ?? '127.0.0.1';
  if (typeof host !== 'string' || host === '') problems.push('host must be a non-empty string');

  const certPath = env.BRICOHAMS_TLS_CERT ?? raw.tls?.certPath;
  const keyPath = env.BRICOHAMS_TLS_KEY ?? raw.tls?.keyPath;
  let tls = null;
  if (certPath || keyPath) {
    if (typeof certPath !== 'string' || typeof keyPath !== 'string' || !certPath || !keyPath) {
      problems.push('tls.certPath and tls.keyPath must both be set');
    } else {
      tls = { certPath, keyPath };
    }
  }

  const publicRaw = env.BRICOHAMS_PUBLIC_URL ?? raw.publicUrl
    ?? `${tls ? 'https' : 'http'}://localhost:${portRaw}`;
  const publicUrlObj = parseHttpUrl(publicRaw, 'publicUrl', problems);
  let publicUrl = null;
  if (publicUrlObj) {
    if (publicUrlObj.pathname !== '/' || publicUrlObj.search || publicUrlObj.hash) {
      problems.push('publicUrl must not contain a path, query or fragment');
    }
    if (tls && publicUrlObj.protocol !== 'https:') problems.push('publicUrl must be https when TLS is configured');
    if (publicUrlObj.protocol === 'http:' && !isLoopbackHost(publicUrlObj.hostname)) {
      problems.push('plain HTTP publicUrl is only allowed for localhost');
    }
    publicUrl = publicUrlObj.origin;
  }
  if (!tls && typeof host === 'string' && !isLoopbackHost(host)) {
    problems.push('without TLS the server may only listen on a loopback address');
  }

  const clientId = env.GOOGLE_CLIENT_ID ?? raw.google?.clientId;
  if (raw.google?.clientSecret !== undefined) {
    problems.push('google.clientSecret must not be stored in the config file; use GOOGLE_CLIENT_SECRET');
  }
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (typeof clientId !== 'string' || !clientId) problems.push('google.clientId is required');
  if (typeof clientSecret !== 'string' || !clientSecret) problems.push('GOOGLE_CLIENT_SECRET environment variable is required');
  const issuer = raw.google?.issuer ?? 'https://accounts.google.com';
  parseHttpUrl(issuer, 'google.issuer', problems);

  const allowlist = [];
  if (!Array.isArray(raw.allowlist) || raw.allowlist.length === 0) {
    problems.push('allowlist must be a non-empty array');
  } else {
    const seen = new Set();
    raw.allowlist.forEach((entry, i) => {
      const where = `allowlist[${i}]`;
      const email = typeof entry?.email === 'string' ? entry.email.trim().toLowerCase() : '';
      const callsign = typeof entry?.callsign === 'string' ? entry.callsign.trim().toUpperCase() : '';
      if (!EMAIL_RE.test(email)) problems.push(`${where}.email is invalid`);
      if (!CALLSIGN_RE.test(callsign)) problems.push(`${where}.callsign is invalid`);
      if (!ROLES.includes(entry?.role)) problems.push(`${where}.role must be one of ${ROLES.join(', ')}`);
      if (seen.has(email)) problems.push(`${where}.email is duplicated`);
      seen.add(email);
      allowlist.push({ email, callsign, role: entry?.role });
    });
    if (!allowlist.some((e) => e.role === 'owner')) problems.push('allowlist needs at least one owner');
  }

  const txRaw = raw.tx ?? {};
  const tx = {
    enabled: env.BRICOHAMS_TX_ENABLED !== undefined
      ? parseBool(env.BRICOHAMS_TX_ENABLED, 'BRICOHAMS_TX_ENABLED', problems)
      : parseBool(txRaw.enabled ?? false, 'tx.enabled', problems),
    totSeconds: txRaw.totSeconds ?? 600,
    heartbeatTimeoutMs: txRaw.heartbeatTimeoutMs ?? 2000,
    armedTimeoutSeconds: txRaw.armedTimeoutSeconds ?? 120,
  };
  if (!isInt(tx.totSeconds, 1, 3600)) problems.push('tx.totSeconds must be an integer between 1 and 3600');
  // The design requires the carrier to drop in under 2 s, hence the upper bound.
  if (!isInt(tx.heartbeatTimeoutMs, 200, 2000)) problems.push('tx.heartbeatTimeoutMs must be an integer between 200 and 2000');
  if (!isInt(tx.armedTimeoutSeconds, 1, 3600)) problems.push('tx.armedTimeoutSeconds must be an integer between 1 and 3600');

  const sdrBase = env.BRICOHAMS_SDRANGEL_URL ?? raw.sdrangel?.baseUrl ?? 'http://127.0.0.1:8091';
  const sdrUrl = parseHttpUrl(sdrBase, 'sdrangel.baseUrl', problems);

  const secretsKey = parseSecretsKey(env.BRICOHAMS_SECRETS_KEY, problems);

  const auditLogPath = raw.auditLogPath ?? './data/audit.log';
  if (typeof auditLogPath !== 'string' || !auditLogPath) problems.push('auditLogPath must be a non-empty string');

  if (problems.length) throw new ConfigError(problems);

  const config = {
    port: portRaw,
    host,
    tls,
    publicUrl,
    google: { clientId, clientSecret, issuer },
    allowlist,
    tx,
    sdrangel: { baseUrl: sdrUrl.origin + sdrUrl.pathname.replace(/\/$/, '') },
    secretsKey,
    auditLogPath,
  };
  config.allowlist.forEach(Object.freeze);
  return Object.freeze({
    ...config,
    google: Object.freeze(config.google),
    tx: Object.freeze(config.tx),
    sdrangel: Object.freeze(config.sdrangel),
    allowlist: Object.freeze(config.allowlist),
  });
}

/**
 * Load the configuration file and validate it.
 * @param {{env?: Record<string, string | undefined>, readFile?: (path: string, enc: string) => string}} [opts]
 * @returns {Readonly<object>}
 * @throws {ConfigError}
 */
export function loadConfig({ env = process.env, readFile = readFileSync } = {}) {
  const path = env.BRICOHAMS_CONFIG ?? './config.json';
  let text;
  try {
    text = readFile(path, 'utf8');
  } catch (err) {
    throw new ConfigError([`cannot read config file ${path}: ${err.code ?? 'error'}`]);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ConfigError([`config file ${path} is not valid JSON`]);
  }
  return validateConfig(raw, env);
}

/**
 * Copy of the configuration that is safe to log.
 * @param {object} config Validated config.
 * @returns {object}
 */
export function redactConfig(config) {
  return {
    ...config,
    google: { ...config.google, clientSecret: '[redacted]' },
    secretsKey: config.secretsKey ? '[redacted]' : null,
  };
}

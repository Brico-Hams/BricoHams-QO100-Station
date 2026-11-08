/**
 * Parse a Cookie header.
 * @param {string|undefined} header
 * @returns {Record<string, string>} Null-prototype map of cookie name to value.
 */
export function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    if (!(name in out)) out[name] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * Build a Set-Cookie value. Values must be base64url-safe (we only store random ids).
 * @param {string} name
 * @param {string} value
 * @param {{maxAgeSec: number, sameSite: 'Strict'|'Lax', path?: string}} opts
 * @returns {string}
 */
export function serializeCookie(name, value, { maxAgeSec, sameSite, path = '/' }) {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('cookie value must be base64url');
  return `${name}=${value}; Max-Age=${maxAgeSec}; Path=${path}; HttpOnly; Secure; SameSite=${sameSite}`;
}

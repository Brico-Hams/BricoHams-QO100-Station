import { programVersion, qsoToAdifRecord, PROGRAM_ID } from './adif.js';

export const QRZ_URL = 'https://logbook.qrz.com/api';

/**
 * Parse a QRZ Logbook API response (`KEY=value&KEY=value`).
 * @param {string} text
 * @returns {{result: string, logId: string|null, reason: string|null}}
 */
export function parseQrzResponse(text) {
  const p = new URLSearchParams(String(text).trim());
  return { result: (p.get('RESULT') ?? '').toUpperCase(), logId: p.get('LOGID'), reason: p.get('REASON') };
}

/**
 * Create a QRZ Logbook client. The API key is passed per call and is never logged or returned.
 * @param {{fetch?: typeof fetch, url?: string, timeoutMs?: number}} [opts]
 * @returns {{insert: (apiKey: string, qso: object) => Promise<{status: string, ok: boolean, logId: string|null, reason: string|null}>}}
 */
export function createQrzClient({ fetch: fetchFn = globalThis.fetch, url = QRZ_URL, timeoutMs = 15_000 } = {}) {
  return {
    /**
     * Insert one QSO in the user's QRZ logbook.
     * @param {string} apiKey The user's QRZ Logbook API key.
     * @param {object} qso QSO as returned by the store.
     * @returns {Promise<{status: 'inserted'|'duplicate'|'auth_failed'|'error', ok: boolean, logId: string|null, reason: string|null}>}
     */
    async insert(apiKey, qso) {
      const body = new URLSearchParams({ KEY: apiKey, ACTION: 'INSERT', ADIF: qsoToAdifRecord(qso) });
      let res;
      try {
        res = await fetchFn(url, {
          method: 'POST',
          body,
          redirect: 'error',
          headers: { 'User-Agent': `${PROGRAM_ID}/${programVersion()}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { status: 'error', ok: false, logId: null, reason: 'network' };
      }
      if (res.status === 403) return { status: 'auth_failed', ok: false, logId: null, reason: 'invalid_key' };
      if (!res.ok) return { status: 'error', ok: false, logId: null, reason: `http_${res.status}` };
      const { result, logId, reason } = parseQrzResponse(await res.text());
      if (result === 'OK' || result === 'REPLACE') return { status: 'inserted', ok: true, logId, reason: null };
      if (result === 'AUTH') return { status: 'auth_failed', ok: false, logId: null, reason: reason ?? 'invalid_key' };
      if (/duplicate/i.test(reason ?? '')) return { status: 'duplicate', ok: false, logId: null, reason };
      return { status: 'error', ok: false, logId: null, reason: reason ?? 'unknown' };
    },
  };
}

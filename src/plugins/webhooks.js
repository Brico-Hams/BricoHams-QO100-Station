import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/** Events a webhook may subscribe to. All are read-only notifications; a webhook can never send anything back to the radio. */
export const WEBHOOK_EVENTS = Object.freeze(['decode', 'spot', 'qso_logged', 'ptt_state']);
export const SIGNATURE_HEADER = 'X-BricoHams-Signature';
export const TIMESTAMP_HEADER = 'X-BricoHams-Timestamp';

const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) {
    const v = obj?.[k];
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = typeof v === 'string' ? v.slice(0, 300) : v;
  }
  return out;
};

// Allow-lists: only these fields ever leave the station, so a session, token, e-mail or key cannot leak by accident.
const SANITIZERS = {
  decode: (d) => ({
    mode: String(d?.mode ?? '').slice(0, 8),
    slotStartMs: Number.isFinite(d?.slotStartMs) ? d.slotStartMs : null,
    messages: (Array.isArray(d?.messages) ? d.messages : []).slice(0, 50).map((m) => (typeof m === 'string'
      ? { text: m.slice(0, 200) }
      : pick(m, ['text', 'message', 'snr', 'dt', 'freq', 'freqHz', 'call']))),
  }),
  spot: (d) => pick(d, ['id', 'source', 'spotter', 'dx', 'downlinkHz', 'uplinkHz', 'comment', 'time']),
  qso_logged: (d) => pick(d, ['call', 'qso_date', 'time_on', 'band', 'band_rx', 'freq', 'freq_rx', 'mode', 'submode', 'sat_name', 'rst_sent', 'rst_rcvd', 'gridsquare']),
  ptt_state: (d) => ({
    state: String(d?.state ?? '').slice(0, 16),
    txEnabled: Boolean(d?.txEnabled),
    holder: d?.holder?.callsign ? { callsign: String(d.holder.callsign).slice(0, 16) } : null,
  }),
};

/**
 * Compute the signature of a webhook delivery: HMAC-SHA256 over `<timestamp>.<body>`, hex, prefixed `sha256=`.
 * @param {string} secret
 * @param {string|number} timestamp Unix seconds, also sent in the timestamp header.
 * @param {string} body Exact request body.
 * @returns {string}
 */
export function signPayload(secret, timestamp, body) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/**
 * Verify a delivery (for receivers and tests). Constant-time comparison and a replay window on the timestamp.
 * @param {{secret: string, timestamp: string|number, body: string, signature: string, toleranceSec?: number, nowSec?: number}} p
 * @returns {boolean}
 */
export function verifySignature({ secret, timestamp, body, signature, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000) }) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec || typeof signature !== 'string') return false;
  const a = Buffer.from(signPayload(secret, timestamp, body));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Outgoing event feed. Each endpoint is owner-configured (URL, subscribed events, secret). Deliveries are signed, time-limited,
 * do not follow redirects and are retried with exponential backoff; a slow receiver never blocks the radio code.
 * @param {{endpoints: Array<{url: string, events: string[], secret: string}>, fetch?: typeof fetch, timers?: {setTimeout: Function},
 *   now?: () => number, maxRetries?: number, baseMs?: number, timeoutMs?: number, maxPending?: number, logger?: {error: Function}}} opts
 * @returns {{emit(type: string, data: object): void, stats(): {sent: number, failed: number, dropped: number, pending: number}}}
 */
export function createWebhookDispatcher({
  endpoints, fetch: fetchImpl = globalThis.fetch, timers = { setTimeout }, now = Date.now,
  maxRetries = 4, baseMs = 2000, timeoutMs = 5000, maxPending = 100, logger = console,
}) {
  const stats = { sent: 0, failed: 0, dropped: 0 };
  const pending = new Map(endpoints.map((e) => [e, 0]));

  async function deliver(endpoint, body, attempt) {
    const timestamp = Math.floor(now() / 1000);
    let ok = false;
    try {
      const res = await fetchImpl(endpoint.url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'Content-Type': 'application/json',
          [TIMESTAMP_HEADER]: String(timestamp),
          [SIGNATURE_HEADER]: signPayload(endpoint.secret, timestamp, body),
        },
        body,
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (ok) {
      stats.sent += 1;
      pending.set(endpoint, pending.get(endpoint) - 1);
      return;
    }
    if (attempt >= maxRetries) {
      stats.failed += 1;
      pending.set(endpoint, pending.get(endpoint) - 1);
      // Only the host is logged: URLs may carry tokens in the path or query.
      logger.error('webhook delivery failed:', new URL(endpoint.url).host);
      return;
    }
    const t = timers.setTimeout(() => { deliver(endpoint, body, attempt + 1); }, baseMs * 2 ** attempt);
    t.unref?.();
  }

  return {
    /**
     * Queue an event for every endpoint subscribed to it.
     * @param {'decode'|'spot'|'qso_logged'|'ptt_state'} type
     * @param {object} data Raw event data; only allow-listed fields are sent.
     */
    emit(type, data) {
      const sanitize = SANITIZERS[type];
      if (!sanitize) return;
      const targets = endpoints.filter((e) => e.events.includes(type));
      if (targets.length === 0) return;
      const body = JSON.stringify({ id: randomUUID(), type, time: new Date(now()).toISOString(), data: sanitize(data) });
      for (const e of targets) {
        if (pending.get(e) >= maxPending) { stats.dropped += 1; continue; }
        pending.set(e, pending.get(e) + 1);
        deliver(e, body, 0);
      }
    },

    /** @returns {{sent: number, failed: number, dropped: number, pending: number}} */
    stats: () => ({ ...stats, pending: [...pending.values()].reduce((a, b) => a + b, 0) }),
  };
}

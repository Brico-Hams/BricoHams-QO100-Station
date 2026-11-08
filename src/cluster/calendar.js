import { parseIcs, upcoming } from './ics.js';

const MAX_UPLOAD_EVENTS = 500;

/**
 * QO-100 activity calendar. Events come from an owner-configured .ics URL (never fetched unless `enabled` and a URL is set)
 * and/or an .ics uploaded by the owner. Fetching has a timeout and a hard size limit and does not follow redirects.
 * @param {{enabled?: boolean, url?: string|null, fetch?: typeof fetch, timeoutMs?: number, maxBytes?: number, refreshMs?: number,
 *   now?: () => number, timers?: {setInterval: Function, clearInterval: Function}, logger?: {error: Function}}} [opts]
 * @returns {object} `{start, stop, refresh, load, list, status}`
 */
export function createCalendar({
  enabled = false, url = null, fetch: fetchImpl = globalThis.fetch, timeoutMs = 8000, maxBytes = 256 * 1024,
  refreshMs = 6 * 3_600_000, now = Date.now, timers = { setInterval, clearInterval }, logger = console,
} = {}) {
  let fetched = [];
  let uploaded = [];
  let updatedAt = null;
  let lastError = null;
  let timer = null;

  async function readLimited(res) {
    const declared = Number(res.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error('too_large');
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('too_large');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  const api = {
    /** Start periodic refresh (no-op unless enabled with a URL). */
    start() {
      if (!enabled || !url || timer) return;
      api.refresh().catch(() => {});
      timer = timers.setInterval(() => { api.refresh().catch(() => {}); }, refreshMs);
      timer.unref?.();
    },

    /** Stop periodic refresh. */
    stop() {
      if (timer) timers.clearInterval(timer);
      timer = null;
    },

    /**
     * Fetch the configured URL once.
     * @returns {Promise<{events: number}>}
     * @throws {Error} `calendar_disabled`, `no_url`, `too_large`, `http_<status>`, `fetch_failed`.
     */
    async refresh() {
      if (!enabled) throw new Error('calendar_disabled');
      if (!url) throw new Error('no_url');
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { Accept: 'text/calendar' } });
        if (!res.ok) throw new Error(`http_${res.status}`);
        fetched = parseIcs(await readLimited(res));
        updatedAt = now();
        lastError = null;
        return { events: fetched.length };
      } catch (err) {
        lastError = /^(too_large|http_\d+)$/.test(err.message) ? err.message : 'fetch_failed';
        logger.error('calendar refresh failed:', lastError);
        throw new Error(lastError);
      }
    },

    /**
     * Replace the uploaded events with the contents of an .ics file.
     * @param {string} text
     * @returns {{events: number}}
     * @throws {Error} `calendar_disabled`, `too_large`, `no_events`.
     */
    load(text) {
      if (!enabled) throw new Error('calendar_disabled');
      if (typeof text !== 'string' || text.length > maxBytes) throw new Error('too_large');
      const events = parseIcs(text).slice(0, MAX_UPLOAD_EVENTS);
      if (events.length === 0) throw new Error('no_events');
      uploaded = events;
      updatedAt = now();
      return { events: events.length };
    },

    /**
     * @param {{days?: number, limit?: number}} [opts]
     * @returns {object[]} Upcoming events from both sources.
     */
    list(opts) {
      const all = [...fetched, ...uploaded].sort((a, b) => a.start - b.start);
      return upcoming(all, now(), opts);
    },

    /** @returns {{enabled: boolean, hasUrl: boolean, updatedAt: number|null, error: string|null, events: number}} */
    status: () => ({ enabled, hasUrl: Boolean(url), updatedAt, error: lastError, events: fetched.length + uploaded.length }),
  };
  return api;
}

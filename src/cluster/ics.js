const MAX_EVENTS = 500;
const MAX_TEXT = 500;

/** Unfold RFC 5545 content lines (CRLF followed by a space or tab continues the previous line). */
function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

const unescapeText = (s) => s.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

function tzOffsetMs(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}

// Wall-clock time in an IANA zone to UTC; recomputed once so the offset of the target instant (DST) is used.
function zonedToUtc(wallMs, timeZone) {
  const first = wallMs - tzOffsetMs(wallMs, timeZone);
  return wallMs - tzOffsetMs(first, timeZone);
}

/**
 * Parse an iCalendar date or date-time value.
 * @param {string} value e.g. `20261108T190000Z`, `20261108T200000` (with TZID) or `20261108` (all-day).
 * @param {{tzid?: string, dateOnly?: boolean}} [params]
 * @returns {{ms: number, allDay: boolean, approx: boolean}|null} `approx` is set when a TZID could not be resolved and UTC was assumed.
 */
export function parseIcsDate(value, { tzid, dateOnly = false } = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (m[4] === undefined || dateOnly) return { ms: Date.UTC(y, mo - 1, d), allDay: true, approx: false };
  const wall = Date.UTC(y, mo - 1, d, Number(m[4]), Number(m[5]), Number(m[6]));
  if (m[7] === 'Z' || !tzid) return { ms: wall, allDay: false, approx: m[7] !== 'Z' };
  try {
    return { ms: zonedToUtc(wall, tzid), allDay: false, approx: false };
  } catch {
    return { ms: wall, allDay: false, approx: true };
  }
}

function parseDuration(value) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m || m[1] === '-') return null;
  const n = (x) => Number(x ?? 0);
  return ((n(m[2]) * 7 + n(m[3])) * 86400 + n(m[4]) * 3600 + n(m[5]) * 60 + n(m[6])) * 1000;
}

function safeUrl(value) {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href.slice(0, 300) : null;
  } catch {
    return null;
  }
}

/**
 * Minimal RFC 5545 VEVENT parser: DTSTART, DTEND (or DURATION), SUMMARY, DESCRIPTION, URL, UID with UTC, TZID and all-day dates.
 * Recurrence rules are not expanded (only the first occurrence is listed). Unknown properties and components are ignored.
 * @param {string} text Contents of an .ics file.
 * @returns {Array<{uid: string, start: number, end: number|null, allDay: boolean, approxTime: boolean, summary: string, description: string, url: string|null}>}
 *   Events sorted by start.
 */
export function parseIcs(text) {
  const events = [];
  let cur = null;
  let depth = 0;
  for (const line of unfold(String(text))) {
    if (line === '') continue;
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT') { cur = { props: {} }; depth = 0; continue; }
    if (!cur) continue;
    if (upper.startsWith('BEGIN:')) { depth += 1; continue; }
    if (upper === 'END:VEVENT') {
      const ev = finish(cur.props);
      if (ev) events.push(ev);
      cur = null;
      if (events.length >= MAX_EVENTS) break;
      continue;
    }
    if (upper.startsWith('END:')) { depth = Math.max(0, depth - 1); continue; }
    if (depth > 0) continue; // e.g. VALARM
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const [name, ...rawParams] = line.slice(0, colon).split(';');
    const params = {};
    for (const p of rawParams) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
    }
    const key = name.toUpperCase();
    if (!(key in cur.props)) cur.props[key] = { value: line.slice(colon + 1), params };
  }
  return events.sort((a, b) => a.start - b.start);
}

function finish(props) {
  const s = props.DTSTART;
  if (!s) return null;
  const start = parseIcsDate(s.value, { tzid: s.params.TZID, dateOnly: s.params.VALUE === 'DATE' });
  if (!start) return null;
  let end = null;
  if (props.DTEND) {
    const e = parseIcsDate(props.DTEND.value, { tzid: props.DTEND.params.TZID, dateOnly: props.DTEND.params.VALUE === 'DATE' });
    if (e && e.ms >= start.ms) end = e.ms;
  } else if (props.DURATION) {
    const d = parseDuration(props.DURATION.value);
    if (d !== null) end = start.ms + d;
  }
  const text = (k) => unescapeText(props[k]?.value ?? '').replace(/\p{Cc}/gu, (c) => (c === '\n' ? c : ' ')).slice(0, MAX_TEXT);
  return {
    uid: (props.UID?.value ?? '').slice(0, 200),
    start: start.ms,
    end,
    allDay: start.allDay,
    approxTime: start.approx,
    summary: text('SUMMARY').replace(/\n/g, ' ').trim(),
    description: text('DESCRIPTION').trim(),
    url: props.URL ? safeUrl(props.URL.value) : null,
  };
}

/**
 * Events still running or starting within the window.
 * @param {ReturnType<typeof parseIcs>} events
 * @param {number} nowMs
 * @param {{days?: number, limit?: number}} [opts]
 * @returns {ReturnType<typeof parseIcs>}
 */
export function upcoming(events, nowMs, { days = 60, limit = 50 } = {}) {
  const horizon = nowMs + days * 86_400_000;
  return events
    .filter((e) => (e.end ?? e.start + 3_600_000) >= nowMs && e.start <= horizon)
    .slice(0, limit);
}

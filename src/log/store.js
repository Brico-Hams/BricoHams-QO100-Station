import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Domain error of the logbook. `status` is the suggested HTTP status. */
export class LogError extends Error {
  /**
   * @param {string} code Stable machine-readable code.
   * @param {{status?: number, fields?: Record<string, string>, existingId?: number}} [extra]
   */
  constructor(code, { status = 400, fields, existingId } = {}) {
    super(code);
    this.name = 'LogError';
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.existingId = existingId;
  }
}

export const MODES = Object.freeze(['SSB', 'CW', 'FT8', 'FT4']);
export const DUPLICATE_WINDOW_SEC = 600;
export const EDITABLE_FIELDS = Object.freeze([
  'call', 'qso_date', 'time_on', 'mode', 'freq', 'freq_rx', 'rst_sent', 'rst_rcvd', 'gridsquare', 'my_gridsquare', 'comment',
]);

// Same shape as the allowlist check, plus an optional "EA/" style prefix.
const CALL_RE = /^(?:[A-Z0-9]{1,4}\/)?[A-Z0-9]{1,3}\d[A-Z0-9]{0,4}[A-Z](?:\/[A-Z0-9]{1,4})?$/;
const GRID_RE = /^[A-R]{2}(?:\d{2}(?:[A-X]{2}(?:\d{2})?)?)?$/;
// QO-100 narrowband transponder: uplink 2400.000-2400.500 MHz, downlink 10489.500-10490.000 MHz.
const UPLINK_MHZ = [2400.0, 2400.5];
const DOWNLINK_MHZ = [10489.5, 10490.0];
const UPLOAD_STATUS = {
  lotw_status: ['none', 'uploaded', 'duplicate', 'failed'],
  qrz_status: ['none', 'sent', 'duplicate', 'failed'],
};

const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * Convert ADIF date/time to epoch seconds, rejecting impossible values.
 * @param {string} date YYYYMMDD
 * @param {string} time HHMMSS
 * @returns {number|null}
 */
export function qsoEpoch(date, time) {
  const y = Number(date.slice(0, 4)); const mo = Number(date.slice(4, 6)); const d = Number(date.slice(6, 8));
  const h = Number(time.slice(0, 2)); const mi = Number(time.slice(2, 4)); const s = Number(time.slice(4, 6));
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d
    || dt.getUTCHours() !== h || dt.getUTCMinutes() !== mi || dt.getUTCSeconds() !== s) return null;
  return Math.floor(dt.getTime() / 1000);
}

function cleanText(v, max) {
  // Control characters (including newlines) would corrupt the ADIF export.
  const s = String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return s.length > max ? null : s;
}

function freqValue(v, range) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < range[0] || n > range[1]) return null;
  return Math.round(n * 1e6) / 1e6;
}

function normalizeRst(mode, v) {
  if (v === undefined || v === null || v === '') return mode === 'SSB' ? '59' : mode === 'CW' ? '599' : null;
  const s = String(v).trim();
  if (mode === 'SSB') return /^[1-5][1-9]$/.test(s) ? s : null;
  if (mode === 'CW') return /^[1-5][1-9][1-9]$/.test(s) ? s : null;
  if (!/^[+-]?\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  if (n < -50 || n > 50) return null;
  return `${n < 0 ? '-' : '+'}${pad(Math.abs(n))}`;
}

/**
 * Validate and normalize the user-editable fields of a QSO.
 * Unknown keys are ignored (no mass assignment). Date/time default to now (UTC).
 * @param {Record<string, unknown>} input
 * @param {{now?: Date}} [opts]
 * @returns {{value: object|null, errors: Record<string, string>}} `value` is null when `errors` is not empty.
 */
export function validateQso(input, { now = new Date() } = {}) {
  const errors = {};
  const src = input !== null && typeof input === 'object' ? input : {};
  const out = {};
  const isScalar = (k) => src[k] === undefined || src[k] === null || typeof src[k] === 'string' || typeof src[k] === 'number';

  const call = typeof src.call === 'string' ? src.call.trim().toUpperCase() : '';
  if (!CALL_RE.test(call)) errors.call = 'invalid';
  out.call = call;

  const iso = now.toISOString();
  const rawDate = src.qso_date === undefined || src.qso_date === null || src.qso_date === '' ? iso.slice(0, 10).replaceAll('-', '') : String(src.qso_date).trim();
  let rawTime = src.time_on === undefined || src.time_on === null || src.time_on === '' ? iso.slice(11, 19).replaceAll(':', '') : String(src.time_on).trim();
  if (/^\d{4}$/.test(rawTime)) rawTime += '00';
  if (!/^\d{8}$/.test(rawDate)) errors.qso_date = 'invalid';
  if (!/^\d{6}$/.test(rawTime)) errors.time_on = 'invalid';
  if (!errors.qso_date && !errors.time_on) {
    const ts = qsoEpoch(rawDate, rawTime);
    if (ts === null) errors.time_on = 'invalid';
    else if (ts > now.getTime() / 1000 + 300) errors.time_on = 'in_future';
  }
  out.qso_date = rawDate;
  out.time_on = rawTime;

  const mode = typeof src.mode === 'string' ? src.mode.trim().toUpperCase() : '';
  if (!MODES.includes(mode)) errors.mode = 'invalid';
  out.mode = mode;
  out.submode = mode === 'SSB' ? 'USB' : null;

  const freq = freqValue(src.freq, UPLINK_MHZ);
  if (freq === null) errors.freq = 'out_of_range';
  out.freq = freq;
  const freqRx = freqValue(src.freq_rx, DOWNLINK_MHZ);
  if (freqRx === null) errors.freq_rx = 'out_of_range';
  out.freq_rx = freqRx;

  if (MODES.includes(mode)) {
    for (const k of ['rst_sent', 'rst_rcvd']) {
      const v = normalizeRst(mode, src[k]);
      if (v === null) errors[k] = src[k] === undefined || src[k] === null || src[k] === '' ? 'required' : 'invalid';
      out[k] = v;
    }
  }

  for (const k of ['gridsquare', 'my_gridsquare']) {
    if (src[k] === undefined || src[k] === null || src[k] === '') {
      out[k] = null;
    } else {
      const g = String(src[k]).trim().toUpperCase();
      if (!GRID_RE.test(g)) errors[k] = 'invalid';
      out[k] = g;
    }
  }
  if (src.comment === undefined || src.comment === null || src.comment === '') {
    out.comment = null;
  } else {
    const c = cleanText(src.comment, 200);
    if (c === null) errors.comment = 'too_long';
    out.comment = c;
  }

  // Applied last so a wrong type is reported as such rather than as a downstream format error.
  for (const k of EDITABLE_FIELDS) if (!isScalar(k)) errors[k] = 'invalid_type';

  return Object.keys(errors).length ? { value: null, errors } : { value: out, errors };
}

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE qsos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        call TEXT NOT NULL,
        qso_date TEXT NOT NULL,
        time_on TEXT NOT NULL,
        ts INTEGER NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('SSB','CW','FT8','FT4')),
        submode TEXT,
        freq REAL NOT NULL,
        freq_rx REAL NOT NULL,
        band TEXT NOT NULL DEFAULT '13CM',
        band_rx TEXT NOT NULL DEFAULT '3CM',
        prop_mode TEXT NOT NULL DEFAULT 'SAT',
        sat_name TEXT NOT NULL DEFAULT 'QO-100',
        rst_sent TEXT NOT NULL,
        rst_rcvd TEXT NOT NULL,
        gridsquare TEXT,
        my_gridsquare TEXT,
        station_callsign TEXT NOT NULL,
        operator TEXT NOT NULL,
        comment TEXT,
        lotw_status TEXT NOT NULL DEFAULT 'none',
        qrz_status TEXT NOT NULL DEFAULT 'none',
        qrz_logid TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX qsos_dupe ON qsos (call, mode, ts);
      CREATE INDEX qsos_ts ON qsos (ts);
      CREATE TABLE user_secrets (
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (owner, name)
      );`,
  },
];

const COLUMNS = [
  'call', 'qso_date', 'time_on', 'ts', 'mode', 'submode', 'freq', 'freq_rx', 'band', 'band_rx', 'prop_mode', 'sat_name',
  'rst_sent', 'rst_rcvd', 'gridsquare', 'my_gridsquare', 'station_callsign', 'operator', 'comment', 'created_by', 'created_at',
];

const plain = (row) => (row ? { ...row } : null);

/**
 * Open (creating and migrating if needed) the logbook database.
 * All SQL uses bound parameters; no value is ever interpolated into a statement.
 * @param {{path: string, secretBox?: {encrypt: Function, decrypt: Function}|null, clock?: () => Date}} opts
 *   `path` may be ':memory:'. `secretBox` is required only for the per-user secret methods.
 * @returns {object} Store with add/get/list/update/remove/setUploadStatus/findDuplicate and secret helpers.
 */
export function createLogStore({ path, secretBox = null, clock = () => new Date() }) {
  if (typeof path !== 'string' || path === '') throw new TypeError('logbook path required');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');

  db.exec('CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM migrations').all().map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO migrations (version, applied_at) VALUES (?, ?)').run(m.version, clock().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const stmts = {
    insert: db.prepare(`INSERT INTO qsos (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`),
    get: db.prepare('SELECT * FROM qsos WHERE id = ?'),
    del: db.prepare('DELETE FROM qsos WHERE id = ?'),
    dupe: db.prepare('SELECT id FROM qsos WHERE call = ? AND mode = ? AND ABS(ts - ?) <= ? AND id <> ? LIMIT 1'),
    update: db.prepare(`UPDATE qsos SET call = ?, qso_date = ?, time_on = ?, ts = ?, mode = ?, submode = ?, freq = ?, freq_rx = ?,
      rst_sent = ?, rst_rcvd = ?, gridsquare = ?, my_gridsquare = ?, comment = ? WHERE id = ?`),
    setSecret: db.prepare(`INSERT INTO user_secrets (owner, name, ciphertext, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (owner, name) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`),
    getSecret: db.prepare('SELECT ciphertext FROM user_secrets WHERE owner = ? AND name = ?'),
    delSecret: db.prepare('DELETE FROM user_secrets WHERE owner = ? AND name = ?'),
  };

  const requireBox = () => {
    if (!secretBox) throw new LogError('secrets_unavailable', { status: 503 });
    return secretBox;
  };

  function findDuplicate({ call, mode, date, time, excludeId = 0 }) {
    const ts = qsoEpoch(date, time);
    if (ts === null) return null;
    return stmts.dupe.get(call, mode, ts, DUPLICATE_WINDOW_SEC, excludeId)?.id ?? null;
  }

  const store = {
    /** @returns {number} Highest applied migration version. */
    schemaVersion() {
      return db.prepare('SELECT MAX(version) AS v FROM migrations').get().v;
    },
    findDuplicate,
    /**
     * Validate and insert a QSO.
     * @param {Record<string, unknown>} input User-supplied fields.
     * @param {{email: string, callsign: string}} user Session user; becomes station_callsign, operator and created_by.
     * @param {{force?: boolean}} [opts] `force` stores even if a duplicate exists.
     * @returns {object} The stored QSO.
     * @throws {LogError} `validation` (400) or `duplicate` (409, with `existingId`).
     */
    add(input, user, { force = false } = {}) {
      const { value, errors } = validateQso(input, { now: clock() });
      if (!value) throw new LogError('validation', { fields: errors });
      if (!CALL_RE.test(user.callsign)) throw new LogError('validation', { fields: { station_callsign: 'invalid' } });
      const dupId = findDuplicate({ call: value.call, mode: value.mode, date: value.qso_date, time: value.time_on });
      if (dupId !== null && !force) throw new LogError('duplicate', { status: 409, existingId: dupId });
      const row = {
        ...value,
        ts: qsoEpoch(value.qso_date, value.time_on),
        band: '13CM',
        band_rx: '3CM',
        prop_mode: 'SAT',
        sat_name: 'QO-100',
        station_callsign: user.callsign,
        operator: user.callsign,
        created_by: user.email,
        created_at: clock().toISOString(),
      };
      const r = stmts.insert.run(...COLUMNS.map((c) => row[c] ?? null));
      return store.get(Number(r.lastInsertRowid));
    },
    /**
     * @param {number} id
     * @returns {object|null}
     */
    get(id) {
      return plain(stmts.get.get(id));
    },
    /**
     * List QSOs, newest first.
     * @param {{limit?: number, offset?: number, call?: string}} [q]
     * @returns {{items: object[], total: number}}
     */
    list({ limit = 100, offset = 0, call } = {}) {
      const lim = Math.min(Math.max(Number.isInteger(limit) ? limit : 100, 1), 1000);
      const off = Math.max(Number.isInteger(offset) ? offset : 0, 0);
      const where = call ? 'WHERE call LIKE ?' : '';
      // Escape LIKE wildcards so a search for "EA4%" cannot match everything.
      const args = call ? [`${String(call).toUpperCase().replace(/[\\%_]/g, '\\$&')}%`] : [];
      const esc = call ? " ESCAPE '\\'" : '';
      const items = db.prepare(`SELECT * FROM qsos ${where}${esc} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`).all(...args, lim, off).map(plain);
      const total = db.prepare(`SELECT COUNT(*) AS n FROM qsos ${where}${esc}`).get(...args).n;
      return { items, total };
    },
    /**
     * All QSOs matching ids (or every QSO when ids is omitted), oldest first, for export/upload.
     * @param {number[]} [ids]
     * @returns {object[]}
     */
    listForExport(ids) {
      if (ids === undefined) return db.prepare('SELECT * FROM qsos ORDER BY ts ASC, id ASC').all().map(plain);
      return ids.map((id) => store.get(id)).filter(Boolean).sort((a, b) => a.ts - b.ts || a.id - b.id);
    },
    /**
     * Edit a QSO. Only EDITABLE_FIELDS can change; the merged record is re-validated.
     * @param {number} id
     * @param {Record<string, unknown>} patch
     * @returns {object} Updated QSO.
     * @throws {LogError} `not_found` (404), `validation` (400), `duplicate` (409).
     */
    update(id, patch) {
      const current = store.get(id);
      if (!current) throw new LogError('not_found', { status: 404 });
      const merged = {};
      for (const k of EDITABLE_FIELDS) merged[k] = Object.hasOwn(patch, k) ? patch[k] : current[k];
      const { value, errors } = validateQso(merged, { now: clock() });
      if (!value) throw new LogError('validation', { fields: errors });
      const dupId = findDuplicate({ call: value.call, mode: value.mode, date: value.qso_date, time: value.time_on, excludeId: id });
      if (dupId !== null && patch.force !== true) throw new LogError('duplicate', { status: 409, existingId: dupId });
      stmts.update.run(value.call, value.qso_date, value.time_on, qsoEpoch(value.qso_date, value.time_on), value.mode, value.submode,
        value.freq, value.freq_rx, value.rst_sent, value.rst_rcvd, value.gridsquare, value.my_gridsquare, value.comment, id);
      return store.get(id);
    },
    /**
     * @param {number} id
     * @returns {boolean} Whether a row was deleted.
     */
    remove(id) {
      return Number(stmts.del.run(id).changes) > 0;
    },
    /**
     * Record the outcome of an upload.
     * @param {number} id
     * @param {{lotw_status?: string, qrz_status?: string, qrz_logid?: string|null}} s
     * @returns {void}
     * @throws {LogError} `validation` for an unknown status value.
     */
    setUploadStatus(id, s) {
      for (const [k, allowed] of Object.entries(UPLOAD_STATUS)) {
        if (s[k] !== undefined) {
          if (!allowed.includes(s[k])) throw new LogError('validation', { fields: { [k]: 'invalid' } });
          db.prepare(`UPDATE qsos SET ${k} = ? WHERE id = ?`).run(s[k], id); // column name comes from the fixed whitelist above
        }
      }
      if (s.qrz_logid !== undefined) db.prepare('UPDATE qsos SET qrz_logid = ? WHERE id = ?').run(s.qrz_logid === null ? null : String(s.qrz_logid), id);
    },
    /**
     * Store a per-user secret encrypted at rest (bound to owner and name as AAD).
     * @param {string} owner User email.
     * @param {string} name Secret name, e.g. "qrz_api_key".
     * @param {string} plaintext
     * @returns {void}
     */
    setSecret(owner, name, plaintext) {
      stmts.setSecret.run(owner, name, requireBox().encrypt(plaintext, `${owner}\n${name}`), clock().toISOString());
    },
    /**
     * @param {string} owner
     * @param {string} name
     * @returns {string|null} Plaintext. For server-side use only; never expose through the API.
     */
    getSecret(owner, name) {
      const row = stmts.getSecret.get(owner, name);
      return row ? requireBox().decrypt(row.ciphertext, `${owner}\n${name}`) : null;
    },
    /**
     * @param {string} owner
     * @param {string} name
     * @returns {boolean} Whether a secret exists (does not decrypt).
     */
    hasSecret(owner, name) {
      return stmts.getSecret.get(owner, name) !== undefined;
    },
    /**
     * @param {string} owner
     * @param {string} name
     * @returns {boolean}
     */
    deleteSecret(owner, name) {
      return Number(stmts.delSecret.run(owner, name).changes) > 0;
    },
    /** Close the database. */
    close() {
      db.close();
    },
  };
  return store;
}

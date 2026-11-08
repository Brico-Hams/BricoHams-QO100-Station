import { readFileSync } from 'node:fs';

export const ADIF_VERSION = '3.1.4';
export const PROGRAM_ID = 'BricoHams-QO100-Station';

let cachedVersion = null;

/**
 * Version of this program, read once from package.json.
 * @returns {string}
 */
export function programVersion() {
  if (cachedVersion === null) {
    cachedVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  }
  return cachedVersion;
}

/**
 * Encode one ADIF field. The length is in UTF-8 bytes, which is what ADIF parsers count.
 * @param {string} name
 * @param {string|number|null|undefined} value
 * @returns {string} Empty string when value is null/undefined/empty.
 */
export function field(name, value) {
  if (value === null || value === undefined || value === '') return '';
  const s = String(value);
  return `<${name}:${Buffer.byteLength(s, 'utf8')}>${s}`;
}

const fmtMhz = (v) => String(Number(Number(v).toFixed(6)));

/**
 * Map the internal mode/submode to ADIF MODE/SUBMODE. FT4 is MFSK/FT4 per the ADIF specification.
 * @param {string} mode SSB|CW|FT8|FT4
 * @param {string|null} [submode]
 * @returns {{mode: string, submode: string|null}}
 */
export function toAdifMode(mode, submode) {
  if (mode === 'FT4') return { mode: 'MFSK', submode: 'FT4' };
  if (mode === 'SSB') return { mode: 'SSB', submode: submode ?? 'USB' };
  return { mode, submode: null };
}

/**
 * Encode one QSO as an ADIF record (terminated by <EOR>), with the QO-100 satellite fields.
 * @param {object} q QSO as returned by the store.
 * @returns {string}
 */
export function qsoToAdifRecord(q) {
  const m = toAdifMode(q.mode, q.submode);
  return [
    field('CALL', q.call),
    field('QSO_DATE', q.qso_date),
    field('TIME_ON', q.time_on),
    field('BAND', q.band ?? '13CM'),
    field('BAND_RX', q.band_rx ?? '3CM'),
    field('FREQ', fmtMhz(q.freq)),
    field('FREQ_RX', fmtMhz(q.freq_rx)),
    field('MODE', m.mode),
    field('SUBMODE', m.submode),
    field('PROP_MODE', q.prop_mode ?? 'SAT'),
    field('SAT_NAME', q.sat_name ?? 'QO-100'),
    field('RST_SENT', q.rst_sent),
    field('RST_RCVD', q.rst_rcvd),
    field('GRIDSQUARE', q.gridsquare),
    field('MY_GRIDSQUARE', q.my_gridsquare),
    field('STATION_CALLSIGN', q.station_callsign),
    field('OPERATOR', q.operator),
    field('COMMENT', q.comment),
  ].join('') + '<EOR>\n';
}

/**
 * Build a complete ADIF 3.1.x file.
 * @param {object[]} qsos
 * @param {{now?: Date}} [opts]
 * @returns {string}
 */
export function toAdif(qsos, { now = new Date() } = {}) {
  const iso = now.toISOString();
  const created = `${iso.slice(0, 10).replaceAll('-', '')} ${iso.slice(11, 19).replaceAll(':', '')}`;
  const header = `BricoHams QO-100 Station ADIF export\n${field('ADIF_VER', ADIF_VERSION)}${field('PROGRAMID', PROGRAM_ID)}`
    + `${field('PROGRAMVERSION', programVersion())}${field('CREATED_TIMESTAMP', created)}<EOH>\n`;
  return header + qsos.map(qsoToAdifRecord).join('');
}

/**
 * Parse an ADIF (.adi) document. Lengths are honoured in bytes, so values may contain '<' or newlines.
 * @param {string|Buffer} input
 * @returns {{header: Record<string, string>, records: Array<Record<string, string>>}} Field names are upper-cased.
 * @throws {Error} On a truncated field.
 */
export function parseAdif(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  const header = {};
  const records = [];
  let current = {};
  let inHeader = buf.length > 0 && buf[0] !== 0x3c; // header exists only if the file does not start with '<'
  let pos = 0;
  if (inHeader) {
    // Free text precedes the first tag; skip it.
    pos = buf.indexOf(0x3c);
    if (pos < 0) return { header, records };
  }
  while (pos < buf.length) {
    const open = buf.indexOf(0x3c, pos);
    if (open < 0) break;
    const close = buf.indexOf(0x3e, open);
    if (close < 0) throw new Error('unterminated ADIF tag');
    const parts = buf.toString('utf8', open + 1, close).split(':');
    const name = parts[0].trim().toUpperCase();
    pos = close + 1;
    if (name === 'EOH') {
      inHeader = false;
      continue;
    }
    if (name === 'EOR') {
      records.push(current);
      current = {};
      continue;
    }
    const len = Number(parts[1]);
    if (!Number.isInteger(len) || len < 0) throw new Error(`bad ADIF length for ${name}`);
    if (pos + len > buf.length) throw new Error(`truncated ADIF field ${name}`);
    const value = buf.toString('utf8', pos, pos + len);
    pos += len;
    (inHeader ? header : current)[name] = value;
  }
  return { header, records };
}

/**
 * Convert parsed ADIF records into store input objects.
 * Records without a usable MODE/FREQ are returned in `skipped`; field-level validation is left to the store.
 * @param {Array<Record<string, string>>} records
 * @returns {{inputs: object[], skipped: Array<{index: number, reason: string}>}}
 */
export function adifRecordsToInputs(records) {
  const inputs = [];
  const skipped = [];
  records.forEach((r, index) => {
    let mode = (r.MODE ?? '').toUpperCase();
    const sub = (r.SUBMODE ?? '').toUpperCase();
    if (mode === 'MFSK' && sub === 'FT4') mode = 'FT4';
    else if (mode === 'USB' || mode === 'LSB') mode = 'SSB';
    if (!['SSB', 'CW', 'FT8', 'FT4'].includes(mode)) {
      skipped.push({ index, reason: 'unsupported_mode' });
      return;
    }
    inputs.push({
      call: r.CALL,
      qso_date: r.QSO_DATE,
      time_on: r.TIME_ON,
      mode,
      freq: r.FREQ,
      freq_rx: r.FREQ_RX,
      rst_sent: r.RST_SENT,
      rst_rcvd: r.RST_RCVD,
      gridsquare: r.GRIDSQUARE,
      my_gridsquare: r.MY_GRIDSQUARE,
      comment: r.COMMENT,
    });
  });
  return { inputs, skipped };
}

/**
 * Import an ADIF document into a store. Duplicates and invalid records are skipped, not fatal.
 * @param {{add: Function}} store
 * @param {string|Buffer} adif
 * @param {{email: string, callsign: string}} user
 * @returns {{imported: number, skipped: Array<{index: number, reason: string}>}}
 */
export function importAdif(store, adif, user) {
  const { records } = parseAdif(adif);
  const { inputs, skipped } = adifRecordsToInputs(records);
  // Map back to original record index for accurate reporting.
  const origin = records.map((_, i) => i).filter((i) => !skipped.some((s) => s.index === i));
  let imported = 0;
  inputs.forEach((input, n) => {
    try {
      store.add(input, user);
      imported++;
    } catch (err) {
      if (typeof err?.code !== 'string' || err.name !== 'LogError') throw err;
      skipped.push({ index: origin[n], reason: err.code });
    }
  });
  return { imported, skipped };
}

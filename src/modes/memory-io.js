import { MAX_MEMORIES_PER_USER, MemoryError, validateMemoryInput } from './memories.js';

/** Identifier and version of the JSON export; importers reject other schemas and newer versions. */
export const MEMORY_SCHEMA = 'bricohams.memories';
export const MEMORY_SCHEMA_VERSION = 1;
/** Maximum rows read from one import, whatever the file size. */
export const MAX_IMPORT_ROWS = 500;
export const CSV_HEADER = Object.freeze(['Name', 'Frequency', 'Mode', 'Filter']);

const FORMULA_START = /^[=+\-@\t\r]/;

// Cells that a spreadsheet could execute as a formula get a leading apostrophe; the importer strips it again.
const csvCell = (value) => {
  let s = String(value ?? '');
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const unprotect = (s) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

/**
 * Serialise the user's own memories (shared ones belong to the station and are not exported).
 * @param {Array<{name: string, downlinkHz: number, mode: string, filter: string|null, mine: boolean}>} items Result of `memories.list`.
 * @param {'json'|'csv'} format
 * @param {() => number} [now] Clock in ms.
 * @returns {{contentType: string, filename: string, body: string}}
 * @throws {MemoryError} `bad_format`.
 */
export function exportMemories(items, format, now = Date.now) {
  const mine = items.filter((m) => m.mine);
  if (format === 'json') {
    const body = JSON.stringify({
      schema: MEMORY_SCHEMA,
      version: MEMORY_SCHEMA_VERSION,
      exportedAt: new Date(now()).toISOString(),
      items: mine.map((m) => ({ name: m.name, downlinkHz: m.downlinkHz, mode: m.mode, filter: m.filter })),
    }, null, 2);
    return { contentType: 'application/json; charset=utf-8', filename: 'bricohams-memories.json', body };
  }
  if (format === 'csv') {
    // Frequency is in MHz like CHIRP so the file opens in other tools; 6 decimals are exact to the Hz.
    const lines = [CSV_HEADER.join(','), ...mine.map((m) => [m.name, (m.downlinkHz / 1e6).toFixed(6), m.mode, m.filter ?? ''].map(csvCell).join(','))];
    return { contentType: 'text/csv; charset=utf-8', filename: 'bricohams-memories.csv', body: `${lines.join('\r\n')}\r\n` };
  }
  throw new MemoryError('bad_format', 400);
}

function parseCsv(text, delim) {
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cur += c;
      else if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
    } else if (c === '"' && cur === '') quoted = true;
    else if (c === delim) { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

const COLUMN_ALIASES = { name: 'name', frequency: 'freq', freq: 'freq', downlinkhz: 'hz', downlink_hz: 'hz', mode: 'mode', filter: 'filter' };

function rowsFromCsv(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0];
  const table = parseCsv(clean, firstLine.includes(',') ? ',' : ';');
  if (table.length < 1) throw new MemoryError('empty_import', 400);
  const cols = {};
  table[0].forEach((h, i) => {
    const key = COLUMN_ALIASES[h.trim().toLowerCase()];
    if (key && cols[key] === undefined) cols[key] = i;
  });
  if (cols.name === undefined || (cols.freq === undefined && cols.hz === undefined) || cols.mode === undefined) throw new MemoryError('missing_columns', 400);
  return table.slice(1).map((r, i) => {
    const cell = (k) => (cols[k] === undefined ? undefined : (r[cols[k]] ?? '').trim());
    const raw = cols.hz !== undefined ? cell('hz') : cell('freq');
    let downlinkHz = Number(raw);
    // Values below 1e6 are MHz (CHIRP style); anything larger is already Hz.
    if (raw !== '' && Number.isFinite(downlinkHz) && downlinkHz < 1e6 && cols.hz === undefined) downlinkHz = Math.round(downlinkHz * 1e6);
    const filter = cell('filter');
    return {
      row: i + 2,
      input: {
        name: unprotect(cell('name') ?? ''),
        downlinkHz: raw === '' || !Number.isFinite(downlinkHz) ? NaN : Math.round(downlinkHz),
        mode: (cell('mode') ?? '').toUpperCase(),
        ...(filter ? { filter } : {}),
      },
    };
  });
}

function rowsFromJson(text) {
  let doc;
  try {
    doc = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new MemoryError('bad_json', 400);
  }
  let items = doc;
  if (doc !== null && typeof doc === 'object' && !Array.isArray(doc)) {
    if (doc.schema !== MEMORY_SCHEMA) throw new MemoryError('bad_schema', 400);
    if (!Number.isInteger(doc.version) || doc.version < 1 || doc.version > MEMORY_SCHEMA_VERSION) throw new MemoryError('unsupported_version', 400);
    items = doc.items;
  }
  if (!Array.isArray(items)) throw new MemoryError('bad_schema', 400);
  return items.map((it, i) => ({
    row: i + 1,
    input: it !== null && typeof it === 'object' && !Array.isArray(it)
      ? { name: it.name, downlinkHz: it.downlinkHz, mode: it.mode, ...(it.filter ? { filter: it.filter } : {}) }
      : null,
  }));
}

/**
 * Validate (and unless `dryRun` store) an import. Rows are checked one by one; bad rows are reported and skipped, duplicates
 * (same name, or same frequency and mode, in the store or earlier in the file) are skipped. Imported memories are always personal.
 * @param {{store: {list: Function, add: Function}, user: {email: string, role: string}, format: 'json'|'csv', content: string, dryRun?: boolean}} opts
 * @returns {{dryRun: boolean, total: number, imported: number, items: object[], duplicates: object[], invalid: object[]}}
 * @throws {MemoryError} `bad_format`, `empty_import`, `missing_columns`, `bad_json`, `bad_schema`, `unsupported_version`, `too_many_rows`.
 */
export function importMemories({ store, user, format, content, dryRun = false }) {
  if (typeof content !== 'string' || content.length === 0) throw new MemoryError('empty_import', 400);
  let rows;
  if (format === 'csv') rows = rowsFromCsv(content);
  else if (format === 'json') rows = rowsFromJson(content);
  else throw new MemoryError('bad_format', 400);
  if (rows.length > MAX_IMPORT_ROWS) throw new MemoryError('too_many_rows', 413);

  const existing = store.list(user).filter((m) => m.mine);
  const names = new Set(existing.map((m) => m.name.toLowerCase()));
  const freqs = new Set(existing.map((m) => `${m.downlinkHz}|${m.mode}`));
  const accepted = [];
  const duplicates = [];
  const invalid = [];
  for (const { row, input } of rows) {
    const checked = input === null ? { ok: false, fields: { row: 'invalid' } } : validateMemoryInput(input);
    if (!checked.ok) { invalid.push({ row, fields: checked.fields }); continue; }
    const v = checked.value;
    const fkey = `${v.downlinkHz}|${v.mode}`;
    if (names.has(v.name.toLowerCase()) || freqs.has(fkey)) { duplicates.push({ row, name: v.name }); continue; }
    if (existing.length + accepted.length >= MAX_MEMORIES_PER_USER) { invalid.push({ row, fields: { memories: 'too_many_memories' } }); continue; }
    names.add(v.name.toLowerCase());
    freqs.add(fkey);
    accepted.push({ name: v.name, downlinkHz: v.downlinkHz, mode: v.mode, filter: v.filter });
  }
  const items = dryRun ? accepted : accepted.map((a) => store.add(user, { ...a, shared: false }));
  return { dryRun, total: rows.length, imported: accepted.length, items, duplicates, invalid };
}

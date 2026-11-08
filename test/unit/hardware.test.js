import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scadDir = path.join(root, 'hardware', '3d', 'scad');

const EXPECTED_SCAD = [
  'helix_former', 'helix_reflector_cup', 'lnb_clamp_40mm', 'patch_feed_spacers',
  'dish_angle_gauge', 'pluto_bracket', 'pa_fan_duct', 'sma_biast_enclosure',
];

const REQUIRED_COLUMNS = [
  'category', 'item', 'model', 'role', 'tier', 'price_min_eur', 'price_max_eur', 'price_date',
  'price_source', 'quality_notes', 'pros', 'cons', 'compatibility', 'verified',
];

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

test('all expected .scad files exist', () => {
  const found = readdirSync(scadDir).filter((f) => f.endsWith('.scad')).map((f) => f.replace(/\.scad$/, ''));
  for (const name of EXPECTED_SCAD) assert.ok(found.includes(name), `missing ${name}.scad`);
});

test('every .scad has the required header fields and no external libraries', () => {
  const files = readdirSync(scadDir).filter((f) => f.endsWith('.scad'));
  assert.ok(files.length >= EXPECTED_SCAD.length);
  for (const f of files) {
    const src = readFileSync(path.join(scadDir, f), 'utf8');
    const header = src.split('\n').slice(0, 40).join('\n');
    assert.match(header, /^\/\/\s*Purpose:\s*\S/m, `${f}: Purpose`);
    assert.match(header, /^\/\/\s*Print settings:\s*\S/m, `${f}: Print settings`);
    assert.match(header, /^\/\/\s*RF note:\s*\S/m, `${f}: RF note`);
    assert.match(header, /^\/\/\s*Licen[cs]e:\s*GPL-3\.0-or-later/m, `${f}: licence`);
    assert.match(header, /carbon/i, `${f}: RF note must forbid carbon-fibre filament`);
    assert.doesNotMatch(src, /^\s*(include|use)\s*</m, `${f}: external library`);
    assert.doesNotMatch(src, /BOSL/i, `${f}: BOSL`);
  }
});

test('hardware/3d/README.md mentions every part', () => {
  const readme = readFileSync(path.join(root, 'hardware', '3d', 'README.md'), 'utf8');
  for (const name of EXPECTED_SCAD) assert.ok(readme.includes(`${name}.scad`), name);
});

test('components.csv has the required columns and consistent prices', () => {
  const file = path.join(root, 'hardware', 'bom', 'components.csv');
  assert.ok(existsSync(file));
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const header = rows[0];
  assert.deepEqual(header, REQUIRED_COLUMNS);
  assert.ok(rows.length > 20);
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  const tiers = new Set(['economico', 'equilibrado', 'avanzado', 'alt-HL2']);
  for (const [i, r] of rows.slice(1).entries()) {
    const label = `row ${i + 2} (${r[col.item]})`;
    assert.equal(r.length, header.length, `${label}: column count`);
    assert.ok(r[col.category] && r[col.item] && r[col.model] && r[col.role], `${label}: required text`);
    assert.ok(tiers.has(r[col.tier]), `${label}: tier ${r[col.tier]}`);
    assert.ok(['yes', 'no'].includes(r[col.verified]), `${label}: verified`);
    const minS = r[col.price_min_eur];
    const maxS = r[col.price_max_eur];
    assert.equal(minS === '', maxS === '', `${label}: min and max together`);
    if (minS !== '') {
      const min = Number(minS);
      const max = Number(maxS);
      assert.ok(Number.isFinite(min) && Number.isFinite(max) && min >= 0, `${label}: numeric prices`);
      assert.ok(min <= max, `${label}: min <= max`);
      assert.ok(r[col.price_date], `${label}: price_date`);
      assert.ok(r[col.price_source], `${label}: price_source`);
    }
    if (/\bUSD\b/.test(r[col.price_source])) {
      assert.match(r[col.price_source], /convertido/, `${label}: USD must be marked convertido`);
    }
  }
});

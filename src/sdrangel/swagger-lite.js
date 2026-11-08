import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tiny dependency-free reader for the YAML subset used by SDRangel's swagger `include/*.yaml` files:
 * top-level definitions with a `properties:` map whose entries carry `type`, `enum`, `minimum`, `maximum`, `$ref`.
 * Block scalars (`>`/`|`) are skipped. Anything it does not understand is ignored, never guessed.
 * @param {string} text
 * @returns {Record<string, {properties: Record<string, {type?: string, enum?: Array<string|number>, minimum?: number, maximum?: number, ref?: string}>}>}
 */
export function parseDefinitions(text) {
  const defs = {};
  let def = null;
  let inProps = false;
  let prop = null;
  let inEnum = false;
  let blockIndent = -1;
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (blockIndent >= 0) {
      if (indent > blockIndent) continue;
      blockIndent = -1;
    }
    if (indent === 0) {
      const m = /^([A-Za-z0-9_]+):\s*$/.exec(line);
      def = m ? (defs[m[1]] = { properties: {} }) : null;
      inProps = false;
      prop = null;
      continue;
    }
    if (!def) continue;
    if (indent === 2) {
      inProps = line === 'properties:';
      prop = null;
      continue;
    }
    if (!inProps) continue;
    if (indent === 4) {
      const m = /^([A-Za-z0-9_]+):\s*$/.exec(line);
      prop = m ? (def.properties[m[1]] = {}) : null;
      inEnum = false;
      continue;
    }
    if (!prop || indent < 6) continue;
    if (indent === 6) {
      inEnum = false;
      const m = /^([A-Za-z0-9_$]+):\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, key, value] = m;
      if (/^[>|][+-]?$/.test(value)) blockIndent = indent;
      else if (key === 'type') prop.type = value;
      else if (key === 'minimum' || key === 'maximum') prop[key] = Number(value);
      else if (key === '$ref') prop.ref = value.replace(/['"]/g, '').split('/').pop();
      else if (key === 'enum') {
        prop.enum = [];
        inEnum = true;
        const inline = /^\[(.*)\]$/.exec(value);
        if (inline) {
          prop.enum = inline[1].split(',').map((s) => unquote(s.trim())).filter((s) => s !== '');
          inEnum = false;
        }
      }
    } else if (inEnum && line.startsWith('- ')) {
      prop.enum.push(unquote(line.slice(2).trim()));
    }
  }
  return defs;
}

function unquote(s) {
  const t = s.replace(/^['"]|['"]$/g, '');
  return /^-?\d+$/.test(t) ? Number(t) : t;
}

/**
 * Load every `*.yaml` in a swagger include directory.
 * @param {string} dir
 * @returns {ReturnType<typeof parseDefinitions>}
 */
export function loadDefinitions(dir) {
  const all = {};
  for (const f of readdirSync(dir)) if (f.endsWith('.yaml')) Object.assign(all, parseDefinitions(readFileSync(join(dir, f), 'utf8')));
  return all;
}

/**
 * Validate a settings object against a definition: unknown keys and wrong basic types are errors.
 * Nested objects (`$ref` or `type: object`) only need to be plain objects and are not descended into.
 * @param {ReturnType<typeof parseDefinitions>} defs
 * @param {string} name Definition name, e.g. `UDPSourceSettings`.
 * @param {unknown} body
 * @returns {string[]} Error messages; empty when valid.
 */
export function validateAgainst(defs, name, body) {
  const def = defs[name];
  if (!def) return [`unknown definition ${name}`];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [`${name} must be an object`];
  const errors = [];
  for (const [key, value] of Object.entries(body)) {
    const p = Object.hasOwn(def.properties, key) ? def.properties[key] : null;
    if (!p) {
      errors.push(`${name}.${key}: unknown property`);
      continue;
    }
    const e = checkType(p, value);
    if (e) errors.push(`${name}.${key}: ${e}`);
  }
  return errors;
}

function checkType(p, v) {
  if (p.ref || p.type === 'object') return v && typeof v === 'object' && !Array.isArray(v) ? null : 'expected object';
  switch (p.type) {
    case 'integer':
      if (!Number.isInteger(v)) return 'expected integer';
      break;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'expected number';
      break;
    case 'string':
      return typeof v === 'string' ? null : 'expected string';
    case 'boolean':
      return typeof v === 'boolean' ? null : 'expected boolean';
    case 'array':
      return Array.isArray(v) ? null : 'expected array';
    default:
      return null;
  }
  if (p.minimum !== undefined && v < p.minimum) return `below minimum ${p.minimum}`;
  if (p.maximum !== undefined && v > p.maximum) return `above maximum ${p.maximum}`;
  if (p.enum?.length && !p.enum.includes(v)) return `not in enum ${p.enum.join(',')}`;
  return null;
}

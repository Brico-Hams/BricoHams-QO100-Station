import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const DIR = new URL('../../src/web/public/', import.meta.url);
const dir = DIR.pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = readdirSync(dir);

test('every public .js file compiles', () => {
  const scripts = files.filter((f) => f.endsWith('.js'));
  assert.ok(scripts.includes('app.js'));
  for (const f of scripts) {
    assert.doesNotThrow(() => new vm.Script(readFileSync(join(dir, f), 'utf8'), { filename: f }), f);
  }
});

test('manifest is valid JSON and SVG icons look like SVG', () => {
  const m = JSON.parse(readFileSync(join(dir, 'manifest.webmanifest'), 'utf8'));
  assert.ok(m.name);
  for (const f of files.filter((x) => x.endsWith('.svg'))) {
    assert.match(readFileSync(join(dir, f), 'utf8').trimStart(), /^(<\?xml[^>]*>\s*)?<svg/);
  }
});

test('index.html only references local files and has no inline code', () => {
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /\sstyle=/);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>\s*\S/);
  for (const [, ref] of html.matchAll(/(?:href|src)="(\/[^"#?]*)"/g)) {
    if (ref === '/' || ref.startsWith('/auth/') || ref.startsWith('/api/')) continue; // server routes, not static files
    assert.ok(existsSync(join(dir, ref)), `missing ${ref}`);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

test('web styles use the Manual de color BricoHams v1.1', () => {
  const css = read('src', 'web', 'public', 'styles.css');
  assert.match(css, /--bh-ink:\s*#23272b/i);
  assert.match(css, /--bh-orange:\s*#f26b1d/i);
  assert.match(css, /--accent-text:\s*#23272b/i);
  // Retired palette must not come back in the web UI (figures keep their own palette).
  for (const old of ['#12263f', '#e8871e', '#0d1c30', '#1b3556']) assert.doesNotMatch(css, new RegExp(old, 'i'), old);
});

test('every manual figure has viewBox, title, desc and the BricoHams credit', () => {
  const dir = join(root, 'docs', 'manual', 'figures');
  const svgs = readdirSync(dir).filter((f) => f.endsWith('.svg'));
  assert.ok(svgs.length >= 20, `only ${svgs.length} figures`);
  for (const f of svgs) {
    const svg = readFileSync(join(dir, f), 'utf8');
    assert.match(svg, /viewBox="/, f);
    assert.match(svg, /<title[^>]*>[^<]+<\/title>/, f);
    assert.match(svg, /<desc[^>]*>[^<]+<\/desc>/, f);
    assert.match(svg, /BricoHams/, f);
  }
});

test('README and help index link the original logo', () => {
  assert.match(read('README.md'), /branding\/bricohams_horizontal\.(svg|png)/);
  assert.match(read('docs', 'help', 'index.md'), /branding\/bricohams_horizontal\.png/);
  assert.match(read('docs', 'manual', 'es', 'README.md'), /branding\/bricohams_horizontal\.png/);
});

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? markdownFiles(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : []));
}

test('no document claims endorsement by third parties', () => {
  const files = [join(root, 'README.md'), join(root, 'NOTICE.md'), ...markdownFiles(join(root, 'docs', 'manual')), ...markdownFiles(join(root, 'docs', 'help'))];
  const claim = /endorse|respald|avalad|patrocin|oficialmente (?:aprobad|certificad)|officially (?:approved|certified)/i;
  const negation = /\b(?:no|not|never|none|ni|nunca|sin|ninguno|ninguna|ningún)\b/i;
  for (const f of files) {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      if (claim.test(line)) assert.match(line, negation, `${f}: ${line}`);
    }
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const manual = join(root, 'docs', 'manual');
const langs = ['es', 'en', 'fr', 'pt'];
const list = (lang) => readdirSync(join(manual, lang)).filter((f) => f.endsWith('.md')).sort();

test('every language folder has the same chapter files as the Spanish master', () => {
  const master = list('es');
  assert.ok(master.length >= 16, `only ${master.length} master files`);
  for (const lang of langs) assert.deepEqual(list(lang), master, lang);
});

test('every chapter starts with the language switcher', () => {
  for (const lang of langs) {
    for (const f of list(lang)) {
      const first = readFileSync(join(manual, lang, f), 'utf8').split(/\r?\n/, 1)[0];
      const expected = `[ES](../es/${f}) · [EN](../en/${f}) · [FR](../fr/${f}) · [PT](../pt/${f})`;
      assert.equal(first, expected, `${lang}/${f}`);
    }
  }
});

test('relative links in the manual resolve to existing files', () => {
  const files = [join(manual, 'README.md'), ...langs.flatMap((l) => list(l).map((f) => join(manual, l, f)))];
  const linkRe = /(?:\]\(|src=")(?!https?:|mailto:|#)([^)"\s]+)/g;
  let checked = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const m of text.matchAll(linkRe)) {
      const target = decodeURIComponent(m[1].split('#')[0]);
      if (!target) continue;
      checked++;
      assert.ok(existsSync(resolve(dirname(file), target)), `${file}: broken link ${m[1]}`);
    }
  }
  assert.ok(checked > 50, `only ${checked} links checked`);
});

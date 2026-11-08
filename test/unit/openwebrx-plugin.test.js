import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../../plugins/openwebrx/', import.meta.url);
const jsFiles = readdirSync(dir).filter((f) => f.endsWith('.js'));

test('plugin sources contain no TX, PTT, log or microphone references', () => {
  const forbidden = [/getUserMedia/i, /\/api\/ptt/i, /\/api\/log/i, /ptt/i, /WebSocket/i, /\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/];
  assert.ok(jsFiles.length > 0);
  for (const f of jsFiles) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const re of forbidden) assert.doesNotMatch(src, re, `${f} must not match ${re}`);
  }
});

test('bookmarks are inside the NB downlink range', () => {
  const src = readFileSync(new URL('bricohams.js', dir), 'utf8');
  const m = src.match(/\/\*BEGIN_BOOKMARKS\*\/([\s\S]*?)\/\*END_BOOKMARKS\*\//);
  assert.ok(m, 'bookmark markers present');
  const list = JSON.parse(m[1]);
  assert.ok(list.length >= 3);
  for (const b of list) {
    assert.ok(b.frequency >= 10489500000 && b.frequency <= 10490000000, `${b.name} out of NB range`);
  }
  assert.ok(list.some((b) => b.frequency === 10489750000), 'central beacon bookmarked');
});

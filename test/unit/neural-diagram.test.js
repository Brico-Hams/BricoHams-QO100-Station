import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseImports, buildGraph, layerNodes, generate } from '../../docs/architecture/generate-neural.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test('parseImports handles quotes, multi-line imports and export-from', () => {
  const src = [
    "import a from './a.js';",
    'import { b } from "../b.js";',
    'import {',
    '  c,',
    '  d',
    "} from './c.js';",
    "export * from './star.js';",
    "export { e } from './e.js';",
    "import './side-effect.js';"
  ].join('\n');
  assert.deepEqual(parseImports(src), ['./a.js', '../b.js', './c.js', './star.js', './e.js', './side-effect.js']);
});

test('parseImports ignores bare packages, dynamic import, comments and plain exports', () => {
  const src = [
    "import ws from 'ws';",
    "import fs from 'node:fs';",
    "// import x from './commented.js';",
    "/* import y from './block.js'; */",
    "const m = await import('./dynamic.js');",
    "export const name = './not-an-import.js';",
    "import ok from './ok.js';"
  ].join('\n');
  assert.deepEqual(parseImports(src), ['./ok.js']);
});

test('buildGraph aggregates module edges with import counts', () => {
  const files = [
    { path: 'src/a/index.js', source: "import { x } from '../b/x.js';\nimport { y } from '../b/index.js';\nimport z from './local.js';\n" },
    { path: 'src/a/local.js', source: 'export default 1;\n' },
    { path: 'src/b/x.js', source: "import '../c/index.js';\nexport const x = 1;\n" },
    { path: 'src/b/index.js', source: 'export const y = 2;\n' },
    { path: 'src/c/index.js', source: 'export {};\n' }
  ];
  const g = buildGraph(files);
  assert.deepEqual(g.nodes.map((n) => n.id), ['src/a', 'src/b', 'src/c']);
  assert.deepEqual(g.edges, [
    { from: 'src/a', to: 'src/b', weight: 2, kind: 'import' },
    { from: 'src/b', to: 'src/c', weight: 1, kind: 'import' }
  ]);
});

test('layerNodes orders edges forward and reports cycles without crashing', () => {
  const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const edges = [
    { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'c' },
    { from: 'c', to: 'b' }, { from: 'd', to: 'c' }
  ];
  const { layers, cycles } = layerNodes(nodes, edges);
  assert.deepEqual(cycles, [{ from: 'c', to: 'b' }]);
  for (const e of edges) {
    if (cycles.some((c) => c.from === e.from && c.to === e.to)) continue;
    assert.ok(layers[e.from] < layers[e.to], `${e.from} -> ${e.to}`);
  }
  assert.equal(layers.c, 2);
});

test('generator on the real repo covers every src module and emits no NaN', () => {
  const { svg, json } = generate(ROOT, { write: false });
  const dirs = readdirSync(join(ROOT, 'src')).filter((n) => statSync(join(ROOT, 'src', n)).isDirectory());
  for (const d of dirs) assert.ok(svg.includes(`src/${d}`), `missing src/${d}`);
  assert.ok(!svg.includes('NaN') && !svg.includes('Infinity'));
  assert.ok(svg.includes('prefers-color-scheme: dark'));
  assert.ok(svg.includes('data:image/png;base64,'));
  assert.ok(json.nodes.length > 15 && json.edges.some((e) => e.kind === 'import') && json.edges.some((e) => e.kind === 'external'));
  assert.equal(generate(ROOT, { write: false }).svg, svg);
});

#!/usr/bin/env node
// Deterministic generator of the BricoHams "neural diagram": every component is a neuron and
// every synapse is a real dependency (static imports) or a verified external link.
// Output: docs/architecture/neural-diagram.svg and docs/architecture/neural-graph.json.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..', '..');

const COLORS = { navy: '#12263f', orange: '#e8871e', grey: '#5b6b7b', charcoal: '#22262b' };
const CRITICAL_MODULES = new Set(['src/ptt', 'src/auth', 'src/webrtc']);

// Spanish one-liners shown under each neuron.
const ROLES = {
  'src/server': 'Hub: HTTP, WS, config y cableado',
  'src/auth': 'Login Google OIDC, sesiones, CSRF',
  'src/ptt': 'Máquina de estados PTT + auditoría',
  'src/sdrangel': 'Cliente REST y driver PTT de SDRangel',
  'src/modes': 'Frecuencias, modos, decodificadores',
  'src/beacon': 'Estimador y lazo de corrección del faro',
  'src/cluster': 'Clúster DX, spots y calendario .ics',
  'src/plugins': 'Plugins cliente y webhooks firmados',
  'src/webrtc': 'Audio RX/TX y espectro por WSS',
  'src/log': 'Libro de guardia, ADIF, LoTW, QRZ',
  'src/web': 'UI web PWA (AudioWorklets)',
  electron: 'Envoltorio de escritorio',
  'plugins/openwebrx': 'Plugin OpenWebRX+ (solo recepción)',
  'services/qo100-calculators': 'Calculadoras QO-100 (estáticas)'
};

// External neurons. Every link below was checked against the code (see `evidence`).
const EXTERNAL_NODES = [
  { id: 'ext:operator', layer: 'in', label: 'Operador', role: 'Navegador / micro HTML5' },
  { id: 'ext:listener', layer: 'in', label: 'Oyente', role: 'Navegador (solo escucha)' },
  { id: 'ext:google', layer: 'in', label: 'Google OIDC', role: 'Identidad (accounts.google.com)' },
  { id: 'ext:sdr', layer: 'in', label: 'Hardware SDR', role: 'Vía SDRangel (REST, UDP, WS)' },
  { id: 'ext:cluster', layer: 'in', label: 'Clúster DX + calendario', role: 'Telnet DX y feed .ics' },
  { id: 'out:rf', layer: 'out', label: 'Subida RF 2,4 GHz', role: 'SDRangel TX (UDP + PTT REST)' },
  { id: 'out:logbook', layer: 'out', label: 'Libro ADIF / LoTW / QRZ', role: 'SQLite, tqsl, logbook.qrz.com' },
  { id: 'out:openwebrx', layer: 'out', label: 'Oyentes OpenWebRX', role: 'Receptores OpenWebRX+' },
  { id: 'out:webhooks', layer: 'out', label: 'Webhooks', role: 'POST firmado (HMAC) a terceros' },
  { id: 'out:audit', layer: 'out', label: 'Registro de auditoría', role: 'audit.log (JSON lines, 0600)' }
];

const EXTERNAL_EDGES = [
  // evidence: src/web/public/{app,mic-capture,rx-player}.js (fetch, WebSocket, AudioWorklet)
  { from: 'ext:operator', to: 'src/web', note: 'navegador + micro (AudioWorklet)' },
  { from: 'ext:listener', to: 'src/web', note: 'navegador' },
  // evidence: electron/main.js loadURL(localOrigin)
  { from: 'ext:operator', to: 'electron', note: 'ventana de escritorio' },
  // evidence: app.js fetch('/api/...') and new WebSocket(url)
  { from: 'src/web', to: 'src/server', note: 'HTTPS + WSS /ws/control' },
  // evidence: src/auth/oidc.js import('openid-client')
  { from: 'ext:google', to: 'src/auth', note: 'OIDC (state, nonce, PKCE)' },
  // evidence: src/sdrangel/client.js fetch(baseUrl); src/webrtc/{rx-audio,spectrum}.js dgram + ws
  { from: 'ext:sdr', to: 'src/sdrangel', note: 'REST :8091' },
  { from: 'ext:sdr', to: 'src/webrtc', note: 'UDP RX 48 kHz + WS espectro' },
  // evidence: src/cluster/client.js node:net, src/cluster/calendar.js fetch(.ics)
  { from: 'ext:cluster', to: 'src/cluster', note: 'telnet + .ics' },
  // evidence: src/webrtc/tx-audio.js dgram; src/sdrangel/ptt-driver.js
  { from: 'src/webrtc', to: 'out:rf', note: 'UDP TX 48 kHz' },
  { from: 'src/sdrangel', to: 'out:rf', note: 'PTT por REST' },
  // evidence: src/log/lotw.js execFile(tqsl), src/log/qrz.js fetch(QRZ_URL)
  { from: 'src/log', to: 'out:logbook', note: 'ADIF, tqsl, QRZ' },
  // evidence: plugins/openwebrx (client-side plugin for OpenWebRX+)
  { from: 'plugins/openwebrx', to: 'out:openwebrx', note: 'plugin del receptor' },
  // evidence: src/plugins/webhooks.js fetchImpl(endpoint.url)
  { from: 'src/plugins', to: 'out:webhooks', note: 'POST HMAC' },
  // evidence: src/ptt/audit.js appendFileSync
  { from: 'src/ptt', to: 'out:audit', note: 'tx_on / tx_off' }
];

const IMPORT_RE = /^[ \t]*(?:import|export)\b(?!\s*\()(?:[^'";]*?\bfrom\s*|\s*)(['"])([^'"\n]+)\1/gm;

/** Extract relative specifiers of static `import`/`export ... from` statements (one entry per statement). */
export function parseImports(source) {
  const clean = String(source).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const out = [];
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(clean)) !== null) {
    const spec = m[2];
    if (spec.startsWith('./') || spec.startsWith('../')) out.push(spec);
  }
  return out;
}

/** Resolve a relative specifier against the importing file; returns a known path or null. Paths are POSIX, repo-relative. */
export function resolveImport(fromPath, spec, known) {
  const base = posix.normalize(posix.join(posix.dirname(fromPath), spec));
  for (const c of [base, `${base}.js`, `${base}/index.js`]) if (known.has(c)) return c;
  return null;
}

/** Map a repo-relative file to its module id. */
export function moduleOf(path) {
  const p = path.split('/');
  if (p[0] === 'src') return p.length > 2 ? `src/${p[1]}` : 'src';
  if (p[0] === 'electron') return 'electron';
  if (p[0] === 'plugins' || p[0] === 'services') return `${p[0]}/${p[1]}`;
  return p[0];
}

const countLoc = (s) => String(s).split(/\r?\n/).filter((l) => l.trim() !== '').length;

/**
 * Build the module graph. `files` is `[{path, source}]` with POSIX repo-relative paths.
 * Edge direction: importer -> imported; weight = number of import statements.
 */
export function buildGraph(files, { moduleOf: modFn = moduleOf } = {}) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const known = new Set(sorted.map((f) => f.path));
  const nodes = new Map();
  const weights = new Map();
  for (const f of sorted) {
    const id = modFn(f.path);
    const node = nodes.get(id) ?? { id, loc: 0, files: 0 };
    node.loc += countLoc(f.source);
    node.files += 1;
    nodes.set(id, node);
  }
  for (const f of sorted) {
    const from = modFn(f.path);
    for (const spec of parseImports(f.source)) {
      const target = resolveImport(f.path, spec, known);
      if (!target) continue;
      const to = modFn(target);
      if (to === from) continue;
      const key = `${from}\u0000${to}`;
      weights.set(key, (weights.get(key) ?? 0) + 1);
    }
  }
  const edges = [...weights.entries()]
    .map(([k, weight]) => { const [from, to] = k.split('\u0000'); return { from, to, weight, kind: 'import' }; })
    .sort((a, b) => (a.from + a.to < b.from + b.to ? -1 : 1));
  return { nodes: [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), edges };
}

/**
 * Longest-path layering. Back edges that close a cycle are dropped for layering and reported in `cycles`.
 * Returns `{layers: {id: n}, cycles: [{from, to}]}`; every non-cycle edge goes from a lower to a higher layer.
 */
export function layerNodes(nodes, edges, { base = 0 } = {}) {
  const ids = nodes.map((n) => (typeof n === 'string' ? n : n.id)).sort();
  const idSet = new Set(ids);
  const adj = new Map(ids.map((id) => [id, []]));
  for (const e of edges) if (idSet.has(e.from) && idSet.has(e.to)) adj.get(e.from).push(e.to);
  for (const list of adj.values()) list.sort();

  const cycles = [];
  const dropped = new Set();
  const state = new Map();
  const visit = (u) => {
    state.set(u, 1);
    for (const v of adj.get(u)) {
      if (state.get(v) === 1) { cycles.push({ from: u, to: v }); dropped.add(`${u}\u0000${v}`); }
      else if (!state.has(v)) visit(v);
    }
    state.set(u, 2);
  };
  for (const id of ids) if (!state.has(id)) visit(id);

  const preds = new Map(ids.map((id) => [id, []]));
  for (const [u, list] of adj) for (const v of list) if (!dropped.has(`${u}\u0000${v}`)) preds.get(v).push(u);
  const layers = {};
  const depth = (v) => {
    if (layers[v] !== undefined) return layers[v];
    let d = base;
    for (const u of preds.get(v)) d = Math.max(d, depth(u) + 1);
    layers[v] = d;
    return d;
  };
  for (const id of ids) depth(id);
  return { layers, cycles };
}

function walk(dir, out) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
}

/** Collect the scanned source files of the repository (POSIX repo-relative paths). */
export function collectFiles(root = DEFAULT_ROOT) {
  const abs = [];
  if (existsSync(join(root, 'src'))) walk(join(root, 'src'), abs);
  if (existsSync(join(root, 'electron', 'main.js'))) abs.push(join(root, 'electron', 'main.js'));
  for (const dir of [join(root, 'plugins', 'openwebrx'), join(root, 'services', 'qo100-calculators', 'assets')]) {
    if (existsSync(dir)) for (const n of readdirSync(dir).sort()) if (n.endsWith('.js')) abs.push(join(dir, n));
  }
  return abs.map((p) => ({ path: relative(root, p).split('\\').join('/'), source: readFileSync(p, 'utf8') }));
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);

/** Assemble the full graph (internal modules + external neurons) with layers. */
export function assembleGraph(files) {
  const internal = buildGraph(files);
  const internalIds = new Set(internal.nodes.map((n) => n.id));
  const extEdges = EXTERNAL_EDGES.filter((e) => [e.from, e.to].every((id) => internalIds.has(id) || id.startsWith('ext:') || id.startsWith('out:')))
    .map((e) => ({ ...e, weight: 1, kind: 'external' }));
  const flowEdges = [...internal.edges, ...extEdges.filter((e) => internalIds.has(e.from) && internalIds.has(e.to))];
  const { layers, cycles } = layerNodes(internal.nodes, flowEdges, { base: 1 });
  const maxHidden = Math.max(1, ...Object.values(layers));
  const nodes = [];
  for (const n of EXTERNAL_NODES) {
    nodes.push({ id: n.id, layer: n.layer === 'in' ? 0 : maxHidden + 1, loc: 0, role: n.role, kind: 'external', label: n.label });
  }
  for (const n of internal.nodes) {
    nodes.push({
      id: n.id, layer: layers[n.id], loc: n.loc, role: ROLES[n.id] ?? 'módulo',
      kind: CRITICAL_MODULES.has(n.id) ? 'critical' : 'core', label: n.id
    });
  }
  const edges = [...internal.edges, ...extEdges].map(({ from, to, weight, kind, note }) => (note ? { from, to, weight, kind, note } : { from, to, weight, kind }));
  return { nodes, edges, cycles, maxLayer: maxHidden + 1 };
}

function pngSize(buf) {
  if (buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  return { w: 400, h: 100 };
}

const CSS = `
  .bg { fill: #ffffff; }
  .txt { fill: ${COLORS.charcoal}; font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .muted { fill: ${COLORS.grey}; }
  .accent { fill: ${COLORS.orange}; }
  .halo { stroke: #ffffff; stroke-width: 3.5px; paint-order: stroke; stroke-linejoin: round; }
  .logo-bg { fill: #ffffff; stroke: none; }
  .rule { stroke: #d5dbe1; stroke-width: 1; }
  .n-core { fill: ${COLORS.navy}; stroke: ${COLORS.navy}; }
  .n-critical { fill: ${COLORS.orange}; stroke: #a85d0c; }
  .n-external { fill: ${COLORS.grey}; stroke: #3f4c59; }
  .n-core, .n-critical, .n-external { fill-opacity: 0.9; stroke-width: 2; }
  .e-core { stroke: ${COLORS.navy}; }
  .e-critical { stroke: ${COLORS.orange}; }
  .e-external { stroke: ${COLORS.grey}; }
  .edge { fill: none; stroke-opacity: 0.42; stroke-linecap: round; }
  .dash { stroke-dasharray: 7 5; }
  @media (prefers-color-scheme: dark) {
    .bg { fill: #12171d; }
    .txt { fill: #e8edf2; }
    .muted { fill: #a9b6c3; }
    .accent { fill: #f4a54a; }
    .halo { stroke: #12171d; }
    .logo-bg { fill: #ffffff; }
    .rule { stroke: #33404d; }
    .n-core { fill: #6f9bd1; stroke: #b4cdea; }
    .n-critical { fill: #f0a04b; stroke: #ffd2a0; }
    .n-external { fill: #8a9aab; stroke: #cfd8e1; }
    .e-core { stroke: #8db4e3; }
    .e-critical { stroke: #f4a54a; }
    .e-external { stroke: #aab7c4; }
    .edge { stroke-opacity: 0.55; }
  }`;

/** Render the graph as a standalone SVG string. `logoPng` is a Buffer (or null). */
export function renderSvg(graph, { logoPng = null } = {}) {
  const { nodes, edges, maxLayer } = graph;
  const MARGIN = 60, COL_W = 330, HEADER_H = 120, TITLES_H = 36, GAP = 20, LABEL_H = 38, LEGEND_H = 190, FOOTER_H = 70;
  const radius = (n) => (n.kind === 'external' ? 16 : Math.min(44, Math.max(12, Math.sqrt(n.loc) * 0.55)));
  const byLayer = new Map();
  for (const n of nodes) { if (!byLayer.has(n.layer)) byLayer.set(n.layer, []); byLayer.get(n.layer).push(n); }

  // Order each layer by the barycentre of already placed neighbours (stable, deterministic).
  const rank = new Map();
  const neighbours = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) { neighbours.get(e.from)?.push(e.to); neighbours.get(e.to)?.push(e.from); }
  const extOrder = new Map(EXTERNAL_NODES.map((n, i) => [n.id, i]));
  for (let l = 0; l <= maxLayer; l++) {
    const list = byLayer.get(l) ?? [];
    const bary = (n) => {
      const vals = neighbours.get(n.id).filter((id) => rank.has(id)).map((id) => rank.get(id));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    list.sort((a, b) => {
      if (l === 0 || l === maxLayer) return extOrder.get(a.id) - extOrder.get(b.id);
      const ba = bary(a), bb = bary(b);
      if (ba !== null && bb !== null && ba !== bb) return ba - bb;
      if ((ba === null) !== (bb === null)) return ba === null ? 1 : -1;
      return a.id < b.id ? -1 : 1;
    });
    list.forEach((n, i) => rank.set(n.id, list.length > 1 ? i / (list.length - 1) : 0.5));
    byLayer.set(l, list);
  }

  const slot = (n) => 2 * radius(n) + LABEL_H + GAP;
  const layerH = (l) => (byLayer.get(l) ?? []).reduce((s, n) => s + slot(n), 0);
  let diagramH = 0;
  for (let l = 0; l <= maxLayer; l++) diagramH = Math.max(diagramH, layerH(l));
  const top = HEADER_H + TITLES_H;
  const W = MARGIN * 2 + maxLayer * COL_W + 160;
  const H = top + diagramH + LEGEND_H + FOOTER_H;

  const pos = new Map();
  for (let l = 0; l <= maxLayer; l++) {
    let y = top + (diagramH - layerH(l)) / 2;
    for (const n of byLayer.get(l) ?? []) {
      const r = radius(n);
      pos.set(n.id, { x: MARGIN + 80 + l * COL_W, y: y + r + 4, r, n });
      y += slot(n);
    }
  }

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${num(W)} ${num(H)}" width="${num(W)}" height="${num(H)}" role="img" aria-labelledby="t d">`);
  out.push('<title id="t">BricoHams QO-100 Station — diagrama neural de componentes</title>');
  out.push('<desc id="d">Cada componente es una neurona; las sinapsis son los imports reales y los enlaces externos verificados.</desc>');
  out.push(`<style>${CSS}\n</style>`);
  out.push(`<rect class="bg" x="0" y="0" width="${num(W)}" height="${num(H)}"/>`);

  // Header
  let titleX = MARGIN;
  if (logoPng) {
    const { w, h } = pngSize(logoPng);
    const lh = 64, lw = (w / h) * lh;
    out.push(`<rect class="logo-bg" x="${MARGIN - 8}" y="${22}" width="${num(lw + 16)}" height="${lh + 16}" rx="8"/>`);
    out.push(`<image x="${MARGIN}" y="30" width="${num(lw)}" height="${lh}" xlink:href="data:image/png;base64,${logoPng.toString('base64')}" href="data:image/png;base64,${logoPng.toString('base64')}"/>`);
    titleX = MARGIN + lw + 36;
  }
  out.push(`<text class="txt" x="${num(titleX)}" y="58" font-size="28" font-weight="700">BricoHams QO-100 Station — diagrama neural de componentes</text>`);
  out.push(`<text class="accent" x="${num(titleX)}" y="88" font-size="16" font-weight="600">Radioafición · Hazlo tú mismo</text>`);
  out.push(`<line class="rule" x1="${MARGIN}" y1="${HEADER_H}" x2="${num(W - MARGIN)}" y2="${HEADER_H}"/>`);

  // Layer titles
  for (let l = 0; l <= maxLayer; l++) {
    const t = l === 0 ? 'Entrada' : l === maxLayer ? 'Salida' : `Capa oculta ${l}`;
    out.push(`<text class="txt muted" x="${num(MARGIN + 80 + l * COL_W)}" y="${HEADER_H + 24}" font-size="13" font-weight="600" text-anchor="middle">${esc(t.toUpperCase())}</text>`);
  }

  // Synapses (drawn first so neurons sit on top)
  out.push('<g id="synapses">');
  for (const e of edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + a.r, y1 = a.y, x2 = b.x - b.r, y2 = b.y;
    const k = Math.max(60, Math.abs(x2 - x1) * 0.45);
    const width = Math.min(8, 1 + e.weight * 0.45);
    const cls = `edge e-${a.n.kind}${e.kind === 'external' ? ' dash' : ''}`;
    const tip = e.kind === 'import' ? `${e.from} → ${e.to}: ${e.weight} import(s)` : `${e.from} → ${e.to}: ${e.note ?? 'enlace externo'}`;
    out.push(`<path class="${cls}" stroke-width="${num(width)}" d="M ${num(x1)} ${num(y1)} C ${num(x1 + k)} ${num(y1)}, ${num(x2 - k)} ${num(y2)}, ${num(x2)} ${num(y2)}"><title>${esc(tip)}</title></path>`);
  }
  out.push('</g>');

  // Neurons + labels
  out.push('<g id="neurons">');
  for (const n of nodes) {
    const p = pos.get(n.id);
    const name = n.kind === 'external' ? n.label : n.id;
    const tip = `${name}: ${n.role}${n.loc ? ` (${n.loc} líneas)` : ''}`;
    out.push(`<circle class="n-${n.kind}" cx="${num(p.x)}" cy="${num(p.y)}" r="${num(p.r)}"><title>${esc(tip)}</title></circle>`);
    out.push(`<text class="txt halo" x="${num(p.x)}" y="${num(p.y + p.r + 16)}" font-size="13" font-weight="700" text-anchor="middle">${esc(name)}</text>`);
    out.push(`<text class="txt muted halo" x="${num(p.x)}" y="${num(p.y + p.r + 32)}" font-size="11" text-anchor="middle">${esc(n.role)}</text>`);
  }
  out.push('</g>');

  // Legend
  const ly = top + diagramH + 30;
  out.push(`<line class="rule" x1="${MARGIN}" y1="${num(ly - 14)}" x2="${num(W - MARGIN)}" y2="${num(ly - 14)}"/>`);
  out.push(`<text class="txt" x="${MARGIN}" y="${num(ly + 6)}" font-size="14" font-weight="700">Leyenda</text>`);
  const item = (x, y, cls, text) => {
    out.push(`<circle class="${cls}" cx="${num(x)}" cy="${num(y)}" r="9"/>`);
    out.push(`<text class="txt" x="${num(x + 20)}" y="${num(y + 4)}" font-size="12">${esc(text)}</text>`);
  };
  item(MARGIN + 10, ly + 32, 'n-core', 'Núcleo interno (módulo del repositorio)');
  item(MARGIN + 10, ly + 58, 'n-critical', 'Crítico para seguridad: PTT, auth, ruta TX (webrtc)');
  item(MARGIN + 10, ly + 84, 'n-external', 'Sistema externo (no visible en los imports)');
  out.push(`<text class="txt" x="${MARGIN}" y="${num(ly + 114)}" font-size="12">Radio de la neurona ∝ √(líneas de código del módulo).</text>`);
  out.push(`<text class="txt" x="${MARGIN}" y="${num(ly + 134)}" font-size="12">Capas: entrada → ocultas (camino más largo del grafo de imports) → salida.</text>`);
  const ex = MARGIN + 520;
  out.push(`<text class="txt" x="${ex}" y="${num(ly + 6)}" font-size="14" font-weight="700">Sinapsis</text>`);
  [[1, 'Grosor ∝ nº de sentencias import (1)'], [4, 'Grosor ∝ nº de sentencias import (4)'], [8, 'Grosor ∝ nº de sentencias import (8 o más)']].forEach(([w, text], i) => {
    const y = ly + 32 + i * 26;
    out.push(`<line class="edge e-core" stroke-width="${num(Math.min(8, 1 + w * 0.45))}" x1="${ex}" y1="${num(y)}" x2="${ex + 60}" y2="${num(y)}"/>`);
    out.push(`<text class="txt" x="${ex + 76}" y="${num(y + 4)}" font-size="12">${esc(text)}</text>`);
  });
  out.push(`<line class="edge e-external dash" stroke-width="2" x1="${ex}" y1="${num(ly + 110)}" x2="${ex + 60}" y2="${num(ly + 110)}"/>`);
  out.push(`<text class="txt" x="${ex + 76}" y="${num(ly + 114)}" font-size="12">Línea discontinua: enlace externo / en ejecución (verificado en el código)</text>`);

  // Footer
  const fy = H - FOOTER_H + 22;
  out.push(`<line class="rule" x1="${MARGIN}" y1="${num(fy - 18)}" x2="${num(W - MARGIN)}" y2="${num(fy - 18)}"/>`);
  out.push(`<text class="txt" x="${MARGIN}" y="${num(fy)}" font-size="12">bricohams.org · Anatol EA5KAO, Diego EA5JEF, Pedro Roca Molina · GPL-3.0-or-later</text>`);
  out.push(`<text class="txt muted" x="${MARGIN}" y="${num(fy + 20)}" font-size="11">Generado por docs/architecture/generate-neural.mjs a partir de los imports reales</text>`);
  out.push('</svg>');
  return out.join('\n') + '\n';
}

/** Run the full pipeline. With `write: false` nothing is written to disk. */
export function generate(root = DEFAULT_ROOT, { write = true } = {}) {
  const files = collectFiles(root);
  const graph = assembleGraph(files);
  const logoPath = join(root, 'branding', 'bricohams_horizontal.png');
  const logoPng = existsSync(logoPath) ? readFileSync(logoPath) : null;
  const svg = renderSvg(graph, { logoPng });
  const json = {
    nodes: graph.nodes.map(({ id, layer, loc, role, kind }) => ({ id, layer, loc, role, kind })),
    edges: graph.edges.map(({ from, to, weight, kind }) => ({ from, to, weight, kind })),
    cycles: graph.cycles
  };
  if (write) {
    const dir = join(root, 'docs', 'architecture');
    writeFileSync(join(dir, 'neural-diagram.svg'), svg);
    writeFileSync(join(dir, 'neural-graph.json'), `${JSON.stringify(json, null, 2)}\n`);
  }
  return { svg, json, graph };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { json } = generate();
  console.log(`neural diagram: ${json.nodes.length} neurons, ${json.edges.length} synapses, ${json.cycles.length} cycle edge(s) reported`);
  for (const c of json.cycles) console.log(`  cycle edge (ignored for layering): ${c.from} -> ${c.to}`);
}

/* Operating aids: scope options, RIT/XIT, filters, AGC/squelch/NR, memories, recording and keyboard shortcuts.
   Classic script; relies on the BHApp bridge of app.js. It has no access to PTT or the microphone. */
(() => {
  'use strict';

  const B = globalThis.BHApp;
  if (!B) return;
  const { $, app, api, view, marks, spec, hooks, msgFor, isOperator } = B;
  const NB_BEACON = 10489750000;
  const MODE_KEYS = { 'mode-usb': 'USB', 'mode-cw': 'CW', 'mode-ft8': 'FT8', 'mode-ft4': 'FT4' };
  const PREFS = 'bh-scope-prefs';
  const KEYS_PREF = 'bh-shortcuts';
  let shortcutsOn = true;
  let presets = [];
  let memoryItems = [];

  const say = (text) => { $('tools-msg').textContent = text || ''; };

  async function call(method, path, body) {
    try {
      const out = await api(method, path, body);
      say('');
      return out;
    } catch (err) {
      if (err.status !== 401) say(msgFor(err.code));
      return null;
    }
  }

  // ---- scope options (display only) ----
  function savePrefs() {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ zoom: view.zoom, avgFrames: view.avgFrames, peak: view.peak, palette: view.palette, contrast: view.contrast }));
    } catch { /* storage blocked */ }
  }

  function loadPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREFS) || '{}'); } catch { /* ignore */ }
    if (BHScope.ZOOM_LEVELS.includes(p.zoom)) view.zoom = p.zoom;
    if ([1, 4, 8, 16].includes(p.avgFrames)) view.avgFrames = p.avgFrames;
    if (typeof p.peak === 'boolean') view.peak = p.peak;
    if (Object.hasOwn(BHScope.PALETTES, p.palette)) view.palette = p.palette;
    if (Number.isInteger(p.contrast) && Math.abs(p.contrast) <= 100) view.contrast = p.contrast;
  }

  function syncScopeControls() {
    $('t-zoom').value = String(view.zoom);
    $('t-avg').value = String(view.avgFrames);
    $('t-palette').value = view.palette;
    $('t-contrast').value = String(view.contrast);
    $('t-peak').setAttribute('aria-pressed', String(view.peak));
  }

  function centerOnDial() {
    const hz = app.station.rxHz || app.station.downlinkHz;
    view.center = spec.count && hz ? (hz - NB_BEACON) / (spec.count * spec.binHz) + 0.5 : 0.5;
  }

  function setZoom(z) {
    view.zoom = z;
    centerOnDial();
    const c = $('waterfall');
    c.getContext('2d').clearRect(0, 0, c.width, c.height); // old rows were drawn at another scale
    B.rebuildScope();
    syncScopeControls();
    savePrefs();
  }

  const stepZoom = (dir) => {
    const levels = BHScope.ZOOM_LEVELS;
    const i = Math.max(0, Math.min(levels.length - 1, levels.indexOf(view.zoom) + dir));
    setZoom(levels[i]);
  };

  function scopeChanged() {
    B.rebuildScope();
    syncScopeControls();
    savePrefs();
  }

  function cycleSelect(id) {
    const s = $(id);
    if (s.disabled || s.options.length === 0) return;
    s.selectedIndex = (s.selectedIndex + 1) % s.options.length;
    s.dispatchEvent(new Event('change'));
  }

  // ---- RIT / XIT / TX lock / filter / DSP ----
  const clampHz = (v) => Math.max(-9999, Math.min(9999, v));

  async function applyStation(s) {
    if (s) B.applyStation(s);
  }

  const nudge = (key, delta) => {
    const cur = app.station[key] || 0;
    return call('POST', '/api/rit', { [key]: clampHz(cur + delta) }).then(applyStation);
  };

  function renderStationControls(s) {
    const op = isOperator();
    for (const id of ['t-rit', 't-xit', 't-clear', 't-lock', 't-filter', 't-agc', 't-squelch', 't-nr', 'r-toggle', 'm-recall', 'm-delete', 'm-name', 'm-shared']) $(id).disabled = !op;
    $('t-rit').value = String(s.ritHz || 0);
    $('t-xit').value = String(s.xitHz || 0);
    $('t-rit-val').textContent = `${s.ritHz || 0} Hz`;
    $('t-xit-val').textContent = `${s.xitHz || 0} Hz`;
    const locked = s.txFollowsRx !== false;
    $('t-lock').setAttribute('aria-pressed', String(locked));
    $('t-lock').textContent = locked ? 'TX follows RX' : 'TX split';
    if (typeof s.ownSignalOffsetHz === 'number') {
      $('t-own').textContent = s.ownSignalOffsetHz === 0
        ? 'Your own signal returns on the listening frequency.'
        : `Your own signal will be heard ${s.ownSignalOffsetHz > 0 ? '+' : ''}${s.ownSignalOffsetHz} Hz from the listening frequency.`;
    }
    if (s.filter) {
      const sel = $('t-filter');
      if (sel.dataset.mode !== s.mode) {
        sel.replaceChildren(...s.filter.available.map((n) => {
          const o = document.createElement('option');
          o.value = n;
          o.textContent = n;
          return o;
        }));
        sel.dataset.mode = s.mode;
      }
      sel.value = s.filter.name;
    }
    if (s.rxDsp) {
      $('t-agc').value = s.rxDsp.agc;
      $('t-squelch').value = s.rxDsp.squelchDb === null ? 'off' : String(s.rxDsp.squelchDb);
      $('t-nr').setAttribute('aria-pressed', String(s.rxDsp.noiseReduction === true));
    }
  }

  const toggleLock = () => call('POST', '/api/txlock', { locked: app.station.txFollowsRx === false }).then(applyStation);
  const toggleNr = () => call('POST', '/api/rxdsp', { noiseReduction: !(app.station.rxDsp && app.station.rxDsp.noiseReduction) }).then(applyStation);

  // ---- memories ----
  async function loadMemories() {
    const out = await call('GET', '/api/memories');
    if (!out) return;
    presets = out.presets;
    memoryItems = out.items;
    const sel = $('m-list');
    const opt = (value, text) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      return o;
    };
    const fmt = (hz) => (hz / 1e6).toFixed(4);
    sel.replaceChildren(
      ...presets.map((p) => opt(`p:${p.key}`, `${p.name} (${p.mode}) ${fmt(p.downlinkHz)}`)),
      ...memoryItems.map((m) => opt(`m:${m.id}`, `${m.shared ? '[shared] ' : ''}${m.name} (${m.mode}) ${fmt(m.downlinkHz)}`)),
    );
  }

  async function recallSelected() {
    const [kind, id] = $('m-list').value.split(':');
    if (kind === 'm') {
      applyStation(await call('POST', `/api/memories/${Number(id)}/recall`, {}));
    } else if (kind === 'p') {
      const p = presets.find((x) => x.key === id);
      if (!p) return;
      if (app.station.mode !== p.mode) await B.setMode(p.mode);
      await B.tune(p.downlinkHz);
    }
  }

  async function deleteSelected() {
    const [kind, id] = $('m-list').value.split(':');
    if (kind !== 'm') {
      say('Built-in presets cannot be deleted.');
      return;
    }
    if (await call('DELETE', `/api/memories/${Number(id)}`)) await loadMemories();
  }

  async function saveMemory(e) {
    e.preventDefault();
    const s = app.station;
    if (!s.downlinkHz || !s.mode) return;
    const body = { name: $('m-name').value, downlinkHz: s.downlinkHz, mode: s.mode, shared: $('m-shared').checked };
    if (s.filter && s.filter.name !== 'normal') body.filter = s.filter.name;
    if (await call('POST', '/api/memories', body)) {
      $('m-name').value = '';
      await loadMemories();
    }
  }

  // ---- recording ----
  let recTimer = null;

  async function loadRecordings() {
    const out = await call('GET', '/api/recordings');
    if (!out) return;
    const recording = Boolean(out.current);
    $('r-toggle').setAttribute('aria-pressed', String(recording));
    $('r-toggle').textContent = recording ? 'Stop recording' : 'Record RX audio';
    const pol = out.policy;
    $('r-state').textContent = !pol.enabled ? 'Recording is disabled by the owner.'
      : !pol.available ? 'No RX audio source.'
        : `Used ${(out.usedBytes / 1048576).toFixed(1)} of ${(out.maxUserBytes / 1048576).toFixed(0)} MB`;
    $('r-list').replaceChildren(...out.items.slice(0, 20).map((r) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${new Date(r.startedAt * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC, ${r.durationSec}s, ${r.mode || '-'}${r.owner ? `, ${r.callsign}` : ''}`;
      li.append(label);
      if (!r.recording) {
        const a = document.createElement('a');
        a.href = `/api/recordings/${r.id}.wav`;
        a.textContent = 'Download';
        a.setAttribute('download', '');
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn';
        del.textContent = 'Delete';
        del.addEventListener('click', async () => { if (await call('DELETE', `/api/recordings/${r.id}`)) loadRecordings(); });
        li.append(a, del);
      }
      return li;
    }));
    clearInterval(recTimer);
    recTimer = recording ? setInterval(loadRecordings, 5000) : null;
  }

  async function toggleRecording() {
    const recording = $('r-toggle').getAttribute('aria-pressed') === 'true';
    await call('POST', recording ? '/api/recordings/stop' : '/api/recordings/start', {});
    await loadRecordings();
  }

  // ---- keyboard shortcuts ----
  function isTyping(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  const ACTIONS = {
    'tune-down': () => B.tune(app.station.downlinkHz - B.snap()),
    'tune-up': () => B.tune(app.station.downlinkHz + B.snap()),
    'tune-down-fast': () => B.tune(app.station.downlinkHz - 10 * B.snap()),
    'tune-up-fast': () => B.tune(app.station.downlinkHz + 10 * B.snap()),
    'rit-down': () => nudge('ritHz', -10),
    'rit-up': () => nudge('ritHz', 10),
    'xit-down': () => nudge('xitHz', -10),
    'xit-up': () => nudge('xitHz', 10),
    'offsets-clear': () => call('POST', '/api/rit', { ritHz: 0, xitHz: 0 }).then(applyStation),
    'txlock-toggle': toggleLock,
    'filter-cycle': () => cycleSelect('t-filter'),
    'agc-cycle': () => cycleSelect('t-agc'),
    'squelch-cycle': () => cycleSelect('t-squelch'),
    'nr-toggle': toggleNr,
    'peak-toggle': () => { view.peak = !view.peak; scopeChanged(); },
    'avg-cycle': () => cycleSelect('t-avg'),
    'zoom-in': () => stepZoom(1),
    'zoom-out': () => stepZoom(-1),
    'palette-cycle': () => cycleSelect('t-palette'),
    'listen-toggle': () => B.toggleListen(),
    'record-toggle': toggleRecording,
    'memory-save': () => $('m-name').focus(),
    help: () => document.querySelector('.tab[data-view="settings"]').click(),
  };
  const OPERATOR_ONLY = new Set(['tune-down', 'tune-up', 'tune-down-fast', 'tune-up-fast', 'rit-down', 'rit-up', 'xit-down', 'xit-up', 'offsets-clear',
    'txlock-toggle', 'filter-cycle', 'agc-cycle', 'squelch-cycle', 'nr-toggle', 'record-toggle', 'memory-save']);

  function onKey(e) {
    if (!shortcutsOn || !app.me || e.code === 'Space' || isTyping(e.target)) return;
    const action = BHShortcuts.resolveShortcut(e);
    if (!action || action === 'ptt') return;
    if (app.view !== 'radio' && action !== 'help') return;
    if (OPERATOR_ONLY.has(action) && !isOperator()) return;
    if (!/^(tune|rit|xit)-/.test(action) && e.repeat) return;
    const run = MODE_KEYS[action] ? () => B.setMode(MODE_KEYS[action]) : ACTIONS[action];
    if (!run) return;
    e.preventDefault();
    run();
  }

  function buildShortcutTable() {
    const body = document.querySelector('#shortcut-table tbody');
    body.replaceChildren(...BHShortcuts.SHORTCUTS.map((s) => {
      const tr = document.createElement('tr');
      const k = document.createElement('td');
      k.textContent = s.key === ' ' ? 'Space' : s.key;
      const d = document.createElement('td');
      d.textContent = s.label;
      tr.append(k, d);
      return tr;
    }));
  }

  // ---- wiring ----
  function wire() {
    loadPrefs();
    syncScopeControls();
    B.rebuildScope();
    $('t-zoom').addEventListener('change', () => setZoom(Number($('t-zoom').value)));
    $('t-avg').addEventListener('change', () => { view.avgFrames = Number($('t-avg').value); scopeChanged(); });
    $('t-palette').addEventListener('change', () => { view.palette = $('t-palette').value; scopeChanged(); });
    $('t-contrast').addEventListener('input', () => { view.contrast = Number($('t-contrast').value); scopeChanged(); });
    $('t-peak').addEventListener('click', () => { view.peak = !view.peak; scopeChanged(); });

    $('t-rit').addEventListener('input', () => { $('t-rit-val').textContent = `${$('t-rit').value} Hz`; });
    $('t-xit').addEventListener('input', () => { $('t-xit-val').textContent = `${$('t-xit').value} Hz`; });
    $('t-rit').addEventListener('change', () => call('POST', '/api/rit', { ritHz: Number($('t-rit').value) }).then(applyStation));
    $('t-xit').addEventListener('change', () => call('POST', '/api/rit', { xitHz: Number($('t-xit').value) }).then(applyStation));
    $('t-clear').addEventListener('click', ACTIONS['offsets-clear']);
    $('t-lock').addEventListener('click', toggleLock);
    $('t-filter').addEventListener('change', () => call('POST', '/api/filter', { preset: $('t-filter').value }).then(applyStation));
    $('t-agc').addEventListener('change', () => call('POST', '/api/rxdsp', { agc: $('t-agc').value }).then(applyStation));
    $('t-squelch').addEventListener('change', () => {
      const v = $('t-squelch').value;
      call('POST', '/api/rxdsp', { squelchDb: v === 'off' ? null : Number(v) }).then(applyStation);
    });
    $('t-nr').addEventListener('click', toggleNr);

    $('m-recall').addEventListener('click', recallSelected);
    $('m-delete').addEventListener('click', deleteSelected);
    $('m-form').addEventListener('submit', saveMemory);
    $('r-toggle').addEventListener('click', toggleRecording);

    try { shortcutsOn = localStorage.getItem(KEYS_PREF) !== 'off'; } catch { /* storage blocked */ }
    $('s-keys').checked = shortcutsOn;
    $('s-keys').addEventListener('change', () => {
      shortcutsOn = $('s-keys').checked;
      try { localStorage.setItem(KEYS_PREF, shortcutsOn ? 'on' : 'off'); } catch { /* storage blocked */ }
    });
    buildShortcutTable();
    document.addEventListener('keydown', onKey);
  }

  hooks.station.push(renderStationControls);
  hooks.ready.push(async () => {
    const plan = await call('GET', '/api/bandplan');
    if (plan) {
      marks.bands = { segments: plan.segments, markers: plan.markers };
      spec.dirty = true;
    }
    await loadMemories();
    await loadRecordings();
  });
  wire();
})();

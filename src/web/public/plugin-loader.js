/* BricoHams client plugin loader. Classic script (CSP stays 'self'): plugins are same-origin ES modules served from /plugins/<name>/
   for the names the owner enabled in config. Plugins get a frozen API with read-only state, a panel, a tune request and a log prefill.
   The API has no PTT, microphone, token or raw WebSocket function. Plugins are code the owner installed, so this is a narrow
   supported surface plus defence in depth (the bridge global is removed before plugins run), not a sandbox. */
(() => {
  'use strict';

  const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
  const TOPICS = Object.freeze(['frequency', 'mode', 'beacon', 'spots', 'decodes']);
  const MAX_PANELS_PER_PLUGIN = 3;
  const MAX_TITLE = 60;

  const clone = (v) => JSON.parse(JSON.stringify(v));

  /**
   * Build the frozen API object handed to one plugin.
   * @param {object} B The BHApp bridge (or a compatible fake in tests).
   * @param {{name: string, panelHost: Element|null, createEl?: (tag: string) => Element}} ctx
   * @returns {Readonly<object>} Frozen API: `version`, `topics`, `subscribe`, `registerPanel`, `requestTune`, `prefillLog`.
   */
  function createPluginApi(B, ctx) {
    const subs = new Set();
    let panels = 0;
    let spotList = [];
    const emit = (topic, value) => {
      for (const s of subs) {
        if (s.topic !== topic) continue;
        try { s.fn(clone(value)); } catch { /* a faulty plugin must not break the page */ }
      }
    };
    let last = { frequency: null, mode: null };
    B.hooks.station.push((s) => {
      if (s.downlinkHz !== last.frequency) { last.frequency = s.downlinkHz; emit('frequency', s.downlinkHz); }
      if (s.mode !== last.mode) { last.mode = s.mode; emit('mode', s.mode); }
    });
    B.hooks.message.push((msg) => {
      if (msg.type === 'beacon') emit('beacon', { status: msg.status, offsetHz: msg.offsetHz ?? null });
      else if (msg.type === 'decode') emit('decodes', { mode: msg.mode, slotStartMs: msg.slotStartMs, messages: msg.messages });
      else if (msg.type === 'spots' && Array.isArray(msg.spots)) { spotList = msg.spots; emit('spots', spotList); }
      else if (msg.type === 'spot' && msg.spot) { spotList = [msg.spot, ...spotList.filter((p) => p.id !== msg.spot.id)].slice(0, 100); emit('spots', spotList); }
    });
    const current = (topic) => {
      if (topic === 'frequency') return B.app.station.downlinkHz ?? null;
      if (topic === 'mode') return B.app.station.mode ?? null;
      if (topic === 'beacon') return { status: B.app.beacon.status, offsetHz: B.app.beacon.offsetHz ?? null };
      if (topic === 'spots') return spotList;
      return undefined;
    };

    return Object.freeze({
      version: 1,
      topics: TOPICS,
      /** Read-only subscription; the callback gets a copy. Returns an unsubscribe function. */
      subscribe(topic, fn) {
        if (!TOPICS.includes(topic) || typeof fn !== 'function') throw new TypeError('bad subscription');
        const s = { topic, fn };
        subs.add(s);
        const v = current(topic);
        if (v !== undefined && v !== null) { try { fn(clone(v)); } catch { /* ignore */ } }
        return () => { subs.delete(s); };
      },
      /** Add a panel to the Radio tab. `render(container)` fills it with the plugin's own DOM. */
      registerPanel({ title, render }) {
        if (typeof title !== 'string' || !title || title.length > MAX_TITLE || typeof render !== 'function') throw new TypeError('bad panel');
        if (panels >= MAX_PANELS_PER_PLUGIN || !ctx.panelHost) throw new Error('panel limit');
        panels++;
        const doc = ctx.panelHost.ownerDocument;
        const sec = doc.createElement('section');
        sec.className = 'card plugin-panel';
        sec.setAttribute('data-plugin', ctx.name);
        const h = doc.createElement('h2');
        h.textContent = title;
        const body = doc.createElement('div');
        sec.append(h, body);
        ctx.panelHost.append(sec);
        render(body);
      },
      /** Ask to retune the receiver. Goes through the normal role-checked API; the server decides. */
      requestTune(hz) {
        if (!Number.isFinite(hz)) throw new TypeError('bad frequency');
        return B.tune(hz);
      },
      /** Pre-fill the new-contact form (text fields only). Nothing is saved or sent. */
      prefillLog(fields) {
        const ids = { call: 'q-call', grid: 'q-grid', comment: 'q-comment' };
        for (const [k, id] of Object.entries(ids)) {
          const v = fields && fields[k];
          if (typeof v !== 'string') continue;
          const node = B.$(id);
          if (node) node.value = v.slice(0, 200);
        }
      },
    });
  }

  /**
   * Keep only valid plugin directory names.
   * @param {unknown} list
   * @returns {string[]}
   */
  function validNames(list) {
    return Array.isArray(list) ? [...new Set(list.filter((n) => typeof n === 'string' && NAME_RE.test(n)))] : [];
  }

  globalThis.BHPluginApi = Object.freeze({ createPluginApi, validNames, TOPICS });

  const B = globalThis.BHApp;
  if (!B) return;
  // Plugins must not reach the bridge (it holds the CSRF token); this script keeps the only reference.
  delete globalThis.BHApp;

  async function loadAll() {
    let names = [];
    try {
      const res = await fetch('/api/plugins', { credentials: 'same-origin' });
      if (res.ok) names = validNames((await res.json()).enabled);
    } catch { /* no plugins */ }
    const host = document.getElementById('plugin-panels');
    for (const name of names) {
      try {
        const mod = await import(`/plugins/${name}/index.js`);
        if (mod && typeof mod.activate === 'function') mod.activate(createPluginApi(B, { name, panelHost: host }));
      } catch {
        /* a broken plugin is skipped */
      }
    }
  }

  B.hooks.ready.push(loadAll);
})();

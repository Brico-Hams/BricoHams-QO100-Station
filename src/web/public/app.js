/* BricoHams QO-100 Station PWA. Classic script (no modules, no build step, no external resources). */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const BEACON_DL = 10489750000;
  const NB_MIN = 10489500000;
  const NB_MAX = 10490000000;
  const SNAP_HZ = { USB: 100, CW: 10, FT8: 50, FT4: 50 };
  const LOG_MODE = { USB: 'SSB', CW: 'CW', FT8: 'FT8', FT4: 'FT4' };
  const KIND = { MIC: 1, RX: 2, SPECTRUM: 3 };
  const MIC_RATE = 12000;
  const BEACON_REASONS = {
    low_snr: 'weak or missing beacon',
    no_peak: 'no clear peak',
    outside_span: 'beacon outside the spectrum',
    no_data: 'no spectrum data',
    no_source: 'no spectrum source',
    bad_input: 'bad spectrum data',
    apply_failed: 'could not apply the correction',
  };
  const ERRORS = {
    tx_disabled: 'Transmit is disabled on this station.',
    forbidden: 'Your account is not allowed to transmit.',
    busy: 'Another operator holds the turn.',
    lockout: 'Station is in LOCKOUT. The owner must reset it locally.',
    no_turn: 'You do not hold the turn.',
    not_armed: 'Arm TX first.',
    audit_failed: 'Cannot key: audit log is not writable.',
    driver_error: 'The transmitter did not respond.',
    tx_active: 'Not while transmitting.',
    frequency_out_of_range: 'Outside the narrow-band transponder.',
    unknown_mode: 'Unknown mode.',
    sdrangel_unavailable: 'SDRangel is not reachable.',
  };

  const app = {
    me: null,
    csrf: null,
    ws: null,
    wsTimer: null,
    retryMs: 1000,
    caps: { rxAudio: false, spectrum: false, txAudio: false, totSeconds: 600 },
    ptt: { state: 'TX_OFF', isHolder: false, holder: null, txEnabled: false, lockoutReason: null },
    station: { mode: null, downlinkHz: null, uplinkHz: null },
    beacon: { status: 'no-lock', offsetHz: null, appliedHz: 0, reason: null },
    txStart: 0,
    totTimer: null,
    hbTimer: null,
    keyed: false,
    pttPointer: null,
    listening: false,
    view: 'radio',
    theme: 'auto',
  };
  const mic = { stream: null, ctx: null, node: null, seq: 0, opening: false };
  const rx = { ctx: null, node: null, gain: null };
  const spec = { count: 0, binHz: 0, data: null, lo: -120, hi: -40, dirty: false };

  const isOperator = () => app.me && (app.me.user.role === 'operator' || app.me.user.role === 'owner');

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const kid of kids) node.append(kid);
    return node;
  }

  function msgFor(code) {
    return ERRORS[code] || `Error: ${code}`;
  }

  // ---- theme ----
  function applyTheme() {
    let t = 'auto';
    try { t = localStorage.getItem('bh-theme') || 'auto'; } catch { /* storage blocked */ }
    if (!['auto', 'light', 'dark'].includes(t)) t = 'auto';
    app.theme = t;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    const b = $('btn-theme');
    b.textContent = `Theme: ${t}`;
    b.setAttribute('aria-label', `Colour theme: ${t}. Activate to change.`);
    scopeColors = null;
    spec.dirty = true;
  }

  function cycleTheme() {
    const next = { auto: 'light', light: 'dark', dark: 'auto' }[app.theme];
    try { localStorage.setItem('bh-theme', next); } catch { /* storage blocked */ }
    applyTheme();
  }

  // ---- HTTP ----
  class ApiError extends Error {
    constructor(status, code, data) {
      super(code);
      this.status = status;
      this.code = code;
      this.data = data;
    }
  }

  async function api(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-CSRF-Token'] = app.csrf || '';
    const res = await fetch(path, {
      method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401) {
      showLogin();
      throw new ApiError(401, 'unauthorized', data);
    }
    if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'error', data);
    return data;
  }

  // ---- views ----
  function showLogin(error) {
    $('view-login').hidden = false;
    for (const id of ['view-radio', 'view-log', 'view-settings', 'nav', 'whoami', 'btn-logout']) $(id).hidden = true;
    const e = $('login-error');
    e.hidden = !error;
    e.textContent = error || '';
    disconnect();
    $('btn-login').focus();
  }

  function showView(name) {
    app.view = name;
    for (const v of ['radio', 'log', 'settings']) $(`view-${v}`).hidden = v !== name;
    for (const t of document.querySelectorAll('.tab[data-view]')) {
      t.setAttribute('aria-pressed', String(t.dataset.view === name));
    }
    if (name === 'log') {
      fillQso();
      loadLog();
    }
    if (name === 'settings') loadQrzState();
    if (name === 'radio') spec.dirty = true;
  }

  function showApp() {
    $('view-login').hidden = true;
    $('nav').hidden = false;
    $('whoami').hidden = false;
    $('whoami').textContent = `${app.me.user.callsign} (${app.me.user.role})`;
    $('btn-logout').hidden = false;
    const listenerOnly = !isOperator();
    $('role-note').hidden = !listenerOnly;
    for (const b of document.querySelectorAll('.seg-btn')) b.disabled = listenerOnly;
    document.querySelector('.tab[data-view="log"]').hidden = listenerOnly;
    $('qrz-form').closest('.card').hidden = listenerOnly;
    showView('radio');
    connect();
    refreshStatus();
  }

  // ---- WebSocket ----
  function wsSend(msg) {
    if (app.ws && app.ws.readyState === WebSocket.OPEN) app.ws.send(JSON.stringify(msg));
  }

  function connect() {
    if (app.ws) return;
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/control`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    app.ws = ws;
    ws.onopen = () => {
      app.retryMs = 1000;
      setConn(true);
      wsSend({ type: 'subscribe', spectrum: true, rxAudio: app.listening });
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        onMessage(msg);
      } else {
        onBinary(e.data);
      }
    };
    ws.onclose = (e) => {
      app.ws = null;
      setConn(false);
      // The turn is lost with the socket; make the UI reflect it right away.
      onMessage({ type: 'state', state: 'TX_OFF', txEnabled: app.ptt.txEnabled, holder: null, isHolder: false, lockoutReason: null });
      if (e.code === 4401 || !app.me) return;
      app.wsTimer = setTimeout(connect, app.retryMs);
      app.retryMs = Math.min(10000, app.retryMs * 2);
    };
    ws.onerror = () => {};
  }

  function disconnect() {
    clearTimeout(app.wsTimer);
    if (app.ws) {
      app.ws.onclose = null;
      app.ws.close();
      app.ws = null;
    }
    setConn(false);
    closeMic();
    stopListening();
  }

  function setConn(on) {
    const c = $('conn');
    c.textContent = on ? 'online' : 'offline';
    c.classList.toggle('on', on);
  }

  function onMessage(msg) {
    switch (msg.type) {
      case 'state': updatePtt(msg); break;
      case 'beacon': app.beacon = msg; renderBeacon(); break;
      case 'caps': Object.assign(app.caps, msg); $('btn-listen').disabled = !app.caps.rxAudio; break;
      case 'result': onResult(msg); break;
      case 'error': $('ptt-msg').textContent = msgFor(msg.error); break;
      default: break;
    }
  }

  function onResult(msg) {
    if (msg.op === 'turn') {
      if (msg.ok) {
        $('ptt-msg').textContent = '';
        openMic();
      } else {
        $('ptt-msg').textContent = msgFor(msg.reason);
      }
    } else if (msg.op === 'ptt' && !msg.ok) {
      app.keyed = false;
      $('btn-ptt').classList.remove('down');
      $('ptt-msg').textContent = msgFor(msg.reason);
    }
  }

  function onBinary(buf) {
    if (buf.byteLength < 8) return;
    const view = new DataView(buf);
    const kind = view.getUint8(0);
    if (kind === KIND.SPECTRUM) onSpectrum(view, buf);
    else if (kind === KIND.RX) onRxAudio(view, buf);
  }

  // ---- PTT / turn ----
  function updatePtt(s) {
    const prev = app.ptt;
    app.ptt = {
      state: s.state, isHolder: s.isHolder === true, holder: s.holder, txEnabled: s.txEnabled, lockoutReason: s.lockoutReason,
    };
    if (s.state === 'TX_ON' && prev.state !== 'TX_ON') app.txStart = Date.now();
    if (!app.ptt.isHolder) {
      app.keyed = false;
      $('btn-ptt').classList.remove('down');
      if (prev.isHolder) closeMic();
    }
    renderPtt();
  }

  function renderPtt() {
    const p = app.ptt;
    const t = $('tx-state');
    let text = 'TX OFF';
    let cls = 'off';
    if (!p.txEnabled) text = 'TX DISABLED';
    if (p.state === 'ARMED') { text = p.isHolder ? 'ARMED' : `ARMED: ${p.holder ? p.holder.callsign : ''}`; cls = 'armed'; }
    if (p.state === 'TX_ON') { text = p.isHolder ? 'TX ON' : `TX: ${p.holder ? p.holder.callsign : ''}`; cls = 'tx'; }
    if (p.state === 'LOCKOUT') { text = 'LOCKOUT'; cls = 'lockout'; }
    if (t.textContent !== text) t.textContent = text;
    t.className = `txstate ${cls}`;

    $('turn').textContent = p.holder
      ? (p.isHolder ? 'You hold the turn' : `Operating: ${p.holder.callsign}`)
      : 'Turn: free';

    const arm = $('btn-arm');
    arm.textContent = p.isHolder ? 'Disarm' : 'Arm TX';
    arm.setAttribute('aria-pressed', String(p.isHolder));
    arm.disabled = !isOperator() || !p.txEnabled || p.state === 'LOCKOUT' || (p.holder !== null && !p.isHolder);

    const ptt = $('btn-ptt');
    const canKey = p.isHolder && (p.state === 'ARMED' || p.state === 'TX_ON') && mic.node !== null;
    ptt.disabled = !canKey;
    ptt.setAttribute('aria-disabled', String(!canKey));

    clearInterval(app.hbTimer);
    app.hbTimer = null;
    if (p.isHolder) app.hbTimer = setInterval(() => wsSend({ type: 'heartbeat' }), 500);

    clearInterval(app.totTimer);
    app.totTimer = null;
    const tot = $('tot');
    if (p.state === 'TX_ON' && p.isHolder) {
      const tick = () => {
        const left = Math.max(0, app.caps.totSeconds - Math.floor((Date.now() - app.txStart) / 1000));
        tot.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
      };
      tick();
      app.totTimer = setInterval(tick, 250);
    } else {
      tot.textContent = '';
    }
  }

  function toggleArm() {
    if (app.ptt.isHolder) {
      keyUp();
      wsSend({ type: 'release' });
      closeMic();
    } else {
      wsSend({ type: 'turn' });
    }
  }

  function keyDown() {
    const p = app.ptt;
    if (app.keyed || !p.isHolder || (p.state !== 'ARMED' && p.state !== 'TX_ON') || !mic.node) return;
    app.keyed = true;
    $('btn-ptt').classList.add('down');
    wsSend({ type: 'ptt', down: true });
  }

  function keyUp() {
    if (!app.keyed) return;
    app.keyed = false;
    $('btn-ptt').classList.remove('down');
    wsSend({ type: 'ptt', down: false });
  }

  // ---- microphone ----
  // The microphone is opened only after the server granted the turn (the user armed TX) and released when the turn ends.
  async function openMic() {
    if (mic.stream || mic.opening) return;
    mic.opening = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: false },
      });
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      await ctx.audioWorklet.addModule('/mic-capture.js');
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'mic-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);
      node.port.onmessage = (e) => onMicFrame(e.data);
      mic.stream = stream;
      mic.ctx = ctx;
      mic.node = node;
      if (!app.ptt.isHolder) {
        closeMic();
        return;
      }
      node.port.postMessage({ type: 'active', on: true });
      renderPtt();
    } catch (err) {
      $('ptt-msg').textContent = 'Microphone not available. Allow access, and use HTTPS.';
      closeMic();
      wsSend({ type: 'release' });
    } finally {
      mic.opening = false;
    }
  }

  function closeMic() {
    keyUp();
    if (mic.node) {
      mic.node.port.postMessage({ type: 'active', on: false });
      mic.node.port.onmessage = null;
      mic.node.disconnect();
    }
    if (mic.stream) for (const t of mic.stream.getTracks()) t.stop();
    if (mic.ctx) mic.ctx.close().catch(() => {});
    mic.stream = null;
    mic.ctx = null;
    mic.node = null;
    $('mic-level').style.width = '0%';
    renderPtt();
  }

  function onMicFrame(m) {
    if (!m || !m.pcm) return;
    $('mic-level').style.width = `${Math.min(100, Math.round(m.peak * 100))}%`;
    const ws = app.ws;
    // Only audio spoken while the server is actually transmitting is sent, and never faster than the socket drains.
    if (!ws || ws.readyState !== WebSocket.OPEN || app.ptt.state !== 'TX_ON' || !app.ptt.isHolder || ws.bufferedAmount > 32768) return;
    const pcm = new Uint8Array(m.pcm);
    const out = new ArrayBuffer(8 + pcm.length);
    const view = new DataView(out);
    view.setUint8(0, KIND.MIC);
    view.setUint8(1, 0);
    view.setUint16(2, mic.seq++ & 0xffff, true);
    view.setUint32(4, MIC_RATE, true);
    new Uint8Array(out, 8).set(pcm);
    ws.send(out);
  }

  // ---- RX audio ----
  async function startListening() {
    if (rx.ctx) return;
    let ctx;
    try {
      ctx = new AudioContext({ sampleRate: MIC_RATE, latencyHint: 'interactive' });
    } catch {
      ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    try {
      await ctx.audioWorklet.addModule('/rx-player.js');
    } catch {
      ctx.close().catch(() => {});
      $('ptt-msg').textContent = 'Audio is not available in this browser.';
      return;
    }
    const node = new AudioWorkletNode(ctx, 'rx-player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    const gain = ctx.createGain();
    gain.gain.value = Number($('volume').value) / 100;
    node.connect(gain);
    gain.connect(ctx.destination);
    await ctx.resume();
    rx.ctx = ctx;
    rx.node = node;
    rx.gain = gain;
    app.listening = true;
    $('btn-listen').setAttribute('aria-pressed', 'true');
    $('btn-listen').textContent = 'Stop listening';
    wsSend({ type: 'subscribe', rxAudio: true });
  }

  function stopListening() {
    if (!rx.ctx) return;
    wsSend({ type: 'subscribe', rxAudio: false });
    rx.ctx.close().catch(() => {});
    rx.ctx = null;
    rx.node = null;
    rx.gain = null;
    app.listening = false;
    $('btn-listen').setAttribute('aria-pressed', 'false');
    $('btn-listen').textContent = 'Listen';
  }

  function onRxAudio(view, buf) {
    if (!rx.node || view.getUint32(4, true) !== MIC_RATE || (buf.byteLength - 8) % 2 !== 0) return;
    const pcm = new Int16Array(buf.slice(8));
    rx.node.port.postMessage({ pcm }, [pcm.buffer]);
  }

  // ---- spectrum and waterfall ----
  let scopeColors = null;
  const lut = (() => {
    const stops = [[0, 0, 0, 24], [0.25, 0, 40, 170], [0.5, 0, 200, 220], [0.75, 255, 220, 0], [1, 255, 40, 20]];
    const out = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let k = 0;
      while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
      const [t0, r0, g0, b0] = stops[k];
      const [t1, r1, g1, b1] = stops[k + 1];
      const f = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
      out[i * 3] = r0 + (r1 - r0) * f;
      out[i * 3 + 1] = g0 + (g1 - g0) * f;
      out[i * 3 + 2] = b0 + (b1 - b0) * f;
    }
    return out;
  })();

  function colors() {
    if (!scopeColors) {
      const cs = getComputedStyle(document.documentElement);
      const get = (n) => cs.getPropertyValue(n).trim() || '#888';
      scopeColors = {
        bg: get('--scope-bg'), grid: get('--scope-grid'), trace: get('--scope-trace'), mark: get('--scope-mark'), text: '#c9d4de', tx: get('--tx'),
      };
    }
    return scopeColors;
  }

  function onSpectrum(view, buf) {
    if (buf.byteLength < 18) return;
    const count = view.getUint16(16, true);
    if (count === 0 || buf.byteLength !== 18 + count) return;
    spec.binHz = view.getFloat32(12, true);
    spec.count = count;
    spec.data = new Uint8Array(buf.slice(18));
    // Adaptive display range: floor from the median, ceiling from the peak, smoothed so it does not flicker.
    const sorted = Array.from(spec.data).sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1] / 2 - 140;
    const peak = sorted[sorted.length - 1] / 2 - 140;
    const lo = med - 6;
    const hi = Math.max(peak + 4, lo + 30);
    spec.lo += (lo - spec.lo) * 0.1;
    spec.hi += (hi - spec.hi) * 0.1;
    pushWaterfall();
    spec.dirty = true;
  }

  const spectrumCanvas = () => $('spectrum');
  const dbOf = (v) => v / 2 - 140;

  function span() {
    return spec.count * spec.binHz;
  }

  function freqAtFraction(f) {
    return BEACON_DL + (f - 0.5) * span();
  }

  function fractionOfFreq(hz) {
    return (hz - BEACON_DL) / span() + 0.5;
  }

  function pushWaterfall() {
    if (!spec.data || app.view !== 'radio') return;
    const c = $('waterfall');
    const ctx = c.getContext('2d');
    const w = c.width;
    const h = c.height;
    ctx.drawImage(c, 0, 0, w, h - 1, 0, 1, w, h - 1);
    const row = ctx.createImageData(w, 1);
    const range = Math.max(10, spec.hi - spec.lo);
    for (let x = 0; x < w; x++) {
      const bin = Math.min(spec.count - 1, Math.floor((x * spec.count) / w));
      const t = Math.max(0, Math.min(1, (dbOf(spec.data[bin]) - spec.lo) / range));
      const i = Math.round(t * 255) * 3;
      row.data[x * 4] = lut[i];
      row.data[x * 4 + 1] = lut[i + 1];
      row.data[x * 4 + 2] = lut[i + 2];
      row.data[x * 4 + 3] = 255;
    }
    ctx.putImageData(row, 0, 0);
  }

  function drawSpectrum() {
    const c = spectrumCanvas();
    const ctx = c.getContext('2d');
    const w = c.width;
    const h = c.height;
    const col = colors();
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, w, h);
    if (!spec.data || span() <= 0) {
      ctx.fillStyle = col.text;
      ctx.font = '16px system-ui, sans-serif';
      ctx.fillText('Waiting for spectrum...', 16, 28);
      return;
    }
    const sp = span();
    // Frequency grid with a step that gives about 6 to 12 labels.
    const steps = [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000];
    const step = steps.find((s) => sp / s <= 12) || steps[steps.length - 1];
    ctx.strokeStyle = col.grid;
    ctx.fillStyle = col.text;
    ctx.font = '13px ui-monospace, Consolas, monospace';
    ctx.lineWidth = 1;
    const f0 = freqAtFraction(0);
    for (let f = Math.ceil(f0 / step) * step; f < freqAtFraction(1); f += step) {
      const x = Math.round(fractionOfFreq(f) * w) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h - 18);
      ctx.stroke();
      ctx.fillText((f / 1e6).toFixed(3), x + 3, h - 4);
    }
    const range = Math.max(10, spec.hi - spec.lo);
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const bin = Math.min(spec.count - 1, Math.floor((x * spec.count) / w));
      const y = (h - 20) * (1 - Math.max(0, Math.min(1, (dbOf(spec.data[bin]) - spec.lo) / range))) + 2;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = col.trace;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const mark = (hz, color, dash) => {
      const f = fractionOfFreq(hz);
      if (f < 0 || f > 1) return;
      const x = Math.round(f * w) + 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h - 18);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    mark(BEACON_DL, col.grid, [4, 4]);
    if (app.station.downlinkHz) mark(app.station.downlinkHz, app.ptt.state === 'TX_ON' ? col.tx : col.mark, []);
  }

  function frame() {
    if (spec.dirty && app.view === 'radio') {
      spec.dirty = false;
      drawSpectrum();
    }
    requestAnimationFrame(frame);
  }

  // ---- tuning ----
  const snap = () => SNAP_HZ[app.station.mode || 'USB'];
  let tuning = false;
  let pendingTune = null;

  function renderFreq() {
    const s = app.station;
    $('f-down').textContent = s.downlinkHz ? (s.downlinkHz / 1e6).toFixed(6) : '-';
    $('f-up').textContent = s.uplinkHz ? (s.uplinkHz / 1e6).toFixed(6) : '-';
    for (const b of document.querySelectorAll('.seg-btn')) b.setAttribute('aria-pressed', String(b.dataset.mode === s.mode));
    $('step-info').textContent = `Step ${snap()} Hz`;
    if (s.downlinkHz) spectrumCanvas().setAttribute('aria-valuenow', String(s.downlinkHz));
    spec.dirty = true;
  }

  async function tune(hz) {
    if (!isOperator()) {
      $('ptt-msg').textContent = 'Your account can listen only.';
      return;
    }
    const target = Math.max(NB_MIN, Math.min(NB_MAX - 1, Math.round(hz / snap()) * snap()));
    app.station.downlinkHz = target;
    app.station.uplinkHz = target - 8089500000;
    renderFreq();
    pendingTune = target;
    if (tuning) return;
    tuning = true;
    try {
      while (pendingTune !== null) {
        const t = pendingTune;
        pendingTune = null;
        try {
          app.station = await api('POST', '/api/tune', { downlinkHz: t });
        } catch (err) {
          if (err.status === 401) return;
          $('ptt-msg').textContent = msgFor(err.code);
          await refreshStatus();
          break;
        }
      }
    } finally {
      tuning = false;
      renderFreq();
    }
  }

  async function setMode(mode) {
    try {
      app.station = await api('POST', '/api/mode', { mode });
      $('ptt-msg').textContent = '';
    } catch (err) {
      if (err.status !== 401) $('ptt-msg').textContent = msgFor(err.code);
    }
    renderFreq();
  }

  async function refreshStatus() {
    if (!app.me || tuning) return;
    try {
      const s = await api('GET', '/api/status');
      app.station = s.station;
      app.beacon = s.beacon;
      renderFreq();
      renderBeacon();
    } catch { /* shown by the connection pill */ }
  }

  function renderBeacon() {
    const b = app.beacon;
    const locked = b.status === 'locked';
    const box = $('beacon');
    box.className = `beacon ${locked ? 'locked' : 'off'}`;
    const off = typeof b.offsetHz === 'number' ? `${b.offsetHz >= 0 ? '+' : ''}${b.offsetHz.toFixed(1)} Hz` : '';
    $('beacon-text').textContent = locked
      ? `locked, offset ${off}`
      : `no lock${b.reason ? `: ${BEACON_REASONS[b.reason] || b.reason}` : ''}`;
  }

  function onSpectrumPointer(e) {
    if (!spec.data) return;
    const r = spectrumCanvas().getBoundingClientRect();
    tune(freqAtFraction((e.clientX - r.left) / r.width));
  }

  function onSpectrumKey(e) {
    const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!dir || !app.station.downlinkHz) return;
    e.preventDefault();
    tune(app.station.downlinkHz + dir * snap() * (e.shiftKey ? 10 : 1));
  }

  // ---- log ----
  const FIELD_IDS = {
    call: 'q-call', mode: 'q-mode', qso_date: 'q-date', time_on: 'q-time', freq: 'q-freq', freq_rx: 'q-freq-rx',
    rst_sent: 'q-rst-s', rst_rcvd: 'q-rst-r', gridsquare: 'q-grid', comment: 'q-comment',
  };

  function fillQso() {
    const now = new Date().toISOString();
    $('q-date').value = now.slice(0, 10);
    $('q-time').value = now.slice(11, 19);
    const s = app.station;
    if (s.uplinkHz) $('q-freq').value = (s.uplinkHz / 1e6).toFixed(6);
    if (s.downlinkHz) $('q-freq-rx').value = (s.downlinkHz / 1e6).toFixed(6);
    const mode = LOG_MODE[s.mode] || 'SSB';
    $('q-mode').value = mode;
    const rst = mode === 'SSB' ? '59' : mode === 'CW' ? '599' : '-10';
    $('q-rst-s').value = rst;
    $('q-rst-r').value = rst;
  }

  function qsoPayload() {
    const v = (id) => $(id).value.trim();
    return {
      call: v('q-call').toUpperCase(),
      mode: v('q-mode'),
      qso_date: v('q-date').replaceAll('-', ''),
      time_on: v('q-time').replaceAll(':', ''),
      freq: v('q-freq'),
      freq_rx: v('q-freq-rx'),
      rst_sent: v('q-rst-s'),
      rst_rcvd: v('q-rst-r'),
      gridsquare: v('q-grid'),
      comment: v('q-comment'),
    };
  }

  async function submitQso(e) {
    e.preventDefault();
    const msg = $('q-msg');
    for (const id of Object.values(FIELD_IDS)) $(id).removeAttribute('aria-invalid');
    const payload = qsoPayload();
    try {
      let q;
      try {
        q = await api('POST', '/api/log', payload);
      } catch (err) {
        if (err.code === 'duplicate' && window.confirm('This call and mode was logged in the last 10 minutes. Log it anyway?')) {
          q = await api('POST', '/api/log', { ...payload, force: true });
        } else {
          throw err;
        }
      }
      msg.textContent = `Logged ${q.call}.`;
      for (const id of ['q-call', 'q-grid', 'q-comment']) $(id).value = '';
      fillQso();
      $('q-call').focus();
      loadLog();
    } catch (err) {
      if (err.code === 'validation' && err.data && err.data.fields) {
        const names = Object.entries(err.data.fields).map(([k, v]) => `${k}: ${v}`);
        for (const k of Object.keys(err.data.fields)) if (FIELD_IDS[k]) $(FIELD_IDS[k]).setAttribute('aria-invalid', 'true');
        msg.textContent = `Check: ${names.join(', ')}`;
      } else if (err.code === 'duplicate') {
        msg.textContent = 'Duplicate contact, not logged.';
      } else if (err.status !== 401) {
        msg.textContent = `Could not log: ${err.code}`;
      }
    }
  }

  async function loadLog() {
    try {
      const out = await api('GET', '/api/log?limit=50');
      const body = $('log-body');
      body.replaceChildren();
      for (const q of out.items) {
        const cb = el('input', { type: 'checkbox', 'data-id': String(q.id), 'aria-label': `Select ${q.call}` });
        const t = `${q.qso_date.slice(0, 4)}-${q.qso_date.slice(4, 6)}-${q.qso_date.slice(6, 8)} ${q.time_on.slice(0, 2)}:${q.time_on.slice(2, 4)}`;
        body.append(el('tr', {},
          el('td', {}, cb),
          el('td', { text: q.call }),
          el('td', { text: t }),
          el('td', { text: q.mode }),
          el('td', { class: 'mono', text: Number(q.freq_rx).toFixed(6) }),
          el('td', { text: `${q.rst_sent}/${q.rst_rcvd}` }),
          el('td', { text: q.lotw_status }),
          el('td', { text: q.qrz_status })));
      }
      $('log-msg').textContent = `${out.total} contact${out.total === 1 ? '' : 's'}`;
    } catch (err) {
      if (err.status !== 401) $('log-msg').textContent = `Could not load the log: ${err.code}`;
    }
  }

  function selectedIds() {
    return Array.from(document.querySelectorAll('#log-body input[type="checkbox"]:checked')).map((c) => Number(c.dataset.id));
  }

  async function upload(kind) {
    const ids = selectedIds();
    const msg = $('log-msg');
    if (ids.length === 0) {
      msg.textContent = 'Tick the contacts to upload first.';
      return;
    }
    msg.textContent = 'Uploading...';
    try {
      if (kind === 'lotw') {
        const r = await api('POST', '/api/log/lotw', { ids });
        msg.textContent = `LoTW: ${r.message || r.status}`;
      } else {
        const r = await api('POST', '/api/log/qrz', { ids });
        const counts = {};
        for (const x of r.results) counts[x.status] = (counts[x.status] || 0) + 1;
        msg.textContent = `QRZ: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}`;
      }
      loadLog();
    } catch (err) {
      const text = {
        lotw_not_configured: 'LoTW upload is not configured on this station.',
        qrz_key_missing: 'Save your QRZ key in Settings first.',
        lotw_busy: 'Another LoTW upload is running.',
      }[err.code];
      if (err.status !== 401) msg.textContent = text || `Upload failed: ${err.code}`;
    }
  }

  // ---- settings ----
  async function loadQrzState() {
    if (!isOperator()) return;
    const s = $('s-qrz-state');
    try {
      const r = await api('GET', '/api/log/qrz-key');
      s.textContent = !r.canStore ? 'This station cannot store keys (no secrets key configured).' : r.hasKey ? 'A key is stored.' : 'No key stored.';
    } catch (err) {
      if (err.status !== 401) s.textContent = '';
    }
  }

  async function saveQrz(e) {
    e.preventDefault();
    const input = $('s-qrz');
    const apiKey = input.value.trim();
    if (apiKey.length < 8) {
      $('s-qrz-state').textContent = 'The key looks too short.';
      return;
    }
    try {
      await api('PUT', '/api/log/qrz-key', { apiKey });
      input.value = '';
      await loadQrzState();
    } catch (err) {
      input.value = '';
      if (err.status !== 401) $('s-qrz-state').textContent = err.code === 'secrets_unavailable' ? 'This station cannot store keys.' : 'The key was rejected (check the format).';
    }
  }

  async function deleteQrz() {
    try {
      await api('DELETE', '/api/log/qrz-key');
      await loadQrzState();
    } catch { /* state text is refreshed by the next load */ }
  }

  // ---- global events ----
  function isTextField(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  function wire() {
    $('btn-theme').addEventListener('click', cycleTheme);
    $('btn-logout').addEventListener('click', async () => {
      try { await api('POST', '/auth/logout', {}); } catch { /* ignore */ }
      location.reload();
    });
    for (const t of document.querySelectorAll('.tab[data-view]')) t.addEventListener('click', () => showView(t.dataset.view));
    for (const b of document.querySelectorAll('.seg-btn')) b.addEventListener('click', () => setMode(b.dataset.mode));

    const sc = spectrumCanvas();
    sc.addEventListener('click', onSpectrumPointer);
    sc.addEventListener('keydown', onSpectrumKey);

    $('btn-listen').addEventListener('click', () => (rx.ctx ? stopListening() : startListening()));
    $('volume').addEventListener('input', () => { if (rx.gain) rx.gain.gain.value = Number($('volume').value) / 100; });

    $('btn-arm').addEventListener('click', toggleArm);
    const ptt = $('btn-ptt');
    ptt.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      app.pttPointer = e.pointerId;
      try { ptt.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      keyDown();
    });
    const release = (e) => {
      if (app.pttPointer === e.pointerId) {
        app.pttPointer = null;
        keyUp();
      }
    };
    ptt.addEventListener('pointerup', release);
    ptt.addEventListener('pointercancel', release);
    ptt.addEventListener('lostpointercapture', release);
    ptt.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || app.view !== 'radio' || !app.me || isTextField(e.target)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (!app.ptt.isHolder) {
        $('ptt-msg').textContent = 'Arm TX first (button), then hold Space to transmit.';
        return;
      }
      keyDown();
    });
    document.addEventListener('keyup', (e) => {
      if (e.code !== 'Space' || isTextField(e.target)) return;
      e.preventDefault();
      keyUp();
    });
    // Losing focus or the page must never leave the carrier on.
    window.addEventListener('blur', keyUp);
    document.addEventListener('visibilitychange', () => { if (document.hidden) keyUp(); });
    window.addEventListener('pagehide', () => { keyUp(); closeMic(); });

    $('qso-form').addEventListener('submit', submitQso);
    $('q-now').addEventListener('click', fillQso);
    $('btn-lotw').addEventListener('click', () => upload('lotw'));
    $('btn-qrz').addEventListener('click', () => upload('qrz'));
    $('qrz-form').addEventListener('submit', saveQrz);
    $('s-qrz-del').addEventListener('click', deleteQrz);
  }

  async function boot() {
    applyTheme();
    wire();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    requestAnimationFrame(frame);
    try {
      app.me = await api('GET', '/api/me');
      app.csrf = app.me.csrfToken;
    } catch (err) {
      if (err.status !== 401) showLogin('Cannot reach the station. Try again in a moment.');
      else showLogin();
      return;
    }
    showApp();
    setInterval(refreshStatus, 3000);
  }

  boot();
})();

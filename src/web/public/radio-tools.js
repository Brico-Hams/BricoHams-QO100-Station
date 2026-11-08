/* BricoHams radio extras: notch / auto-notch, DX spots, activity calendar, memory import/export and I/Q recording.
   Classic script; relies on the BHApp bridge of app.js. No PTT, microphone or transmit function is reachable from here:
   clicking a spot or a calendar entry only retunes the receiver (role-checked on the server). */
(() => {
  'use strict';

  const B = globalThis.BHApp;
  if (!B) return;
  const { $, app, api, hooks, msgFor, isOperator } = B;
  const SPOT_PICK_HZ = 400; // a click this close to a spot marker tunes to the spot
  const MAX_UPLOAD_CHARS = 250_000;
  let spots = [];
  let pickNotch = false;
  let notchBusy = false;

  const text = (tag, value, cls) => {
    const n = document.createElement(tag);
    n.textContent = value;
    if (cls) n.className = cls;
    return n;
  };
  const say = (id, msg) => { $(id).textContent = msg || ''; };

  async function call(method, path, body, msgId = 'x-msg') {
    try {
      const out = await api(method, path, body);
      say(msgId, '');
      return out;
    } catch (err) {
      if (err.status !== 401) say(msgId, msgFor(err.code));
      return null;
    }
  }

  // ---- notch ----
  function renderNotch(s) {
    const n = s.notch;
    if (!n) return;
    const op = isOperator();
    for (const id of ['n-toggle', 'n-auto', 'n-freq', 'n-width', 'n-pick']) $(id).disabled = !op;
    $('n-toggle').setAttribute('aria-pressed', String(n.enabled));
    $('n-auto').setAttribute('aria-pressed', String(n.auto));
    if (document.activeElement !== $('n-freq')) $('n-freq').value = String(n.offsetHz);
    if (document.activeElement !== $('n-width')) $('n-width').value = String(n.widthHz);
    $('n-engine').textContent = n.engine === 'sdrangel' ? 'Notch runs in SDRangel.' : 'Notch runs in your browser audio.';
    // With the SDRangel engine the demodulator already filters; applying it again here would notch twice.
    B.setRxNotch(n.engine === 'client' ? { enabled: n.enabled, auto: n.auto, freq: n.offsetHz, width: n.widthHz } : { enabled: false });
  }

  async function sendNotch(patch) {
    if (notchBusy) return;
    notchBusy = true;
    try {
      const s = await call('POST', '/api/notch', patch, 'n-msg');
      if (s) B.applyStation(s);
    } finally {
      notchBusy = false;
    }
  }

  const toggleNotch = () => sendNotch({ enabled: !(app.station.notch && app.station.notch.enabled) });
  const toggleAuto = () => sendNotch({ auto: !(app.station.notch && app.station.notch.auto), enabled: true });

  function setPick(on) {
    pickNotch = on && isOperator();
    $('n-pick').setAttribute('aria-pressed', String(pickNotch));
    say('n-msg', pickNotch ? 'Click a carrier on the spectrum to notch it.' : '');
  }

  function onPick(hz) {
    const rxHz = app.station.rxHz || app.station.downlinkHz;
    if (pickNotch && rxHz) {
      setPick(false);
      const offset = Math.round(hz - rxHz);
      if (offset < 20 || offset > 5900) say('n-msg', 'That carrier is outside the audio passband (20 to 5900 Hz above the dial).');
      else sendNotch({ offsetHz: offset, enabled: true, auto: false });
      return true;
    }
    const near = spots.find((p) => Math.abs(p.downlinkHz - hz) <= SPOT_PICK_HZ);
    if (near) {
      B.tune(near.downlinkHz);
      return true;
    }
    return false;
  }

  // ---- spots ----
  function renderSpots() {
    const list = $('spot-list');
    list.replaceChildren(...spots.slice(0, 50).map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'decode-row';
      b.append(text('span', (p.downlinkHz / 1e6).toFixed(4), 'mono dt'), text('span', p.dx, 'dm'), text('span', p.comment || '', 'hint ddetail'));
      b.addEventListener('click', () => B.tune(p.downlinkHz)); // tune RX only, never TX
      const li = document.createElement('li');
      li.append(b);
      return li;
    }));
    $('spot-empty').hidden = spots.length > 0;
    B.spec.dirty = true;
  }

  function drawSpots(ctx, w, h, col) {
    if (!spots.length) return;
    ctx.fillStyle = col.mark;
    ctx.font = '11px ui-monospace, Consolas, monospace';
    for (const p of spots) {
      const f = B.fractionOfFreq(p.downlinkHz);
      if (f < 0 || f > 1) continue;
      const x = Math.round(f * w);
      ctx.beginPath();
      ctx.moveTo(x - 4, 0);
      ctx.lineTo(x + 4, 0);
      ctx.lineTo(x, 8);
      ctx.fill();
      ctx.fillText(p.dx, Math.min(x + 4, w - 70), 20);
    }
  }

  function onMessage(msg) {
    if (msg.type === 'spots' && Array.isArray(msg.spots)) spots = msg.spots.filter(validSpot);
    else if (msg.type === 'spot' && validSpot(msg.spot)) spots = [msg.spot, ...spots.filter((p) => p.id !== msg.spot.id)].slice(0, 100);
    else return;
    renderSpots();
  }

  const validSpot = (p) => p && typeof p.dx === 'string' && Number.isFinite(p.downlinkHz);

  async function loadSpotInfo() {
    const out = await call('GET', '/api/spots', undefined, 'spot-msg');
    if (!out) return;
    spots = out.items.filter(validSpot);
    $('spot-state').textContent = out.enabled ? `DX cluster: ${out.status && out.status.state === 'online' ? 'connected' : 'not connected'}` : 'DX cluster is disabled by the owner.';
    $('spot-form').hidden = !(out.canPost && isOperator());
    renderSpots();
  }

  async function postSpot(e) {
    e.preventDefault();
    const hz = app.station.downlinkHz;
    if (!hz) return;
    if (await call('POST', '/api/spots', { dx: $('spot-call').value.trim().toUpperCase(), downlinkHz: hz, comment: $('spot-comment').value }, 'spot-msg')) {
      $('spot-call').value = '';
      $('spot-comment').value = '';
    }
  }

  // ---- calendar ----
  async function loadCalendar() {
    const out = await call('GET', '/api/calendar', undefined, 'cal-msg');
    if (!out) return;
    const owner = app.me.user.role === 'owner';
    $('cal-owner').hidden = !owner;
    $('cal-state').textContent = out.error ? `Last update failed: ${out.error}` : out.enabled || out.events ? `${out.events} activities` : 'Calendar import is disabled by the owner.';
    $('cal-list').replaceChildren(...out.items.slice(0, 20).map((ev) => {
      const li = document.createElement('li');
      const when = new Date(ev.start).toISOString().replace('T', ' ').slice(0, 16);
      li.append(text('span', `${when}${ev.allDay ? '' : ' UTC'}`, 'mono'), document.createTextNode(` ${ev.summary}`));
      if (ev.url && /^https?:\/\//.test(ev.url)) {
        const a = text('a', ' more', 'hint');
        a.href = ev.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        li.append(a);
      }
      return li;
    }));
  }

  async function refreshCalendar() {
    if (await call('POST', '/api/calendar/refresh', {}, 'cal-msg')) await loadCalendar();
  }

  async function uploadCalendar() {
    const f = $('cal-file').files[0];
    if (!f) return;
    if (f.size > MAX_UPLOAD_CHARS) return say('cal-msg', 'File too large.');
    if (await call('POST', '/api/calendar/upload', { content: await f.text() }, 'cal-msg')) await loadCalendar();
    $('cal-file').value = '';
  }

  // ---- memories import / export ----
  async function importMemories(dryRun) {
    const f = $('mi-file').files[0];
    if (!f) return say('mi-msg', 'Choose a file first.');
    if (f.size > MAX_UPLOAD_CHARS) return say('mi-msg', 'File too large.');
    const out = await call('POST', '/api/memories/import', { format: $('mi-format').value, content: await f.text(), dryRun }, 'mi-msg');
    if (!out) return;
    const bad = out.invalid.length ? `, ${out.invalid.length} invalid rows (first: row ${out.invalid[0].row})` : '';
    say('mi-msg', `${out.dryRun ? 'Preview: would import' : 'Imported'} ${out.imported} of ${out.total}, ${out.duplicates} duplicates${bad}.`);
    if (!dryRun) {
      $('mi-file').value = '';
      document.dispatchEvent(new CustomEvent('bh-memories-changed'));
    }
  }

  // ---- I/Q recording ----
  let iqTimer = null;

  async function loadIq() {
    if (!isOperator()) return;
    let out;
    try {
      out = await api('GET', '/api/iq');
    } catch (err) {
      if (err.status === 401) return;
      say('iq-msg', msgFor(err.code));
      return;
    }
    say('iq-msg', '');
    const pol = out.policy;
    const recording = Boolean(out.current);
    $('iq-toggle').disabled = !pol.enabled || Boolean(pol.playing);
    $('iq-toggle').setAttribute('aria-pressed', String(recording));
    $('iq-toggle').textContent = recording ? 'Stop I/Q recording' : 'Record I/Q';
    $('iq-live').hidden = !pol.playing;
    $('iq-state').textContent = !pol.enabled ? 'I/Q recording is disabled by the owner.'
      : pol.playing ? 'Playing a recording instead of the live receiver.'
        : `Used ${(out.usedBytes / 1048576).toFixed(0)} of ${pol.maxUserMb} MB`;
    $('iq-list').replaceChildren(...out.items.slice(0, 20).map((r) => {
      const li = document.createElement('li');
      li.append(text('span', `${new Date(r.startedAt * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC, ${(r.bytes / 1048576).toFixed(1)} MB${r.callsign ? `, ${r.callsign}` : ''}`));
      if (!r.recording) {
        const play = text('button', 'Play', 'btn');
        play.type = 'button';
        play.addEventListener('click', async () => { if (await call('POST', `/api/iq/${r.id}/playback`, {}, 'iq-msg')) loadIq(); });
        const del = text('button', 'Delete', 'btn');
        del.type = 'button';
        del.addEventListener('click', async () => { if (await call('DELETE', `/api/iq/${r.id}`, undefined, 'iq-msg')) loadIq(); });
        li.append(play, del);
      }
      return li;
    }));
    clearInterval(iqTimer);
    iqTimer = recording ? setInterval(loadIq, 5000) : null;
  }

  async function toggleIq() {
    const recording = $('iq-toggle').getAttribute('aria-pressed') === 'true';
    await call('POST', recording ? '/api/iq/stop' : '/api/iq/start', {}, 'iq-msg');
    await loadIq();
  }

  async function iqLive() {
    if (await call('POST', '/api/iq/live', {}, 'iq-msg')) {
      await B.refreshStatus();
      await loadIq();
    }
  }

  function wire() {
    $('n-toggle').addEventListener('click', toggleNotch);
    $('n-auto').addEventListener('click', toggleAuto);
    $('n-pick').addEventListener('click', () => setPick(!pickNotch));
    $('n-freq').addEventListener('change', () => sendNotch({ offsetHz: Number($('n-freq').value) }));
    $('n-width').addEventListener('change', () => sendNotch({ widthHz: Number($('n-width').value) }));
    $('spot-form').addEventListener('submit', postSpot);
    $('cal-refresh').addEventListener('click', refreshCalendar);
    $('cal-file').addEventListener('change', uploadCalendar);
    $('mi-preview').addEventListener('click', () => importMemories(true));
    $('mi-import').addEventListener('click', () => importMemories(false));
    $('mi-export-json').href = '/api/memories/export?format=json';
    $('mi-export-csv').href = '/api/memories/export?format=csv';
    $('iq-toggle').addEventListener('click', toggleIq);
    $('iq-live').addEventListener('click', iqLive);
  }

  hooks.station.push(renderNotch);
  hooks.message.push(onMessage);
  hooks.draw.push(drawSpots);
  hooks.pick.push(onPick);
  hooks.ready.push(async () => {
    const op = isOperator();
    for (const id of ['mi-file', 'mi-format', 'mi-preview', 'mi-import']) $(id).disabled = !op;
    $('iq-panel').hidden = !op;
    await Promise.all([loadSpotInfo(), loadCalendar(), loadIq()]);
  });
  wire();

  globalThis.BHRadioTools = Object.freeze({ toggleNotch, toggleAuto });
})();

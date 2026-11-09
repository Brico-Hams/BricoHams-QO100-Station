import assert from 'node:assert/strict';
import { Ptt } from '../../src/ptt/index.js';
import { FakeClock, FakeDriver, silentLogger } from '../fixtures/fakes.js';
import { prng } from '../fixtures/dsp.js';
import { percentile, record, simTest } from './metrics.js';

const SESSIONS = Number(process.env.SIM_PTT_SESSIONS) || 1000;
const STEP_MS = 50; // invariants are checked at this granularity of simulated time
const SLACK_MS = 100; // allowed on top of heartbeatTimeoutMs, as required by the design

function buildSession(seed) {
  const rnd = prng(seed);
  const between = (a, b) => a + (b - a) * rnd();
  const timeoutMs = Math.round(between(200, 2000));
  const totSeconds = Math.round(between(1, 12));
  const durationMs = between(5_000, 45_000);
  const lossRate = rnd() < 0.3 ? 0 : between(0, 0.4);
  const actors = Array.from({ length: 2 + Math.floor(rnd() * 2) }, (_, i) => ({
    id: `c${i}`,
    email: `op${i}@example.org`,
    callsign: `EA4A${String.fromCharCode(65 + i)}`,
    role: i === 2 && rnd() < 0.3 ? 'listener' : 'operator',
  }));
  const events = [];
  let sent = 0;
  let lost = 0;
  for (const a of actors) {
    // An operator disconnects at some point: gracefully (release) or silently (no more heartbeats, no release).
    const disc = rnd() < 0.5 ? between(0.2, 1) * durationMs : Infinity;
    const graceful = rnd() < 0.5;
    const alive = (t) => t < disc;
    for (let k = 0; k < 6; k++) {
      const t = between(0, durationMs);
      if (alive(t)) events.push({ t, type: 'turn', actor: a });
    }
    const period = timeoutMs * between(0.15, 0.55);
    for (let t = between(0, period); t < durationMs && alive(t); t += period * between(0.7, 1.3)) {
      sent++;
      if (rnd() < lossRate) {
        lost++;
        continue;
      }
      // Heavy-tailed latency: later heartbeats overtake earlier ones (reordering).
      const arrive = t + timeoutMs * 1.5 * rnd() ** 3;
      if (alive(arrive)) events.push({ t: arrive, type: 'hb', actor: a });
    }
    for (let k = 0, t = between(0, 3000); k < 6 && t < durationMs; k++) {
      if (alive(t)) {
        events.push({ t, type: 'down', actor: a });
        const up = t + between(200, 15_000);
        if (alive(up)) events.push({ t: up, type: 'up', actor: a });
      }
      t += between(500, 9000);
    }
    if (Number.isFinite(disc) && graceful) events.push({ t: disc, type: 'release', actor: a });
  }
  events.sort((x, y) => x.t - y.t);
  return { timeoutMs, totSeconds, durationMs, events, sent, lost };
}

function runSession(seed, stats) {
  const s = buildSession(seed);
  const clock = new FakeClock();
  const t0 = clock.now();
  const driver = new FakeDriver(clock);
  const ptt = new Ptt({ tx: { enabled: true, totSeconds: s.totSeconds, heartbeatTimeoutMs: s.timeoutMs }, driver, clock, logger: silentLogger });
  const totMs = s.totSeconds * 1000;
  let lastLife = t0;
  let keyer = null;
  let keyStart = null;

  ptt.on('state', ({ state, prev, reason }) => {
    if (prev === 'TX_ON' && state !== 'TX_ON') {
      const now = clock.now();
      if (reason === 'heartbeat_timeout') {
        stats.hbCutMs.push(now - lastLife);
        stats.hbCutRatio.push((now - lastLife) / s.timeoutMs);
      } else if (reason === 'tot') stats.totOverMs.push(now - keyStart - totMs);
      stats.cuts[reason] = (stats.cuts[reason] ?? 0) + 1;
    }
  });

  const keyed = () => driver.calls.length > 0 && driver.last.on;
  const check = () => {
    const now = clock.now();
    if (keyed()) {
      assert.ok(now - lastLife <= s.timeoutMs + SLACK_MS, `seed ${seed}: TX keyed ${now - lastLife} ms after the last valid heartbeat (timeout ${s.timeoutMs})`);
      assert.ok(now - keyStart <= totMs + SLACK_MS, `seed ${seed}: TOT exceeded (${now - keyStart} ms of ${totMs})`);
      assert.equal(ptt.state, 'TX_ON', `seed ${seed}: carrier on while state ${ptt.state}`);
      assert.equal(ptt.holderId, keyer, `seed ${seed}: carrier keyed by ${keyer} but holder is ${ptt.holderId}`);
    } else {
      assert.notEqual(ptt.state, 'TX_ON', `seed ${seed}: TX_ON without carrier`);
    }
  };
  const advanceTo = (tMs) => {
    const target = Math.ceil(tMs); // integer ms keep the fake clock arithmetic exact
    while (clock.now() - t0 < target) {
      clock.advance(Math.min(STEP_MS, target - (clock.now() - t0)));
      check();
    }
  };

  const run = async () => {
    for (const ev of s.events) {
      advanceTo(ev.t);
      const id = ev.actor.id;
      if (ev.type === 'turn') {
        const before = ptt.holderId;
        const r = ptt.requestTurn(ev.actor);
        if (r.ok && before === null) lastLife = clock.now();
        if (!r.ok) assert.ok(['busy', 'forbidden'].includes(r.reason), `seed ${seed}: unexpected denial ${r.reason}`);
        if (ev.actor.role === 'listener') assert.equal(r.ok, false);
      } else if (ev.type === 'hb') {
        if (ptt.heartbeat(id)) lastLife = clock.now();
        stats.hbDelivered++;
      } else if (ev.type === 'down') {
        const wasKeyed = keyed();
        const r = await ptt.keyDown(id);
        if (r.ok && !wasKeyed) {
          keyer = id;
          keyStart = clock.now();
        }
        if (wasKeyed && keyer !== id) assert.equal(r.ok, false, `seed ${seed}: second keyer accepted`);
        if (r.ok && keyer !== id) assert.fail(`seed ${seed}: two keyers (${keyer}, ${id})`);
      } else if (ev.type === 'up') {
        await ptt.keyUp(id);
      } else if (ev.type === 'release') {
        await ptt.release(id, 'disconnect');
      }
      check();
    }
    // Everything has gone quiet: no matter what the last events were, TX must be off after at most one timeout.
    advanceTo(s.durationMs + 3 * s.timeoutMs + SLACK_MS);
    assert.equal(keyed(), false, `seed ${seed}: carrier still on after the session ended`);
    // Two consecutive "on" driver calls would mean two keyings without an unkey in between.
    for (let i = 1; i < driver.calls.length; i++) assert.ok(!(driver.calls[i].on && driver.calls[i - 1].on), `seed ${seed}: double key-down`);
    stats.hbSent += s.sent;
    stats.hbLost += s.lost;
    stats.keyings += driver.calls.filter((c) => c.on).length;
    stats.timeoutsMs.push(s.timeoutMs);
    ptt.dispose();
  };
  return run();
}

simTest('ptt', `${SESSIONS} random sessions: heartbeat loss/jitter/reorder, presses, disconnects, TOT`, async () => {
  const stats = { hbCutMs: [], hbCutRatio: [], totOverMs: [], cuts: {}, hbSent: 0, hbLost: 0, hbDelivered: 0, keyings: 0, timeoutsMs: [] };
  for (let i = 0; i < SESSIONS; i++) await runSession(1_000_000 + i, stats);

  const lat = stats.hbCutMs;
  record('ptt', 'summary', {
    sessions: SESSIONS,
    keyings: stats.keyings,
    heartbeatsSent: stats.hbSent,
    heartbeatsLost: stats.hbLost,
    heartbeatsDelivered: stats.hbDelivered,
    cutsByReason: stats.cuts,
    heartbeatCuts: lat.length,
    totCuts: stats.totOverMs.length,
    cutLatencyMs: {
      min: Math.min(...lat),
      p50: percentile(lat, 50),
      p95: percentile(lat, 95),
      p99: percentile(lat, 99),
      max: Math.max(...lat),
    },
    cutLatencyOverTimeout: { p50: percentile(stats.hbCutRatio, 50), p99: percentile(stats.hbCutRatio, 99), max: Math.max(...stats.hbCutRatio) },
    totOvershootMsMax: Math.max(...stats.totOverMs),
  });
  assert.ok(lat.length > 50, 'enough watchdog cuts were exercised');
  assert.ok(stats.totOverMs.length > 20, 'enough TOT cuts were exercised');
  assert.ok(Math.max(...stats.totOverMs) <= SLACK_MS, 'TOT overshoot within slack');
});

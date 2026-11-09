import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../../src/server/app.js';
import { validateConfig } from '../../src/server/config.js';
import { createFileAudit } from '../../src/ptt/audit.js';
import { createFakeOidc } from '../fixtures/fake-oidc.js';
import { FakeDriver, silentLogger } from '../fixtures/fakes.js';
import { prng } from '../fixtures/dsp.js';
import { record, simTest } from './metrics.js';

const OPERATORS = 5;
const ATTEMPTS = Number(process.env.SIM_CONTENTION_ATTEMPTS) || 14; // per operator
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'bricohams-contention-'));
  const config = validateConfig({
    port: 0,
    google: { clientId: 'client-id' },
    allowlist: [
      { email: 'owner@example.org', callsign: 'EA4OWN', role: 'owner' },
      ...Array.from({ length: OPERATORS }, (_, i) => ({ email: `op${i}@example.org`, callsign: `EA4O${String.fromCharCode(65 + i)}A`, role: 'operator' })),
    ],
    tx: { enabled: true, totSeconds: 60, heartbeatTimeoutMs: 400 },
    auditLogPath: join(dir, 'audit.log'),
    logbook: { path: ':memory:' },
  }, { GOOGLE_CLIENT_SECRET: 'test-secret' });
  const oidc = createFakeOidc();
  const driver = new FakeDriver();
  const app = createApp(config, { oidc, driver, logger: silentLogger, beaconAutoStart: false, audit: createFileAudit({ path: config.auditLogPath }) });
  const { url } = await app.listen();
  return { app, oidc, driver, base: url };
}

async function cookieFor(ctx, email) {
  const r1 = await fetch(`${ctx.base}/auth/login`, { redirect: 'manual' });
  const { code, state } = ctx.oidc.issueCode(r1.headers.get('location'), { email });
  const loginCookie = r1.headers.getSetCookie().find((c) => c.startsWith('bh_login=')).split(';')[0];
  const r2 = await fetch(`${ctx.base}/auth/callback?code=${code}&state=${state}`, { headers: { cookie: loginCookie } });
  return r2.headers.getSetCookie().find((c) => c.startsWith('bh_session=')).split(';')[0];
}

class Op {
  results = [];
  waiters = [];

  constructor(ctx, cookie, name) {
    this.name = name;
    this.ws = new WebSocket(`${ctx.base.replace('http', 'ws')}/ws/control`, { headers: { Cookie: cookie, Origin: ctx.base } });
    this.ws.on('message', (d, isBinary) => {
      if (isBinary) return;
      const m = JSON.parse(d.toString());
      if (m.type !== 'result') return;
      const w = this.waiters.shift();
      if (w) w(m);
      else this.results.push(m);
    });
    this.opened = new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); });
  }

  // Control messages are answered strictly in order, so a FIFO of waiters is enough.
  call(msg) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no reply to ${msg.type}`)), 3000);
      this.waiters.push((m) => { clearTimeout(timer); resolve(m); });
      this.ws.send(JSON.stringify(msg));
    });
  }
}

simTest('contention', `${OPERATORS} operators race for the turn through the real server`, async () => {
  const ctx = await start();
  const ops = [];
  try {
    for (let i = 0; i < OPERATORS; i++) {
      const op = new Op(ctx, await cookieFor(ctx, `op${i}@example.org`), `op${i}`);
      ops.push(op);
      await op.opened;
    }

    const intervals = []; // [grantReceived, releaseSent] on one monotonic clock, per operator
    const grants = new Array(OPERATORS).fill(0);
    const denials = new Array(OPERATORS).fill(0);
    const denialReasons = {};
    const waitMs = [];
    let keyings = 0;
    const deadline = now() + 30000;

    await Promise.all(ops.map(async (op, i) => {
      const rnd = prng(900 + i);
      // The server turn is a first-come try-lock with no queue, so a fixed number of tries can leave an
      // operator empty-handed by chance. Each operator keeps retrying (seeded jitter) until it has won
      // ATTEMPTS turns, bounded by a deadline.
      while (grants[i] < ATTEMPTS && now() < deadline) {
        await sleep(rnd() * 25);
        const t0 = now();
        const r = await op.call({ type: 'turn' });
        if (!r.ok) {
          denials[i]++;
          denialReasons[r.reason] = (denialReasons[r.reason] ?? 0) + 1;
          continue;
        }
        const granted = now();
        waitMs.push(granted - t0);
        grants[i]++;
        op.ws.send(JSON.stringify({ type: 'heartbeat' }));
        if (rnd() < 0.5) {
          const k = await op.call({ type: 'ptt', down: true });
          if (k.ok) keyings++;
          await sleep(5 + rnd() * 25);
          await op.call({ type: 'ptt', down: false });
        } else {
          await sleep(5 + rnd() * 25);
        }
        const released = now();
        const rel = await op.call({ type: 'release' });
        assert.equal(rel.ok, true, 'holder can release');
        intervals.push({ op: i, from: granted, to: released });
      }
    }));

    intervals.sort((a, b) => a.from - b.from);
    for (let k = 1; k < intervals.length; k++) {
      assert.ok(intervals[k].from >= intervals[k - 1].to, `turn held by two operators at once (${intervals[k - 1].op} and ${intervals[k].op})`);
    }
    assert.deepEqual(Object.keys(denialReasons).filter((r) => r !== 'busy'), [], 'only "busy" denials while racing');
    assert.ok(grants.every((g) => g === ATTEMPTS), `every operator won ${ATTEMPTS} turns before the deadline: ${grants}`);
    assert.equal(ctx.app.ptt.state, 'TX_OFF');
    const calls = ctx.driver.calls;
    for (let k = 1; k < calls.length; k++) assert.notEqual(calls[k].on, calls[k - 1].on, 'driver on/off strictly alternate');
    assert.equal(calls.filter((c) => c.on).length, keyings);

    // A holder that vanishes without releasing must not block the others.
    const [a, b] = ops;
    assert.equal((await a.call({ type: 'turn' })).ok, true);
    a.ws.terminate();
    const t0 = now();
    let took = null;
    for (let tries = 0; tries < 100 && took === null; tries++) {
      if ((await b.call({ type: 'turn' })).ok) took = now() - t0;
      else await sleep(10);
    }
    assert.notEqual(took, null, 'turn is freed after the holder disconnects');
    await b.call({ type: 'release' });

    const sum = grants.reduce((x, y) => x + y, 0);
    const jain = (sum * sum) / (OPERATORS * grants.reduce((x, y) => x + y * y, 0));
    const waits = waitMs.slice().sort((x, y) => x - y);
    record('contention', 'summary', {
      operators: OPERATORS,
      attemptsPerOperator: ATTEMPTS,
      grantsPerOperator: grants,
      denialsPerOperator: denials,
      denialReasons,
      totalGrants: sum,
      maxSimultaneousHolders: 1,
      jainIndex: Number(jain.toFixed(3)),
      grantReplyMsP50: Number(waits[Math.floor(waits.length / 2)].toFixed(1)),
      handoverAfterDisconnectMs: Number(took.toFixed(1)),
    });
  } finally {
    ops.forEach((o) => o.ws.terminate());
    await ctx.app.close();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PttState, createPtt } from '../../src/ptt/index.js';
import { createResetCode } from '../../src/ptt/reset-code.js';
import { createFileAudit } from '../../src/ptt/audit.js';
import { FakeClock, FakeDriver, silentLogger, tick } from '../fixtures/fakes.js';

const HB = 2000;
const op1 = { id: 'c1', email: 'a@x.org', callsign: 'EA4AAA', role: 'operator' };
const op2 = { id: 'c2', email: 'b@x.org', callsign: 'EA4BBB', role: 'operator' };
const owner = { id: 'c3', email: 'o@x.org', callsign: 'EA4OOO', role: 'owner' };
const listener = { id: 'c4', email: 'l@x.org', callsign: 'EA4LLL', role: 'listener' };

function setup(tx = {}, auditImpl) {
  const clock = new FakeClock();
  const driver = new FakeDriver(clock);
  const records = [];
  const audit = auditImpl ?? { record: (e) => records.push(e) };
  const codePath = join(mkdtempSync(join(tmpdir(), 'bricohams-reset-')), 'reset-code');
  const resetCode = createResetCode({ path: codePath, logger: silentLogger });
  const ptt = createPtt({
    tx: { enabled: true, totSeconds: 600, heartbeatTimeoutMs: HB, armedTimeoutSeconds: 120, ...tx },
    driver, audit, clock, logger: silentLogger, resetCode,
  });
  const states = [];
  ptt.on('state', (s) => states.push(s.state));
  return { clock, driver, ptt, records, states, codePath };
}

async function keyed(ctx, actor = op1) {
  assert.ok(ctx.ptt.requestTurn(actor).ok);
  assert.ok((await ctx.ptt.keyDown(actor.id)).ok);
}

test('TX is refused entirely when tx.enabled is false', async () => {
  const { ptt, driver } = setup({ enabled: false });
  assert.deepEqual(ptt.requestTurn(owner), { ok: false, reason: 'tx_disabled' });
  assert.equal((await ptt.keyDown(owner.id)).ok, false);
  assert.equal(ptt.state, PttState.TX_OFF);
  assert.equal(driver.calls.length, 0);
});

test('happy path: TX_OFF -> ARMED -> TX_ON -> ARMED -> TX_OFF', async () => {
  const ctx = setup();
  const { ptt, driver, states } = ctx;
  assert.equal(ptt.state, PttState.TX_OFF);
  assert.ok(ptt.requestTurn(op1).ok);
  assert.equal(ptt.state, PttState.ARMED);
  assert.equal(ptt.holderId, 'c1');
  assert.ok((await ptt.keyDown('c1')).ok);
  assert.equal(ptt.state, PttState.TX_ON);
  assert.ok((await ptt.keyUp('c1')).ok);
  assert.equal(ptt.state, PttState.ARMED);
  assert.ok((await ptt.release('c1')).ok);
  assert.equal(ptt.state, PttState.TX_OFF);
  assert.equal(ptt.holderId, null);
  assert.deepEqual(driver.calls.map((c) => c.on), [true, false]);
  assert.deepEqual(states, ['ARMED', 'TX_ON', 'ARMED', 'TX_OFF']);
});

test('release from TX_ON cuts the carrier', async () => {
  const ctx = setup();
  await keyed(ctx);
  await ctx.ptt.release('c1');
  assert.equal(ctx.ptt.state, PttState.TX_OFF);
  assert.equal(ctx.driver.last.on, false);
});

test('listeners cannot take the turn; keying needs the turn', async () => {
  const { ptt, driver } = setup();
  assert.deepEqual(ptt.requestTurn(listener), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await ptt.keyDown('c4'), { ok: false, reason: 'no_turn' });
  assert.equal(driver.calls.length, 0);
});

test('second operator is rejected while the turn is held, then accepted after release', async () => {
  const ctx = setup();
  await keyed(ctx, op1);
  assert.deepEqual(ctx.ptt.requestTurn(op2), { ok: false, reason: 'busy' });
  assert.deepEqual(ctx.ptt.requestTurn({ ...owner, id: 'c1b' }), { ok: false, reason: 'busy' });
  assert.deepEqual(await ctx.ptt.keyDown('c2'), { ok: false, reason: 'no_turn' });
  assert.ok(ctx.ptt.requestTurn(op1).ok, 'holder re-request is idempotent');
  await ctx.ptt.release('c1');
  assert.ok(ctx.ptt.requestTurn(op2).ok);
  assert.equal(ctx.ptt.snapshot().holder.callsign, 'EA4BBB');
});

test('watchdog cuts TX in less than heartbeatTimeoutMs after the last heartbeat', async () => {
  const ctx = setup();
  await keyed(ctx);
  ctx.clock.advance(1000);
  assert.ok(ctx.ptt.heartbeat('c1'));
  const lastBeat = ctx.clock.now();
  ctx.clock.advance(1400);
  assert.equal(ctx.ptt.state, PttState.TX_ON);
  ctx.clock.advance(200);
  assert.equal(ctx.ptt.state, PttState.TX_OFF);
  assert.equal(ctx.driver.last.on, false);
  assert.ok(ctx.driver.last.at - lastBeat < HB);
  assert.equal(ctx.ptt.holderId, null);
});

test('regular heartbeats keep TX alive', async () => {
  const ctx = setup();
  await keyed(ctx);
  for (let i = 0; i < 20; i++) {
    ctx.clock.advance(500);
    ctx.ptt.heartbeat('c1');
  }
  assert.equal(ctx.ptt.state, PttState.TX_ON);
  assert.equal(ctx.ptt.heartbeat('someone-else'), false);
});

test('watchdog also releases an ARMED turn', () => {
  const ctx = setup();
  ctx.ptt.requestTurn(op1);
  ctx.clock.advance(HB);
  assert.equal(ctx.ptt.state, PttState.TX_OFF);
  assert.equal(ctx.ptt.holderId, null);
  assert.equal(ctx.driver.calls.length, 0);
});

test('TOT cuts a long transmission', async () => {
  const ctx = setup({ totSeconds: 3 });
  await keyed(ctx);
  const reasons = [];
  ctx.ptt.on('state', (s) => reasons.push(s.reason));
  for (let i = 0; i < 5; i++) {
    ctx.clock.advance(500);
    ctx.ptt.heartbeat('c1');
  }
  assert.equal(ctx.ptt.state, PttState.TX_ON);
  ctx.clock.advance(500);
  assert.equal(ctx.ptt.state, PttState.TX_OFF);
  assert.deepEqual(reasons, ['tot']);
  assert.equal(ctx.driver.last.on, false);
  const off = ctx.records.find((r) => r.event === 'tx_off');
  assert.equal(off.reason, 'tot');
  assert.equal(off.durationMs, 3000);
});

test('ARMED inactivity timeout releases the turn', () => {
  const ctx = setup({ armedTimeoutSeconds: 10 });
  ctx.ptt.requestTurn(op1);
  for (let i = 0; i < 19; i++) {
    ctx.clock.advance(500);
    ctx.ptt.heartbeat('c1');
  }
  assert.equal(ctx.ptt.state, PttState.ARMED);
  ctx.clock.advance(500);
  assert.equal(ctx.ptt.state, PttState.TX_OFF);
});

test('driver failure on key-down enters LOCKOUT', async () => {
  const ctx = setup();
  ctx.driver.failOn = 'on';
  ctx.ptt.requestTurn(op1);
  assert.deepEqual(await ctx.ptt.keyDown('c1'), { ok: false, reason: 'driver_error' });
  await tick();
  assert.equal(ctx.ptt.state, PttState.LOCKOUT);
  assert.equal(ctx.driver.last.on, false, 'carrier forced off');
  assert.deepEqual(ctx.ptt.requestTurn(op2), { ok: false, reason: 'lockout' });
  assert.deepEqual(await ctx.ptt.keyDown('c1'), { ok: false, reason: 'lockout' });
});

test('failure to switch TX off enters LOCKOUT', async () => {
  const ctx = setup();
  await keyed(ctx);
  ctx.driver.failOn = 'off';
  await ctx.ptt.keyUp('c1');
  assert.equal(ctx.ptt.state, PttState.LOCKOUT);
  assert.equal(ctx.ptt.snapshot().lockoutReason, 'driver_error');
});

test('LOCKOUT is cleared only by an owner presenting the one-time code', async () => {
  const ctx = setup();
  const readCode = () => readFileSync(ctx.codePath, 'utf8').trim();
  await ctx.ptt.fault('external_fault');
  assert.equal(ctx.ptt.state, PttState.LOCKOUT);
  const code = readCode();
  assert.match(code, /^\d{8}$/);
  assert.deepEqual(await ctx.ptt.ownerReset(op1, { code }), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await ctx.ptt.ownerReset(owner, {}), { ok: false, reason: 'bad_code' });
  assert.deepEqual(await ctx.ptt.ownerReset(owner, { code: 12345678 }), { ok: false, reason: 'bad_code' });
  assert.equal(ctx.ptt.state, PttState.LOCKOUT);
  ctx.clock.advance(3_600_000);
  assert.equal(ctx.ptt.state, PttState.LOCKOUT, 'time never clears LOCKOUT');
  ctx.driver.failOn = 'off';
  assert.deepEqual(await ctx.ptt.ownerReset(owner, { code }), { ok: false, reason: 'driver_error' });
  const code2 = readCode();
  assert.notEqual(code2, code, 'a failed attempt that consumed the code rotates it');
  ctx.driver.failOn = null;
  assert.deepEqual(await ctx.ptt.ownerReset(owner, { code: code2 }), { ok: true });
  assert.equal(ctx.ptt.state, PttState.TX_OFF);
  assert.deepEqual(await ctx.ptt.ownerReset(owner, { code: code2 }), { ok: false, reason: 'not_locked' });
  assert.ok(ctx.ptt.requestTurn(op1).ok);
});

test('reset code is single use and rotates on every LOCKOUT', async () => {
  const ctx = setup();
  await ctx.ptt.fault('one');
  const first = readFileSync(ctx.codePath, 'utf8').trim();
  assert.ok((await ctx.ptt.ownerReset(owner, { code: first })).ok);
  await ctx.ptt.fault('two');
  assert.deepEqual(await ctx.ptt.ownerReset(owner, { code: first }), { ok: false, reason: 'bad_code' });
  const second = readFileSync(ctx.codePath, 'utf8').trim();
  assert.ok((await ctx.ptt.ownerReset(owner, { code: second })).ok);
});

test('repeated wrong codes rotate the code', async () => {
  const ctx = setup();
  await ctx.ptt.fault('x');
  const before = readFileSync(ctx.codePath, 'utf8').trim();
  const wrong = before === '00000000' ? '00000001' : '00000000';
  for (let i = 0; i < 5; i++) assert.equal((await ctx.ptt.ownerReset(owner, { code: wrong })).ok, false);
  assert.notEqual(readFileSync(ctx.codePath, 'utf8').trim(), before);
});

test('without a reset code store LOCKOUT cannot be cleared at runtime', async () => {
  const ptt = createPtt({
    tx: { enabled: true, totSeconds: 600, heartbeatTimeoutMs: HB }, driver: new FakeDriver(), logger: silentLogger,
  });
  await ptt.fault('x');
  assert.deepEqual(await ptt.ownerReset(owner, { code: '12345678' }), { ok: false, reason: 'reset_unavailable' });
});

test('reset code file is private and the log line never contains the code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bricohams-rc-'));
  const lines = [];
  const rc = createResetCode({ path: join(dir, 'c'), logger: { error: (...a) => lines.push(a.join(' ')), info: (...a) => lines.push(a.join(' ')) } });
  rc.rotate();
  const code = readFileSync(join(dir, 'c'), 'utf8').trim();
  assert.ok(lines.length > 0 && lines.every((l) => !l.includes(code)));
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'c')).mode & 0o777, 0o600);
  assert.equal(rc.check(code), true);
  rc.consume();
  assert.equal(rc.check(code), false);
});

test('fault during TX cuts the carrier and locks out', async () => {
  const ctx = setup();
  await keyed(ctx);
  await ctx.ptt.fault('swr');
  assert.equal(ctx.ptt.state, PttState.LOCKOUT);
  assert.equal(ctx.driver.last.on, false);
});

test('release while key-down is in flight leaves the carrier off', async () => {
  const ctx = setup();
  ctx.ptt.requestTurn(op1);
  let unblock;
  ctx.driver.setTx = async (on) => {
    ctx.driver.calls.push({ on, at: ctx.clock.now() });
    if (on) await new Promise((r) => { unblock = r; });
  };
  const pending = ctx.ptt.keyDown('c1');
  await tick();
  await ctx.ptt.release('c1', 'disconnect');
  unblock();
  assert.deepEqual(await pending, { ok: false, reason: 'aborted' });
  assert.equal(ctx.ptt.state, PttState.TX_OFF);
  assert.equal(ctx.driver.last.on, false);
});

test('TX is refused when the audit log cannot be written', async () => {
  const ctx = setup({}, { record() { throw new Error('disk full'); } });
  ctx.ptt.requestTurn(op1);
  assert.deepEqual(await ctx.ptt.keyDown('c1'), { ok: false, reason: 'audit_failed' });
  assert.equal(ctx.driver.calls.length, 0);
});

test('audit trail records the transmission', async () => {
  const ctx = setup();
  await keyed(ctx);
  ctx.clock.advance(1000);
  await ctx.ptt.keyUp('c1');
  await ctx.ptt.release('c1');
  assert.deepEqual(ctx.records.map((r) => r.event), ['turn_granted', 'tx_on', 'tx_off', 'turn_released']);
  assert.equal(ctx.records[2].durationMs, 1000);
  assert.equal(ctx.records[1].callsign, 'EA4AAA');
});

test('file audit appends JSON lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bricohams-audit-'));
  const path = join(dir, 'sub', 'audit.log');
  const audit = createFileAudit({ path, clock: { now: () => 0 } });
  audit.record({ event: 'a' });
  audit.record({ event: 'b', callsign: 'X1X' });
  const lines = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines, [
    { ts: '1970-01-01T00:00:00.000Z', event: 'a' },
    { ts: '1970-01-01T00:00:00.000Z', event: 'b', callsign: 'X1X' },
  ]);
});

import assert from 'node:assert/strict';
import { createBeaconRig } from './beacon-rig.js';
import { percentile, record, simTest } from './metrics.js';
import { validateConfig } from '../../src/server/config.js';

// 2 h of simulated LNB drift, one spectrum frame every 2 s of simulated time (the production cadence is 1 s; 2 s is the
// harder case for the median/EMA filter and halves the runtime).
const FRAME_S = 2;
const DURATION_S = Number(process.env.SIM_BEACON_SECONDS) || 7200;
const OUTAGE_AT_S = Math.min(3600, Math.floor(DURATION_S / 2));
const OUTAGE_S = 10;
// Frames right after (re)locking are excluded: the 5-sample median + EMA need ~10 s to converge on a drifting beacon.
const SETTLE_S = 10;
const MAX_ERR_HZ = 50;
const MAX_RELOCK_S = 30;
const NEVER = 9999;

const PROFILES = {
  bricohams: { drift: { ppm: 0.2, rampHzPerHour: 3000, walkHzPerRootS: 0.15 } },
  // The FreqTracker only sees +-250 Hz, so the start must be close to nominal and the drift gentle.
  'sdrangel-freqtracker': { drift: { ppm: 0, rampHzPerHour: 1800, walkHzPerRootS: 0.05 } },
};

async function run(engine) {
  const rig = await createBeaconRig({ engine, seed: 20_241_108, drift: PROFILES[engine].drift });
  try {
    if (engine === 'sdrangel-freqtracker') await rig.step(0); // first step only provisions the tracker channel
    const errors = [];
    let lockedSince = null;
    let firstLockAt = null;
    let wasLocked = false;
    let relockedAt = null;
    let lostLock = false;
    let writesWhileUnlocked = 0;
    let maxTruthHz = 0;
    const outageEnd = OUTAGE_AT_S + OUTAGE_S;

    for (let t = FRAME_S; t <= DURATION_S; t += FRAME_S) {
      rig.setBeacon(!(t >= OUTAGE_AT_S && t < outageEnd));
      const r = await rig.step(t);
      const locked = r.status === 'locked';
      maxTruthHz = Math.max(maxTruthHz, Math.abs(r.truthHz));
      if (!locked && r.centreWrites > 0) writesWhileUnlocked++;
      if (locked && !wasLocked) {
        lockedSince = t;
        firstLockAt ??= t;
        if (t >= outageEnd && relockedAt === null) relockedAt = t;
      }
      if (!locked) {
        lockedSince = null;
        if (t >= OUTAGE_AT_S && t < outageEnd + MAX_RELOCK_S) lostLock = true;
      }
      wasLocked = locked;
      if (locked && t - lockedSince >= SETTLE_S) errors.push(Math.abs(r.errHz));
    }

    // Time from the end of the outage until locked again; 0 when the hold-over never dropped lock.
    let relockS = 0;
    if (lostLock) relockS = relockedAt === null ? NEVER : relockedAt - outageEnd;
    return {
      engine,
      frames: Math.floor(DURATION_S / FRAME_S),
      firstLockS: firstLockAt,
      scoredFrames: errors.length,
      errMaxHz: errors.length ? Math.max(...errors) : NaN,
      errP50Hz: percentile(errors, 50),
      errP95Hz: percentile(errors, 95),
      errP99Hz: percentile(errors, 99),
      errRmsHz: Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / Math.max(1, errors.length)),
      relockS,
      lostLockInOutage: lostLock,
      writesWhileUnlocked,
      maxDriftHz: Math.round(maxTruthHz),
    };
  } finally {
    await rig.stop();
  }
}

for (const engine of ['bricohams', 'sdrangel-freqtracker']) {
  simTest('beacon', `${engine}: tracks LNB drift, re-locks after a 10 s outage, never corrects while unlocked`, async () => {
    const stats = await run(engine);
    record('beacon', engine, stats);
    assert.ok(stats.firstLockS !== null && stats.firstLockS <= 60, `first lock at ${stats.firstLockS} s`);
    assert.ok(stats.scoredFrames > 100, 'enough locked frames were scored');
    assert.ok(stats.errMaxHz < MAX_ERR_HZ, `max |correction error| ${stats.errMaxHz.toFixed(1)} Hz`);
    assert.ok(stats.relockS <= MAX_RELOCK_S, `re-lock took ${stats.relockS} s`);
    assert.equal(stats.writesWhileUnlocked, 0, 'no SDRangel centre-frequency write while unlocked');
  });
}

simTest('beacon', 'beacon.engine=sdrangel-freqtracker is a valid configuration', () => {
  const config = validateConfig({
    port: 0,
    google: { clientId: 'client-id' },
    allowlist: [
      { email: 'owner@example.org', callsign: 'EA4OWN', role: 'owner' },
      { email: 'op@example.org', callsign: 'EA4AAA', role: 'operator' },
    ],
    tx: { enabled: true, totSeconds: 60, heartbeatTimeoutMs: 1000 },
    sdrangel: { baseUrl: 'http://127.0.0.1:8091' },
    beacon: { engine: 'sdrangel-freqtracker' },
  }, { GOOGLE_CLIENT_SECRET: 'test-secret' });
  assert.equal(config.beacon.engine, 'sdrangel-freqtracker');
});

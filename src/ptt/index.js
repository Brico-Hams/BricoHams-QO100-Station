import { EventEmitter } from 'node:events';

/** PTT states. */
export const PttState = Object.freeze({
  TX_OFF: 'TX_OFF',
  ARMED: 'ARMED',
  TX_ON: 'TX_ON',
  LOCKOUT: 'LOCKOUT',
});

const TX_ROLES = new Set(['operator', 'owner']);

// The watchdog fires at 75% of the configured timeout so that the cut is
// guaranteed to complete before the timeout even with driver latency.
const WATCHDOG_RATIO = 0.75;

const realClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
};

/**
 * @typedef {object} Actor
 * @property {string} id Unique id of the controlling connection (not the user).
 * @property {string} email
 * @property {string} callsign
 * @property {'listener'|'operator'|'owner'} role
 */

/**
 * @typedef {object} PttDriver
 * @property {(on: boolean) => Promise<void>|void} setTx Switch the transmitter. Must reject/throw on failure.
 */

/**
 * PTT state machine: TX_OFF -> ARMED -> TX_ON, plus LOCKOUT.
 * One operator holds the turn at a time; losing heartbeat, exceeding TOT or any
 * driver error cuts the carrier. Events: `state` ({state, prev, reason, holder, txEnabled}).
 */
export class Ptt extends EventEmitter {
  #tx;
  #driver;
  #audit;
  #clock;
  #logger;
  #state = PttState.TX_OFF;
  #holder = null;
  #generation = 0;
  #keyPending = false;
  #txStartedAt = null;
  #timers = { watchdog: null, armed: null, tot: null };
  #lockoutReason = null;

  /**
   * @param {{tx: {enabled: boolean, totSeconds: number, heartbeatTimeoutMs: number, armedTimeoutSeconds?: number},
   *   driver: PttDriver, audit?: {record(e: object): void}, clock?: object, logger?: {error(...a: unknown[]): void}}} opts
   */
  constructor({ tx, driver, audit = { record() {} }, clock = realClock, logger = console }) {
    super();
    this.#tx = { armedTimeoutSeconds: 120, ...tx };
    this.#driver = driver;
    this.#audit = audit;
    this.#clock = clock;
    this.#logger = logger;
  }

  /** @returns {string} Current state. */
  get state() {
    return this.#state;
  }

  /** @returns {string|null} Id of the connection holding the turn. */
  get holderId() {
    return this.#holder?.id ?? null;
  }

  /**
   * @returns {{state: string, holder: {id: string, email: string, callsign: string}|null, txEnabled: boolean, lockoutReason: string|null}}
   */
  snapshot() {
    return {
      state: this.#state,
      holder: this.#holder ? { ...this.#holder } : null,
      txEnabled: this.#tx.enabled,
      lockoutReason: this.#lockoutReason,
    };
  }

  /**
   * Request the exclusive transmit turn (TX_OFF -> ARMED).
   * @param {Actor} actor
   * @returns {{ok: boolean, reason?: string}}
   */
  requestTurn(actor) {
    if (!this.#tx.enabled) return this.#deny(actor, 'tx_disabled');
    if (this.#state === PttState.LOCKOUT) return this.#deny(actor, 'lockout');
    if (!actor || !TX_ROLES.has(actor.role)) return this.#deny(actor, 'forbidden');
    if (this.#holder) {
      return this.#holder.id === actor.id ? { ok: true } : this.#deny(actor, 'busy');
    }
    this.#holder = { id: actor.id, email: actor.email, callsign: actor.callsign, role: actor.role };
    this.#generation++;
    this.#armWatchdog();
    this.#armArmedTimer();
    this.#record({ event: 'turn_granted', ...this.#who() });
    this.#setState(PttState.ARMED, 'turn_granted');
    return { ok: true };
  }

  /**
   * Heartbeat from the turn holder; must arrive more often than heartbeatTimeoutMs.
   * @param {string} actorId
   * @returns {boolean} true if accepted.
   */
  heartbeat(actorId) {
    if (!this.#holder || this.#holder.id !== actorId) return false;
    this.#armWatchdog();
    return true;
  }

  /**
   * Key the transmitter (ARMED -> TX_ON).
   * @param {string} actorId
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  async keyDown(actorId) {
    if (this.#state === PttState.LOCKOUT) return { ok: false, reason: 'lockout' };
    if (!this.#holder || this.#holder.id !== actorId) return { ok: false, reason: 'no_turn' };
    if (this.#state === PttState.TX_ON) return { ok: true };
    if (this.#state !== PttState.ARMED || this.#keyPending) return { ok: false, reason: 'not_armed' };

    // Fail safe: never radiate without an audit trail.
    try {
      this.#audit.record({ event: 'tx_on', ...this.#who() });
    } catch (err) {
      this.#logger.error('ptt: audit write failed, refusing TX:', err.message);
      return { ok: false, reason: 'audit_failed' };
    }

    const gen = this.#generation;
    this.#keyPending = true;
    try {
      await this.#driver.setTx(true);
    } catch (err) {
      this.#logger.error('ptt: driver failed to key TX:', err.message);
      if (gen === this.#generation) this.#stop('driver_error', { lockout: true });
      return { ok: false, reason: 'driver_error' };
    }
    if (gen !== this.#generation) {
      // Cut while the key-down was in flight: make sure the carrier ends up off.
      await this.#driverOff();
      return { ok: false, reason: 'aborted' };
    }
    this.#keyPending = false;
    this.#clearTimer('armed');
    this.#txStartedAt = this.#clock.now();
    this.#timers.tot =  this.#clock.setTimeout(() => this.#stop('tot'), this.#tx.totSeconds * 1000);
    this.#setState(PttState.TX_ON, 'key_down');
    return { ok: true };
  }

  /**
   * Unkey the transmitter but keep the turn (TX_ON -> ARMED).
   * @param {string} actorId
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  async keyUp(actorId) {
    if (!this.#holder || this.#holder.id !== actorId) return { ok: false, reason: 'no_turn' };
    if (this.#state !== PttState.TX_ON) return { ok: true };
    const off = this.#driverOff();
    const durationMs = this.#clock.now() - this.#txStartedAt;
    this.#txStartedAt = null;
    this.#clearTimer('tot');
    this.#generation++;
    this.#armArmedTimer();
    this.#record({ event: 'tx_off', reason: 'key_up', durationMs, ...this.#who() });
    this.#setState(PttState.ARMED, 'key_up');
    await off;
    return this.#state === PttState.LOCKOUT ? { ok: false, reason: 'driver_error' } : { ok: true };
  }

  /**
   * Give up the turn (any state -> TX_OFF), cutting TX if needed.
   * @param {string} actorId
   * @param {string} [reason]
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  async release(actorId, reason = 'released') {
    if (!this.#holder || this.#holder.id !== actorId) return { ok: false, reason: 'no_turn' };
    await this.#stop(reason);
    return { ok: true };
  }

  /**
   * Force LOCKOUT (e.g. an external safety fault). Cuts TX immediately.
   * @param {string} reason
   * @returns {Promise<void>}
   */
  fault(reason) {
    return this.#stop(reason, { lockout: true });
  }

  /**
   * Clear LOCKOUT. Only an owner acting from the local machine may do this.
   * @param {Actor} actor
   * @param {{local: boolean}} ctx `local` must be true only for loopback requests.
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  async ownerReset(actor, { local }) {
    if (this.#state !== PttState.LOCKOUT) return { ok: false, reason: 'not_locked' };
    if (actor?.role !== 'owner') return { ok: false, reason: 'forbidden' };
    if (local !== true) return { ok: false, reason: 'not_local' };
    try {
      await this.#driver.setTx(false);
    } catch (err) {
      this.#logger.error('ptt: driver off failed during reset:', err.message);
      return { ok: false, reason: 'driver_error' };
    }
    this.#lockoutReason = null;
    this.#record({ event: 'lockout_reset', email: actor.email, callsign: actor.callsign });
    this.#setState(PttState.TX_OFF, 'lockout_reset');
    return { ok: true };
  }

  /** Stop all timers (call on shutdown). Does not touch the transmitter. */
  dispose() {
    this.#clearTimer('watchdog');
    this.#clearTimer('armed');
    this.#clearTimer('tot');
  }

  #who() {
    return this.#holder ? { email: this.#holder.email, callsign: this.#holder.callsign } : {};
  }

  #deny(actor, reason) {
    this.#record({ event: 'turn_denied', reason, email: actor?.email, callsign: actor?.callsign });
    return { ok: false, reason };
  }

  #record(entry) {
    try {
      this.#audit.record(entry);
    } catch (err) {
      this.#logger.error('ptt: audit write failed:', err.message);
    }
  }

  #clearTimer(field) {
    if (this.#timers[field] !== null) this.#clock.clearTimeout(this.#timers[field]);
    this.#timers[field] = null;
  }

  #armWatchdog() {
    this.#clearTimer('watchdog');
    this.#timers.watchdog =  this.#clock.setTimeout(
      () => this.#stop('heartbeat_timeout'),
      Math.floor(this.#tx.heartbeatTimeoutMs * WATCHDOG_RATIO),
    );
  }

  #armArmedTimer() {
    this.#clearTimer('armed');
    this.#timers.armed =  this.#clock.setTimeout(
      () => this.#stop('armed_timeout'),
      this.#tx.armedTimeoutSeconds * 1000,
    );
  }

  #driverOff() {
    let p;
    try {
      p = Promise.resolve(this.#driver.setTx(false));
    } catch (err) {
      p = Promise.reject(err);
    }
    return p.then(() => {}, (err) => {
      this.#logger.error('ptt: driver failed to switch TX off:', err.message);
      if (this.#state !== PttState.LOCKOUT) this.#enterLockout('driver_error');
    });
  }

  // Cut TX first, then update state: the carrier must drop before anything else can fail.
  #stop(reason, { lockout = false } = {}) {
    const wasTx = this.#state === PttState.TX_ON || this.#keyPending;
    const off = wasTx || lockout ? this.#driverOff() : Promise.resolve();
    const durationMs = this.#txStartedAt === null ? undefined : this.#clock.now() - this.#txStartedAt;
    const who = this.#who();
    this.#txStartedAt = null;
    this.#keyPending = false;
    this.#generation++;
    this.dispose();
    this.#holder = null;
    if (lockout) {
      this.#lockoutReason = reason;
      this.#record({ event: 'lockout', reason, durationMs, ...who });
      this.#setState(PttState.LOCKOUT, reason);
    } else {
      this.#record({ event: wasTx ? 'tx_off' : 'turn_released', reason, durationMs, ...who });
      this.#setState(PttState.TX_OFF, reason);
    }
    return off;
  }

  #enterLockout(reason) {
    this.#txStartedAt = null;
    this.#keyPending = false;
    this.#generation++;
    this.dispose();
    this.#holder = null;
    this.#lockoutReason = reason;
    this.#record({ event: 'lockout', reason });
    this.#setState(PttState.LOCKOUT, reason);
  }

  #setState(next, reason) {
    const prev = this.#state;
    if (prev === next) return;
    this.#state = next;
    try {
      this.emit('state', { ...this.snapshot(), prev, reason });
    } catch (err) {
      this.#logger.error('ptt: state listener failed:', err.message);
    }
  }
}

/**
 * Create a PTT state machine.
 * @param {ConstructorParameters<typeof Ptt>[0]} opts
 * @returns {Ptt}
 */
export function createPtt(opts) {
  return new Ptt(opts);
}

/**
 * Driver used when no real transmitter is wired: refuses to key, accepts "off".
 * @returns {PttDriver}
 */
export function createUnavailableDriver() {
  return {
    async setTx(on) {
      if (on) throw new Error('no transmitter driver configured');
    },
  };
}

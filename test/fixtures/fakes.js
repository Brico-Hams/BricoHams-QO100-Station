/** Manual clock with timers for deterministic tests. */
export class FakeClock {
  #now = 1_700_000_000_000;
  #timers = new Map();
  #seq = 0;

  now() {
    return this.#now;
  }

  setTimeout(fn, ms) {
    const id = ++this.#seq;
    this.#timers.set(id, { at: this.#now + ms, fn });
    return id;
  }

  clearTimeout(id) {
    this.#timers.delete(id);
  }

  pending() {
    return this.#timers.size;
  }

  /** Advance time, firing due timers in order. */
  advance(ms) {
    const target = this.#now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of this.#timers) if (t.at <= target && (!next || t.at < next[1].at)) next = [id, t];
      if (!next) break;
      this.#timers.delete(next[0]);
      this.#now = next[1].at;
      next[1].fn();
    }
    this.#now = target;
  }
}

/** PTT driver recording every setTx call with the clock time. */
export class FakeDriver {
  calls = [];
  failOn = null; // 'on' | 'off' | null

  constructor(clock = { now: Date.now }) {
    this.clock = clock;
  }

  async setTx(on) {
    this.calls.push({ on, at: this.clock.now() });
    if (this.failOn === (on ? 'on' : 'off')) throw new Error('driver failure');
  }

  get last() {
    return this.calls.at(-1);
  }
}

/** Resolve after pending microtasks/IO callbacks. */
export const tick = () => new Promise((resolve) => setImmediate(resolve));

export const silentLogger = { error() {}, info() {} };

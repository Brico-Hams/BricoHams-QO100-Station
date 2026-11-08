import { randomBytes as nodeRandomBytes } from 'node:crypto';

/**
 * In-memory session store with 256-bit random ids.
 * @param {{clock?: {now(): number}, ttlMs?: number, maxSessions?: number, randomBytes?: (n: number) => Buffer}} [opts]
 * @returns {{create(user: object): object, get(id: string): object|null, destroy(id: string): void, sweep(): void, size(): number}}
 */
export function createSessionStore({
  clock = { now: Date.now },
  ttlMs = 12 * 3600 * 1000,
  maxSessions = 1000,
  randomBytes = nodeRandomBytes,
} = {}) {
  const sessions = new Map();

  function sweep() {
    const now = clock.now();
    for (const [id, s] of sessions) if (s.expiresAt <= now) sessions.delete(id);
  }

  return {
    /**
     * @param {{email: string, callsign: string, role: string}} user
     * @returns {{id: string, csrfToken: string, user: object, createdAt: number, expiresAt: number}}
     */
    create(user) {
      sweep();
      if (sessions.size >= maxSessions) throw new Error('too many sessions');
      const now = clock.now();
      const session = {
        id: randomBytes(32).toString('base64url'),
        csrfToken: randomBytes(32).toString('base64url'),
        user: Object.freeze({ ...user }),
        createdAt: now,
        expiresAt: now + ttlMs,
      };
      sessions.set(session.id, session);
      return session;
    },
    /** @param {string} id @returns {object|null} The live session or null. */
    get(id) {
      if (typeof id !== 'string') return null;
      const s = sessions.get(id);
      if (!s) return null;
      if (s.expiresAt <= clock.now()) {
        sessions.delete(id);
        return null;
      }
      return s;
    },
    /** @param {string} id */
    destroy(id) {
      sessions.delete(id);
    },
    sweep,
    size: () => sessions.size,
  };
}

import { BAND_PLAN, DEFAULT_DIAL_HZ } from './bandplan.js';
import { BEACON_DOWNLINK_HZ } from './frequencies.js';
import { MODES } from './station.js';
import { filterNames } from './rx-profile.js';

export const MAX_MEMORIES_PER_USER = 200;
export const MAX_SHARED_MEMORIES = 200;
const NAME_RE = /^[^\p{Cc}]{1,32}$/u;
const NB_MIN_HZ = BAND_PLAN[0].startHz;
const NB_MAX_HZ = BAND_PLAN.at(-1).endHz;

/** Domain error of the memory store. `status` is the suggested HTTP status. */
export class MemoryError extends Error {
  /**
   * @param {string} code Stable machine-readable code.
   * @param {number} [status]
   */
  constructor(code, status = 400) {
    super(code);
    this.name = 'MemoryError';
    this.code = code;
    this.status = status;
  }
}

// Built-in, read-only presets: the beacon and the default dial frequency of every mode.
/** QO-100 NB presets offered to every user (downlink, Hz). */
export const QO100_PRESETS = Object.freeze([
  Object.freeze({ key: 'bpsk-beacon', name: 'BPSK beacon', downlinkHz: BEACON_DOWNLINK_HZ, mode: 'USB' }),
  Object.freeze({ key: 'cw', name: 'CW segment', downlinkHz: DEFAULT_DIAL_HZ.CW, mode: 'CW' }),
  Object.freeze({ key: 'ft8', name: 'FT8', downlinkHz: DEFAULT_DIAL_HZ.FT8, mode: 'FT8' }),
  Object.freeze({ key: 'ft4', name: 'FT4', downlinkHz: DEFAULT_DIAL_HZ.FT4, mode: 'FT4' }),
  Object.freeze({ key: 'ssb', name: 'SSB', downlinkHz: DEFAULT_DIAL_HZ.USB, mode: 'USB' }),
]);

function parseFields(input) {
  const src = input !== null && typeof input === 'object' ? input : {};
  const errors = {};
  const name = typeof src.name === 'string' ? src.name.trim() : '';
  if (!NAME_RE.test(name)) errors.name = 'invalid';
  const hz = src.downlinkHz;
  if (!Number.isInteger(hz) || hz < NB_MIN_HZ || hz >= NB_MAX_HZ) errors.downlinkHz = 'out_of_range';
  if (typeof src.mode !== 'string' || !MODES.includes(src.mode)) errors.mode = 'invalid';
  let filter = null;
  if (src.filter !== undefined && src.filter !== null) {
    if (typeof src.filter !== 'string' || !filterNames(src.mode).includes(src.filter)) errors.filter = 'invalid';
    else filter = src.filter;
  }
  if (src.shared !== undefined && typeof src.shared !== 'boolean') errors.shared = 'invalid';
  if (Object.keys(errors).length) throw Object.assign(new MemoryError('validation'), { fields: errors });
  return { name, downlinkHz: hz, mode: src.mode, filter, shared: src.shared === true };
}

/**
 * Per-user frequency memories (plus station-wide shared ones that only the owner role manages).
 * Rows of other users are never returned and answer `not_found`, so their existence is not revealed.
 * @param {{db: import('node:sqlite').DatabaseSync, clock?: () => number}} opts
 * @returns {{list(user: object): object[], get(user: object, id: number): object, add(user: object, input: object): object,
 *   update(user: object, id: number, input: object): object, remove(user: object, id: number): void}}
 */
export function createMemoryStore({ db, clock = Date.now }) {
  const publicRow = (r, user) => ({
    id: Number(r.id), name: r.name, downlinkHz: Number(r.downlink_hz), mode: r.mode, filter: r.filter ?? null,
    shared: r.owner === null, mine: r.owner === user.email,
  });
  const find = (id) => db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  const visible = (row, user) => row && (row.owner === null || row.owner === user.email);
  const writable = (row, user) => row.owner === user.email || (row.owner === null && user.role === 'owner');
  const clash = (owner, name, exceptId) => Boolean(db.prepare('SELECT id FROM memories WHERE owner IS ? AND name = ? COLLATE NOCASE AND id <> ?').get(owner, name, exceptId));

  function loadForWrite(user, id) {
    const row = Number.isInteger(id) ? find(id) : undefined;
    if (!visible(row, user)) throw new MemoryError('not_found', 404);
    if (!writable(row, user)) throw new MemoryError('forbidden', 403);
    return row;
  }

  return {
    /** @param {{email: string}} user @returns {object[]} Own and shared memories, sorted by name. */
    list(user) {
      return db.prepare('SELECT * FROM memories WHERE owner IS NULL OR owner = ? ORDER BY name COLLATE NOCASE, id').all(user.email)
        .map((r) => publicRow(r, user));
    },

    /** @param {{email: string}} user @param {number} id @returns {object} @throws {MemoryError} `not_found`. */
    get(user, id) {
      const row = Number.isInteger(id) ? find(id) : undefined;
      if (!visible(row, user)) throw new MemoryError('not_found', 404);
      return publicRow(row, user);
    },

    /**
     * Store a memory.
     * @param {{email: string, role: string}} user
     * @param {{name: string, downlinkHz: number, mode: string, filter?: string|null, shared?: boolean}} input
     * @returns {object} The stored memory.
     * @throws {MemoryError} `validation` (with `fields`), `forbidden`, `duplicate_name`, `too_many_memories`.
     */
    add(user, input) {
      const f = parseFields(input);
      if (f.shared && user.role !== 'owner') throw new MemoryError('forbidden', 403);
      const owner = f.shared ? null : user.email;
      const count = db.prepare('SELECT COUNT(*) AS n FROM memories WHERE owner IS ?').get(owner).n;
      if (count >= (f.shared ? MAX_SHARED_MEMORIES : MAX_MEMORIES_PER_USER)) throw new MemoryError('too_many_memories', 409);
      if (clash(owner, f.name, 0)) throw new MemoryError('duplicate_name', 409);
      const r = db.prepare('INSERT INTO memories (owner, name, downlink_hz, mode, filter, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(owner, f.name, f.downlinkHz, f.mode, f.filter, Math.floor(clock() / 1000));
      return publicRow(find(Number(r.lastInsertRowid)), user);
    },

    /**
     * Edit a memory (its scope, own or shared, cannot change).
     * @param {{email: string, role: string}} user
     * @param {number} id
     * @param {object} input Same fields as `add`; `shared` must be absent or equal to the current scope.
     * @returns {object}
     * @throws {MemoryError} `validation`, `not_found`, `forbidden`, `duplicate_name`.
     */
    update(user, id, input) {
      const row = loadForWrite(user, id);
      const f = parseFields(input);
      if (input.shared !== undefined && f.shared !== (row.owner === null)) throw new MemoryError('forbidden', 403);
      if (clash(row.owner, f.name, row.id)) throw new MemoryError('duplicate_name', 409);
      db.prepare('UPDATE memories SET name = ?, downlink_hz = ?, mode = ?, filter = ? WHERE id = ?').run(f.name, f.downlinkHz, f.mode, f.filter, row.id);
      return publicRow(find(row.id), user);
    },

    /**
     * Delete a memory the user may write to.
     * @param {{email: string, role: string}} user
     * @param {number} id
     * @throws {MemoryError} `not_found`, `forbidden`.
     */
    remove(user, id) {
      const row = loadForWrite(user, id);
      db.prepare('DELETE FROM memories WHERE id = ?').run(row.id);
    },
  };
}

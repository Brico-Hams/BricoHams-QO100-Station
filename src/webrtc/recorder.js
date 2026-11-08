import { mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createWavWriter, fixWavHeader } from './wav.js';
import { getSetting, setSetting } from '../modes/station-db.js';

export const RECORDING_SAMPLE_RATE = 12_000;
const MAX_CONCURRENT = 4;
const MB = 1024 * 1024;

/** Domain error of the recorder. `status` is the suggested HTTP status. */
export class RecordingError extends Error {
  /**
   * @param {string} code Stable machine-readable code.
   * @param {number} [status]
   */
  constructor(code, status = 400) {
    super(code);
    this.name = 'RecordingError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Server-side RX audio recorder (WAV, 12 kHz mono 16-bit) fed by the RX audio tap.
 * Every user owns their files; the owner role can see and delete all of them and can switch recording off at runtime.
 * @param {{db: import('node:sqlite').DatabaseSync, rxAudio: object|null, dir: string, enabled?: boolean, maxFileMb?: number,
 *   maxUserMb?: number, clock?: () => number, logger?: {error: Function}}} opts
 * @returns {object} `{policy, setEnabled, status, start, stop, list, locate, remove, stopAll, recoverUnfinished}`
 */
export function createRecorder({ db, rxAudio, dir, enabled = true, maxFileMb = 100, maxUserMb = 1000, clock = Date.now, logger = console }) {
  const active = new Map(); // email -> {id, writer, untap, row}
  const maxFile = maxFileMb * MB;
  const maxUser = maxUserMb * MB;
  const userDir = (email) => createHash('sha256').update(email).digest('hex').slice(0, 16);
  const pub = (r) => ({
    id: Number(r.id), callsign: r.callsign, startedAt: Number(r.started_at), endedAt: r.ended_at === null ? null : Number(r.ended_at),
    bytes: Number(r.bytes), durationSec: Math.round(Number(r.bytes) / 2 / r.sample_rate), downlinkHz: r.downlink_hz ?? null, mode: r.mode ?? null,
    endReason: r.end_reason ?? null, recording: active.has(r.owner) && active.get(r.owner).id === Number(r.id),
  });
  const runtimeEnabled = () => enabled && getSetting(db, 'recording_enabled') !== '0';
  const usedBytes = (email) => Number(db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM recordings WHERE owner = ?').get(email).n);

  function finish(email, reason) {
    const a = active.get(email);
    if (!a) return null;
    active.delete(email);
    a.untap();
    let bytes = 0;
    try { bytes = a.writer.close(); } catch (err) { logger.error('recording close failed:', err?.message); }
    db.prepare('UPDATE recordings SET ended_at = ?, bytes = ?, end_reason = ? WHERE id = ?').run(Math.floor(clock() / 1000), bytes, reason, a.id);
    return db.prepare('SELECT * FROM recordings WHERE id = ?').get(a.id);
  }

  function ownRow(user, id) {
    const row = Number.isInteger(id) ? db.prepare('SELECT * FROM recordings WHERE id = ?').get(id) : undefined;
    // Same answer for "missing" and "someone else's" so ids of other users are not probeable.
    if (!row || (row.owner !== user.email && user.role !== 'owner')) throw new RecordingError('not_found', 404);
    return row;
  }

  return {
    /** @returns {{enabled: boolean, configEnabled: boolean, maxFileMb: number, maxUserMb: number, available: boolean}} */
    policy: () => ({ enabled: runtimeEnabled(), configEnabled: enabled, maxFileMb, maxUserMb, available: rxAudio !== null }),

    /**
     * Owner switch; it cannot override `recording.enabled=false` of the configuration. Disabling stops running recordings.
     * @param {boolean} on
     */
    setEnabled(on) {
      setSetting(db, 'recording_enabled', on ? '1' : '0');
      if (!on) for (const email of [...active.keys()]) finish(email, 'disabled');
    },

    /** @param {{email: string}} user @returns {object|null} The running recording of the user, if any. */
    status(user) {
      const a = active.get(user.email);
      return a ? pub(db.prepare('SELECT * FROM recordings WHERE id = ?').get(a.id)) : null;
    },

    /**
     * Start recording the RX audio for a user.
     * @param {{email: string, callsign: string}} user
     * @param {{downlinkHz?: number|null, mode?: string|null}} [ctx] Tuning stored as metadata.
     * @returns {object} The new recording.
     * @throws {RecordingError} `recording_disabled` 403, `no_audio_source` 409, `already_recording` 409, `too_many_recordings` 409, `quota_exceeded` 413.
     */
    start(user, ctx = {}) {
      if (!runtimeEnabled()) throw new RecordingError('recording_disabled', 403);
      if (!rxAudio) throw new RecordingError('no_audio_source', 409);
      if (active.has(user.email)) throw new RecordingError('already_recording', 409);
      if (active.size >= MAX_CONCURRENT) throw new RecordingError('too_many_recordings', 409);
      const room = maxUser - usedBytes(user.email);
      if (room < 1 * MB) throw new RecordingError('quota_exceeded', 413);
      const sub = userDir(user.email);
      mkdirSync(join(dir, sub), { recursive: true, mode: 0o700 });
      const stamp = new Date(clock()).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      const rel = `${sub}/rec-${stamp}-${randomBytes(4).toString('hex')}.wav`;
      const writer = createWavWriter({ path: join(dir, sub, rel.split('/')[1]), sampleRate: RECORDING_SAMPLE_RATE, maxBytes: Math.min(maxFile, room) });
      const r = db.prepare('INSERT INTO recordings (owner, callsign, file, sample_rate, downlink_hz, mode, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(user.email, user.callsign ?? '', rel, RECORDING_SAMPLE_RATE, ctx.downlinkHz ?? null, ctx.mode ?? null, Math.floor(clock() / 1000));
      const id = Number(r.lastInsertRowid);
      const untap = rxAudio.addTap((samples) => {
        try {
          if (!writer.write(samples)) setImmediate(() => finish(user.email, writer.full ? 'size_limit' : 'closed'));
        } catch (err) {
          logger.error('recording write failed:', err?.message);
          setImmediate(() => finish(user.email, 'error'));
        }
      });
      active.set(user.email, { id, writer, untap });
      return pub(db.prepare('SELECT * FROM recordings WHERE id = ?').get(id));
    },

    /**
     * Stop the running recording of the user.
     * @param {{email: string}} user
     * @returns {object} The finished recording.
     * @throws {RecordingError} `not_recording` 409.
     */
    stop(user) {
      if (!active.has(user.email)) throw new RecordingError('not_recording', 409);
      return pub(finish(user.email, 'user'));
    },

    /** @param {{email: string, role: string}} user @returns {{items: object[], usedBytes: number, maxUserBytes: number}} Own files, or all for the owner role. */
    list(user) {
      const rows = user.role === 'owner'
        ? db.prepare('SELECT * FROM recordings ORDER BY id DESC LIMIT 500').all()
        : db.prepare('SELECT * FROM recordings WHERE owner = ? ORDER BY id DESC LIMIT 500').all(user.email);
      return { items: rows.map((r) => ({ ...pub(r), ...(user.role === 'owner' ? { owner: r.owner } : {}) })), usedBytes: usedBytes(user.email), maxUserBytes: maxUser };
    },

    /**
     * Resolve a finished recording to a file path for download.
     * @param {{email: string, role: string}} user
     * @param {number} id
     * @returns {{path: string, name: string, size: number}}
     * @throws {RecordingError} `not_found` 404, `still_recording` 409.
     */
    locate(user, id) {
      const row = ownRow(user, id);
      if (row.ended_at === null) throw new RecordingError('still_recording', 409);
      const path = join(dir, row.file.split('/')[0], row.file.split('/')[1]);
      if (!existsSync(path)) throw new RecordingError('not_found', 404);
      return { path, name: row.file.split('/')[1], size: statSync(path).size };
    },

    /**
     * Delete a finished recording (file and row).
     * @param {{email: string, role: string}} user
     * @param {number} id
     * @throws {RecordingError} `not_found` 404, `still_recording` 409.
     */
    remove(user, id) {
      const row = ownRow(user, id);
      if (row.ended_at === null) throw new RecordingError('still_recording', 409);
      rmSync(join(dir, row.file.split('/')[0], row.file.split('/')[1]), { force: true });
      db.prepare('DELETE FROM recordings WHERE id = ?').run(row.id);
    },

    /** Stop every running recording (shutdown, logout of the last session...). */
    stopAll(reason = 'shutdown') {
      for (const email of [...active.keys()]) finish(email, reason);
    },

    /** Repair headers of recordings left open by a crash and mark them finished. @returns {number} Rows repaired. */
    recoverUnfinished() {
      const rows = db.prepare('SELECT * FROM recordings WHERE ended_at IS NULL').all();
      for (const r of rows) {
        let bytes = 0;
        try { bytes = Math.max(0, fixWavHeader(join(dir, r.file.split('/')[0], r.file.split('/')[1]))); } catch { /* file missing: keep 0 bytes */ }
        db.prepare('UPDATE recordings SET ended_at = ?, bytes = ?, end_reason = ? WHERE id = ?').run(Math.floor(clock() / 1000), bytes, 'recovered', r.id);
      }
      return rows.length;
    },
  };
}

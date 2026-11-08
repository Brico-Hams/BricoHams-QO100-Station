import { createHash, randomBytes } from 'node:crypto';
import { getSetting, setSetting } from '../modes/station-db.js';
import { RecordingError } from '../webrtc/recorder.js';

const MB = 1024 * 1024;
const FILE_SINK = 'FileSink';

/**
 * I/Q recording and playback driven entirely through SDRangel (the samples never pass through Node).
 * Recording uses a FileSink channel on the RX device set; playback swaps the RX hardware for a FileInput and back.
 * Policy mirrors the WAV recorder: config switch, owner runtime switch, per-user disk quota, per-user isolation.
 * Nothing here touches the TX device set or the PTT.
 * @param {{db: import('node:sqlite').DatabaseSync, client: object, rxDeviceSet?: number, enabled?: boolean, maxUserMb?: number,
 *   maxSeconds?: number, clock?: () => number, timers?: {setTimeout: Function, clearTimeout: Function},
 *   onLive?: () => Promise<void>, logger?: {error: Function}}} opts
 * @returns {object} `{policy, setEnabled, status, list, start, stop, remove, playback, live}`
 */
export function createIqManager({
  db, client, rxDeviceSet = 0, enabled = false, maxUserMb = 2000, maxSeconds = 600, clock = Date.now,
  timers = { setTimeout, clearTimeout }, onLive = async () => {}, logger = console,
}) {
  let active = null; // {id, owner, channel, timer}
  let playing = null; // {id, liveHwType}
  const maxUser = maxUserMb * MB;
  const runtimeEnabled = () => enabled && getSetting(db, 'iq_enabled') !== '0';
  const usedBytes = (email) => Number(db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM iq_recordings WHERE owner = ?').get(email).n);
  const pub = (r) => ({
    id: Number(r.id), callsign: r.callsign, file: r.file, centerHz: r.center_hz ?? null, startedAt: Number(r.started_at),
    endedAt: r.ended_at === null ? null : Number(r.ended_at), bytes: Number(r.bytes), endReason: r.end_reason ?? null,
    recording: active?.id === Number(r.id), playing: playing?.id === Number(r.id),
  });

  function ownRow(user, id) {
    const row = Number.isInteger(id) ? db.prepare('SELECT * FROM iq_recordings WHERE id = ?').get(id) : undefined;
    // Same answer for "missing" and "someone else's" so ids of other users are not probeable.
    if (!row || (row.owner !== user.email && user.role !== 'owner')) throw new RecordingError('not_found', 404);
    return row;
  }

  async function ensureSink() {
    const ds = await client.getDeviceSet(rxDeviceSet);
    let idx = (ds.channels ?? []).findLastIndex((c) => c.id === FILE_SINK);
    if (idx < 0) {
      await client.addChannel(rxDeviceSet, FILE_SINK, 0);
      idx = ((await client.getDeviceSet(rxDeviceSet)).channels ?? []).findLastIndex((c) => c.id === FILE_SINK);
      if (idx < 0) throw new Error('SDRangel did not create the FileSink channel');
    }
    return idx;
  }

  async function finish(reason) {
    const a = active;
    if (!a) return null;
    active = null;
    timers.clearTimeout(a.timer);
    let bytes = 0;
    try {
      // verify against SDRangel swagger: `record` flag and the `recordSize` report field of the FileSink channel.
      await client.patchChannelSettings(rxDeviceSet, a.channel, { record: false });
      const report = await client.getChannelReport(rxDeviceSet, a.channel);
      bytes = Number(report?.fileSinkSettings?.recordSize ?? 0) || 0;
    } catch (err) {
      logger.error('I/Q stop failed:', err?.message);
      reason = 'error';
    }
    db.prepare('UPDATE iq_recordings SET ended_at = ?, bytes = ?, end_reason = ? WHERE id = ?').run(Math.floor(clock() / 1000), bytes, reason, a.id);
    return db.prepare('SELECT * FROM iq_recordings WHERE id = ?').get(a.id);
  }

  return {
    /** @returns {object} Policy plus the current playback, if any. */
    policy: () => ({ enabled: runtimeEnabled(), configEnabled: enabled, maxUserMb, maxSeconds, playing: playing ? { id: playing.id } : null }),

    /**
     * Owner switch; it cannot override `iq.enabled=false`. Disabling stops a running recording.
     * @param {boolean} on
     * @returns {Promise<void>}
     */
    async setEnabled(on) {
      setSetting(db, 'iq_enabled', on ? '1' : '0');
      if (!on) await finish('disabled');
    },

    /** @returns {object|null} The running recording, if any. */
    status() {
      return active ? pub(db.prepare('SELECT * FROM iq_recordings WHERE id = ?').get(active.id)) : null;
    },

    /**
     * @param {{email: string, role: string}} user
     * @returns {{items: object[], usedBytes: number}} Own recordings (the owner sees everyone's).
     */
    list(user) {
      const rows = user.role === 'owner'
        ? db.prepare('SELECT * FROM iq_recordings ORDER BY id DESC').all()
        : db.prepare('SELECT * FROM iq_recordings WHERE owner = ? ORDER BY id DESC').all(user.email);
      return { items: rows.map(pub), usedBytes: usedBytes(user.email) };
    },

    /**
     * Start recording I/Q on the RX device set.
     * @param {{email: string, callsign?: string}} user
     * @param {{centerHz?: number|null}} [ctx] Stored as metadata.
     * @returns {Promise<object>}
     * @throws {RecordingError} `iq_disabled` 403, `already_recording` 409, `playback_active` 409, `quota_exceeded` 413.
     */
    async start(user, ctx = {}) {
      if (!runtimeEnabled()) throw new RecordingError('iq_disabled', 403);
      if (active) throw new RecordingError('already_recording', 409);
      if (playing) throw new RecordingError('playback_active', 409);
      if (maxUser - usedBytes(user.email) < 1 * MB) throw new RecordingError('quota_exceeded', 413);
      const sub = createHash('sha256').update(user.email).digest('hex').slice(0, 8);
      const stamp = new Date(clock()).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      const file = `iq-${sub}-${stamp}-${randomBytes(3).toString('hex')}`;
      const channel = await ensureSink();
      // verify against SDRangel swagger: FileSink settings keys `fileRecordName` and `record`.
      await client.patchChannelSettings(rxDeviceSet, channel, { fileRecordName: file, record: true });
      const r = db.prepare('INSERT INTO iq_recordings (owner, callsign, file, center_hz, started_at) VALUES (?, ?, ?, ?, ?)')
        .run(user.email, user.callsign ?? '', file, ctx.centerHz ?? null, Math.floor(clock() / 1000));
      const id = Number(r.lastInsertRowid);
      const timer = timers.setTimeout(() => { finish('time_limit').catch(() => {}); }, maxSeconds * 1000);
      timer.unref?.();
      active = { id, owner: user.email, channel, timer };
      return pub(db.prepare('SELECT * FROM iq_recordings WHERE id = ?').get(id));
    },

    /**
     * Stop the running recording (its owner or the station owner).
     * @param {{email: string, role: string}} user
     * @returns {Promise<object>}
     * @throws {RecordingError} `not_recording` 409.
     */
    async stop(user) {
      if (!active || (active.owner !== user.email && user.role !== 'owner')) throw new RecordingError('not_recording', 409);
      return pub(await finish('stopped'));
    },

    /**
     * Delete a recording row and, best effort, the file on the SDRangel host.
     * @param {{email: string, role: string}} user
     * @param {number} id
     * @returns {Promise<void>}
     * @throws {RecordingError} `not_found` 404, `recording_in_progress` 409.
     */
    async remove(user, id) {
      const row = ownRow(user, id);
      if (active?.id === Number(row.id) || playing?.id === Number(row.id)) throw new RecordingError('recording_in_progress', 409);
      try {
        await client.deleteIqFile(row.file);
      } catch (err) {
        logger.error('I/Q file delete on SDRangel failed:', err?.message);
      }
      db.prepare('DELETE FROM iq_recordings WHERE id = ?').run(row.id);
    },

    /**
     * Switch the RX device set to a FileInput playing a recording. Live reception is restored with `live()`.
     * @param {{email: string, role: string}} user
     * @param {number} id
     * @returns {Promise<object>}
     * @throws {RecordingError} `iq_disabled` 403, `not_found` 404, `recording_in_progress` 409, `already_playing` 409.
     */
    async playback(user, id) {
      if (!runtimeEnabled()) throw new RecordingError('iq_disabled', 403);
      const row = ownRow(user, id);
      if (active) throw new RecordingError('recording_in_progress', 409);
      if (playing) throw new RecordingError('already_playing', 409);
      if (row.ended_at === null) throw new RecordingError('recording_in_progress', 409);
      const summary = await client.getDeviceSet(rxDeviceSet);
      const liveHwType = summary?.samplingDevice?.hwType;
      if (typeof liveHwType !== 'string') throw new RecordingError('no_rx_device', 409);
      // verify against SDRangel swagger: FileInput settings key `fileName` and the run endpoint after a device switch.
      await client.switchDevice(rxDeviceSet, 'FileInput', 0);
      playing = { id: Number(row.id), liveHwType };
      try {
        await client.patchDeviceSettings(rxDeviceSet, { fileName: row.file });
        await client.setRunning(rxDeviceSet, true);
      } catch (err) {
        await this.live(user).catch(() => {});
        throw err;
      }
      return { playing: { id: Number(row.id) } };
    },

    /**
     * Return the RX device set to its live hardware and re-apply the tuning.
     * @param {{email: string, role: string}} _user
     * @returns {Promise<object>}
     * @throws {RecordingError} `not_playing` 409.
     */
    async live(_user) {
      if (!playing) throw new RecordingError('not_playing', 409);
      const { liveHwType } = playing;
      playing = null;
      await client.switchDevice(rxDeviceSet, liveHwType, 0);
      await client.setRunning(rxDeviceSet, true);
      await onLive();
      return { playing: null };
    },

    /** Stop a running recording on shutdown. @returns {Promise<void>} */
    async stopAll() {
      await finish('shutdown');
    },
  };
}

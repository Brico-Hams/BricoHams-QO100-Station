import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS = Object.freeze([
  {
    version: 1,
    sql: `
      CREATE TABLE memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner TEXT,
        name TEXT NOT NULL,
        downlink_hz INTEGER NOT NULL,
        mode TEXT NOT NULL,
        filter TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX memories_owner ON memories (owner);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE recordings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner TEXT NOT NULL,
        callsign TEXT NOT NULL,
        file TEXT NOT NULL,
        sample_rate INTEGER NOT NULL,
        downlink_hz INTEGER,
        mode TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        bytes INTEGER NOT NULL DEFAULT 0,
        end_reason TEXT
      );
      CREATE INDEX recordings_owner ON recordings (owner);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE iq_recordings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner TEXT NOT NULL,
        callsign TEXT NOT NULL,
        file TEXT NOT NULL,
        center_hz INTEGER,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        bytes INTEGER NOT NULL DEFAULT 0,
        end_reason TEXT
      );
      CREATE INDEX iq_recordings_owner ON iq_recordings (owner);
    `,
  },
]);

/**
 * Open (and migrate) the station database that holds frequency memories, recording metadata and small settings.
 * It is separate from the logbook so the QSO file stays a clean artefact to back up and share.
 * @param {string} path File path or `:memory:`.
 * @returns {import('node:sqlite').DatabaseSync}
 */
export function openStationDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY)');
  const applied = new Set(db.prepare('SELECT version FROM migrations').all().map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO migrations (version) VALUES (?)').run(m.version);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

/**
 * Read a small string setting.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} key
 * @returns {string|null}
 */
export function getSetting(db, key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
}

/**
 * Write a small string setting.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} key
 * @param {string} value
 */
export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

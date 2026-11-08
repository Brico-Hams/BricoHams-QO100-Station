import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Append-only JSON-lines audit log.
 * @param {{path: string, clock?: {now(): number}}} opts
 * @returns {{record(entry: object): void}} `record` throws if the line cannot be written.
 */
export function createFileAudit({ path, clock = { now: Date.now } }) {
  mkdirSync(dirname(path), { recursive: true });
  return {
    record(entry) {
      const line = JSON.stringify({ ts: new Date(clock.now()).toISOString(), ...entry });
      appendFileSync(path, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
    },
  };
}

import { createHash } from 'node:crypto';

/**
 * In-memory ring of recent QO-100 spots, newest first. The same station on the same frequency (within 100 Hz) replaces the earlier entry.
 * @param {{maxSpots?: number, maxAgeMs?: number, now?: () => number}} [opts]
 * @returns {{add(spot: object, source?: 'cluster'|'local'): object, list(): object[], clear(): void}}
 */
export function createSpotStore({ maxSpots = 200, maxAgeMs = 3_600_000, now = Date.now } = {}) {
  let spots = [];
  const prune = () => {
    const cutoff = now() - maxAgeMs;
    spots = spots.filter((s) => s.time >= cutoff).slice(0, maxSpots);
  };
  return {
    /**
     * @param {{spotter: string, dx: string, downlinkHz: number, uplinkHz: number, comment: string, time: number}} spot
     * @param {'cluster'|'local'} [source]
     * @returns {object} The stored spot (with `id` and `source`).
     */
    add(spot, source = 'cluster') {
      const id = createHash('sha1').update(`${spot.dx}|${Math.round(spot.downlinkHz / 100)}|${spot.time}`).digest('hex').slice(0, 12);
      const stored = {
        id, source, spotter: spot.spotter, dx: spot.dx, downlinkHz: spot.downlinkHz, uplinkHz: spot.uplinkHz, comment: spot.comment, time: spot.time,
      };
      spots = spots.filter((s) => !(s.dx === stored.dx && Math.abs(s.downlinkHz - stored.downlinkHz) < 100));
      spots.unshift(stored);
      prune();
      return stored;
    },
    /** @returns {object[]} Current spots, newest first. */
    list() {
      prune();
      return spots.map((s) => ({ ...s }));
    },
    /** Forget every spot. */
    clear() {
      spots = [];
    },
  };
}

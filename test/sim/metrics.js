// Shared collection of simulation metrics. `node --test` runs every *.sim.test.js file in its own process, so results are
// persisted as one JSON file per scenario in a scratch directory and merged by report.js.
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

/** Directory holding the per-scenario JSON files (override with SIM_RESULTS_DIR). */
export const RESULTS_DIR = process.env.SIM_RESULTS_DIR || join(tmpdir(), 'bricohams-qo100-sim-results');

/** In-process results object: `results[scenario] = {cases: [...], metrics: {...}}`. */
export const results = {};

function entry(scenario) {
  results[scenario] ??= { scenario, cases: [], metrics: {}, savedAt: null };
  return results[scenario];
}

/**
 * Store a metric for a scenario.
 * @param {string} scenario
 * @param {string} key
 * @param {unknown} value JSON-serializable.
 */
export function record(scenario, key, value) {
  entry(scenario).metrics[key] = value;
}

/**
 * Persist the scenario results (atomic rename, safe with concurrent scenario processes).
 * @param {string} scenario
 */
export function saveResults(scenario) {
  const e = entry(scenario);
  e.savedAt = new Date().toISOString();
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, `${scenario}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(e));
  renameSync(tmp, file);
}

/**
 * Load every persisted scenario result that is not older than `maxAgeMs`.
 * @param {number} [maxAgeMs] Stale files from earlier runs are ignored.
 * @returns {Record<string, {scenario: string, cases: Array<{title: string, status: string, ms: number, error?: string}>, metrics: object, savedAt: string}>}
 */
export function loadResults(maxAgeMs = 6 * 3600_000) {
  const out = {};
  let names = [];
  try {
    names = readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return out;
  }
  for (const f of names) {
    try {
      const e = JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf8'));
      if (Date.now() - Date.parse(e.savedAt) <= maxAgeMs) out[e.scenario] = e;
    } catch {
      // half-written or foreign file: ignore
    }
  }
  return out;
}

/**
 * Nearest-rank percentile.
 * @param {number[]} values
 * @param {number} p 0..100
 * @returns {number} NaN for an empty list.
 */
export function percentile(values, p) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

let reporterHooked = false;

/**
 * Register a scenario test whose pass/fail and duration are recorded for the report. After the last test of the file the
 * report is regenerated from every scenario result available so far.
 * @param {string} scenario Short id, e.g. `beacon`.
 * @param {string} title
 * @param {(t: import('node:test').TestContext) => Promise<void>|void} fn
 * @param {import('node:test').TestOptions} [opts]
 */
export function simTest(scenario, title, fn, opts = {}) {
  if (!reporterHooked) {
    reporterHooked = true;
    after(async () => {
      try {
        const { writeReport } = await import('./report.js');
        writeReport();
      } catch (err) {
        console.error('sim-report not written:', err.message);
      }
    });
  }
  test(title, { timeout: 280_000, ...opts }, async (t) => {
    const started = Date.now();
    try {
      await fn(t);
      entry(scenario).cases.push({ title, status: 'pass', ms: Date.now() - started });
    } catch (err) {
      entry(scenario).cases.push({ title, status: 'fail', ms: Date.now() - started, error: String(err?.message ?? err).slice(0, 300) });
      throw err;
    } finally {
      saveResults(scenario);
    }
  });
}

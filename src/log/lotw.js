import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toAdif } from './adif.js';

/**
 * TQSL exit codes (TQSL documentation, "Command line" section) mapped to a status.
 * `ok` means LoTW accepted the upload; `storeStatus` is the value saved in the logbook.
 */
export const EXIT_CODES = Object.freeze({
  0: { status: 'uploaded', ok: true, storeStatus: 'uploaded', message: 'Uploaded to LoTW.' },
  1: { status: 'cancelled', ok: false, storeStatus: 'failed', message: 'TQSL was cancelled (for example a certificate password prompt was dismissed).' },
  2: { status: 'rejected', ok: false, storeStatus: 'failed', message: 'LoTW rejected the upload.' },
  3: { status: 'error', ok: false, storeStatus: 'failed', message: 'Unexpected response from the LoTW server.' },
  4: { status: 'error', ok: false, storeStatus: 'failed', message: 'TQSL reported an error.' },
  5: { status: 'error', ok: false, storeStatus: 'failed', message: 'TQSL library error.' },
  6: { status: 'file_error', ok: false, storeStatus: 'failed', message: 'TQSL could not open the input file.' },
  7: { status: 'file_error', ok: false, storeStatus: 'failed', message: 'TQSL could not write its output file.' },
  8: { status: 'duplicate', ok: true, storeStatus: 'duplicate', message: 'All QSOs were duplicates or outside the certificate date range; nothing was uploaded.' },
  9: { status: 'uploaded_with_duplicates', ok: true, storeStatus: 'uploaded', message: 'Uploaded; some QSOs were duplicates or outside the certificate date range.' },
  10: { status: 'usage_error', ok: false, storeStatus: 'failed', message: 'TQSL rejected the command-line arguments.' },
  11: { status: 'network_error', ok: false, storeStatus: 'failed', message: 'Could not reach LoTW (network down or LoTW unavailable).' },
});

/**
 * Translate a TQSL exit code or spawn failure into a result.
 * @param {number|string|null} code Numeric exit code, or a spawn error code such as 'ENOENT'.
 * @returns {{status: string, ok: boolean, storeStatus: string, message: string, exitCode: number|string|null}}
 */
export function mapExitCode(code) {
  const known = typeof code === 'number' ? EXIT_CODES[code] : undefined;
  if (known) return { ...known, exitCode: code };
  if (code === 'ENOENT') {
    return { status: 'not_found', ok: false, storeStatus: 'failed', message: 'The tqsl executable was not found; check the configured path.', exitCode: code };
  }
  if (code === 'TIMEOUT') {
    return { status: 'timeout', ok: false, storeStatus: 'failed', message: 'TQSL did not finish in time.', exitCode: code };
  }
  return { status: 'error', ok: false, storeStatus: 'failed', message: 'TQSL failed with an unexpected exit code.', exitCode: code };
}

/**
 * Default runner: execFile without a shell, so arguments are never interpreted.
 * @param {string} file Executable.
 * @param {string[]} args
 * @param {{timeoutMs: number}} opts
 * @returns {Promise<{exitCode: number|string, stdout: string, stderr: string}>}
 */
export function defaultRunner(file, args, { timeoutMs }) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, shell: false, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      if (!err) return resolve({ exitCode: 0, stdout, stderr });
      if (err.killed) return resolve({ exitCode: 'TIMEOUT', stdout, stderr });
      resolve({ exitCode: typeof err.code === 'number' ? err.code : String(err.code ?? 'ERROR'), stdout, stderr });
    });
  });
}

/**
 * Create a LoTW uploader that drives the TQSL command line.
 * The user installs TQSL and manages certificates and station locations in TQSL itself;
 * BricoHams never reads or stores certificates or their passwords.
 * @param {{tqslPath: string, stationLocation: string, runner?: Function, tmpDir?: string, timeoutMs?: number}} opts
 * @returns {{upload: (qsos: object[]) => Promise<object>, buildArgs: (file: string) => string[]}}
 */
export function createLotwUploader({ tqslPath, stationLocation, runner = defaultRunner, tmpDir = tmpdir(), timeoutMs = 120_000 }) {
  if (typeof tqslPath !== 'string' || tqslPath === '') throw new TypeError('tqslPath required');
  if (typeof stationLocation !== 'string' || stationLocation === '' || stationLocation.startsWith('-')) {
    throw new TypeError('stationLocation must be a non-empty name not starting with "-"');
  }
  const buildArgs = (file) => ['-q', '-d', '-u', '-a', 'compliant', '-l', stationLocation, '-x', file];
  return {
    buildArgs,
    /**
     * Sign and upload QSOs. The temporary ADIF file is always removed.
     * @param {object[]} qsos Non-empty list as returned by the store.
     * @returns {Promise<{status: string, ok: boolean, storeStatus: string, message: string, exitCode: number|string|null}>}
     */
    async upload(qsos) {
      if (!Array.isArray(qsos) || qsos.length === 0) throw new TypeError('no QSOs to upload');
      const dir = await mkdtemp(join(tmpDir, 'bricohams-lotw-'));
      const file = join(dir, 'upload.adi');
      try {
        await writeFile(file, toAdif(qsos), { mode: 0o600 });
        const r = await runner(tqslPath, buildArgs(file), { timeoutMs });
        return mapExitCode(r.exitCode);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

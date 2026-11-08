import { randomInt, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CODE_RE = /^\d{8}$/;

/**
 * One-time LOCKOUT reset code, delivered out of band through a file in the server's data directory.
 *
 * Why a file: reading it requires local access to the host, which a remote owner session (even behind a same-host
 * reverse proxy) does not have. The code is never logged; only the file path is.
 * Invariants: a code is valid for one successful reset, rotates on every `rotate()` (each LOCKOUT) and after
 * `maxBadAttempts` wrong guesses, so an owner session cannot brute-force the 8 digits.
 * @param {{path: string, maxBadAttempts?: number, logger?: {error: Function, info?: Function}}} opts
 * @returns {{rotate(): string|null, check(code: unknown): boolean, consume(): void, path: string}}
 */
export function createResetCode({ path, maxBadAttempts = 5, logger = console }) {
  if (typeof path !== 'string' || !path) throw new TypeError('reset code path required');
  let current = null;
  let bad = 0;

  function removeFile() {
    try {
      unlinkSync(path);
    } catch {
      // Already gone or unreadable: nothing else to do.
    }
  }

  const self = {
    path,

    /**
     * Generate a fresh code (invalidating the previous one) and write it to the file with mode 0600 where supported.
     * @returns {string|null} The file path, or null if the code could not be stored (then no reset is possible until the next rotation).
     */
    rotate() {
      const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${code}\n`, { mode: 0o600 });
        try {
          chmodSync(path, 0o600); // writeFileSync only applies the mode when it creates the file
        } catch {
          // Windows and some filesystems have no POSIX modes.
        }
      } catch (err) {
        current = null;
        logger.error('ptt: cannot write reset code file:', err.code ?? 'error');
        return null;
      }
      current = code;
      bad = 0;
      logger.info?.(`reset code written to ${path}`);
      return path;
    },

    /**
     * Compare a submitted code with the current one in constant time. Does not consume it.
     * @param {unknown} code
     * @returns {boolean}
     */
    check(code) {
      if (current === null) return false;
      let ok = false;
      if (typeof code === 'string' && CODE_RE.test(code)) {
        ok = timingSafeEqual(Buffer.from(code), Buffer.from(current));
      }
      if (!ok && ++bad >= maxBadAttempts) self.rotate();
      return ok;
    },

    /** Invalidate the code and delete the file (single use). */
    consume() {
      current = null;
      bad = 0;
      removeFile();
    },
  };
  return self;
}

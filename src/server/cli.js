#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';

const USAGE = `Usage: node src/server/cli.js reset-lockout [--show]

reset-lockout   Explain how to clear a PTT LOCKOUT and print where the one-time reset code is stored.
  --show        Also print the current reset code (requires read access to the code file).
`;

/**
 * Command line helper for station maintenance. It never talks to the network: the one-time reset code lives in a file
 * only a local user can read, which is what proves local access.
 * @param {string[]} argv Arguments after the script name.
 * @param {{env?: object, out?: (s: string) => void, err?: (s: string) => void,
 *   loadConfig?: Function, readFile?: Function}} [deps]
 * @returns {number} Process exit code.
 */
export function runCli(argv, deps = {}) {
  const { env = process.env, out = console.log, err = console.error, readFile = readFileSync } = deps;
  const load = deps.loadConfig ?? loadConfig;
  const [command, ...flags] = argv;
  if (command !== 'reset-lockout' || flags.some((f) => f !== '--show')) {
    err(USAGE);
    return 2;
  }
  let path;
  try {
    path = load({ env }).resetCodePath;
  } catch (e) {
    err(`cannot load configuration: ${e.message}`);
    return 1;
  }
  out(`LOCKOUT reset code file: ${path}`);
  out('1. Sign in to the web app as an owner.');
  out('2. Send the 8-digit code from that file to POST /api/ptt/reset ({"code":"<8 digits>"}); the code works once.');
  out('A new code is written every time the station enters LOCKOUT.');
  if (flags.includes('--show')) {
    try {
      const code = String(readFile(path, 'utf8')).trim();
      if (!/^\d{8}$/.test(code)) throw new Error('unexpected content');
      out(`Current code: ${code}`);
    } catch {
      err('no valid reset code found: the station is probably not in LOCKOUT.');
      return 1;
    }
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = runCli(process.argv.slice(2));
}

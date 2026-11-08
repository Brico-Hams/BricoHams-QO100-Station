import net from 'node:net';
import { cleanText, isCallsign, parseQo100Spot } from './parser.js';

const IAC = 255;
const MAX_LINE = 400;
const MAX_BUFFER = 8192;
const PROMPT_RE = /(login|call(sign)?|your call)[^\r\n]*:\s*$/i;

/**
 * Exponential reconnect delay.
 * @param {number} attempt 0-based failed attempts so far.
 * @param {{baseMs?: number, maxMs?: number}} [opts]
 * @returns {number} Delay in ms.
 */
export function backoffDelay(attempt, { baseMs = 1000, maxMs = 300_000 } = {}) {
  return Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 20));
}

// Answer telnet option negotiation with a refusal and strip it from the text stream.
function stripTelnet(buf, socket) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== IAC) { out.push(buf[i]); continue; }
    const cmd = buf[i + 1];
    if (cmd === IAC) { out.push(IAC); i++; } else if (cmd >= 251 && cmd <= 254) {
      if (buf[i + 2] !== undefined) socket.write(Buffer.from([IAC, cmd === 253 ? 252 : cmd === 251 ? 254 : cmd, buf[i + 2]]));
      i += 2;
    } else i += 1;
  }
  return Buffer.from(out);
}

/**
 * Telnet DX cluster client. Connects only after `start()` (the caller decides whether the owner enabled it), logs in with the
 * station callsign, parses `DX de` lines, keeps QO-100 NB spots and reconnects with exponential backoff.
 * @param {{host: string, port: number, callsign: string, onSpot: (spot: object) => void, onStatus?: (s: object) => void,
 *   connect?: (opts: {host: string, port: number}) => import('node:events').EventEmitter, timers?: {setTimeout: Function, clearTimeout: Function},
 *   now?: () => number, baseMs?: number, maxMs?: number, allowPost?: boolean, logger?: {error: Function}}} opts
 * @returns {{start(): void, stop(): void, status(): object, post(spot: {dx: string, downlinkHz: number, comment?: string}): void}}
 */
export function createClusterClient({
  host, port, callsign, onSpot, onStatus = () => {}, connect = (o) => net.connect(o), timers = { setTimeout, clearTimeout },
  now = Date.now, baseMs = 1000, maxMs = 300_000, allowPost = false, logger = console,
}) {
  let socket = null;
  let timer = null;
  let running = false;
  let attempt = 0;
  let state = 'stopped'; // stopped | connecting | login | online | waiting
  let pending = '';
  let loggedIn = false;
  let nextRetryMs = null;

  const publish = () => onStatus({ state, attempt, nextRetryMs });
  const setState = (s) => { state = s; publish(); };

  function schedule() {
    if (!running) return;
    nextRetryMs = backoffDelay(attempt, { baseMs, maxMs });
    attempt += 1;
    setState('waiting');
    timer = timers.setTimeout(() => { timer = null; open(); }, nextRetryMs);
    timer.unref?.();
  }

  function onLine(line) {
    const spot = parseQo100Spot(line, now());
    if (spot) {
      attempt = 0;
      onSpot(spot);
    }
  }

  function onData(chunk) {
    const text = stripTelnet(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), socket).toString('latin1');
    pending = (pending + text).slice(-MAX_BUFFER);
    if (!loggedIn && PROMPT_RE.test(pending)) {
      loggedIn = true;
      socket.write(`${callsign}\r\n`);
      pending = '';
      setState('online');
      return;
    }
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const l of lines) if (l.length <= MAX_LINE) onLine(l);
  }

  function open() {
    if (!running) return;
    loggedIn = false;
    pending = '';
    setState('connecting');
    let s;
    try {
      s = connect({ host, port });
    } catch (err) {
      logger.error('cluster connect failed:', err?.message);
      schedule();
      return;
    }
    socket = s;
    let closed = false;
    const lost = () => {
      if (closed) return;
      closed = true;
      if (socket === s) socket = null;
      schedule();
    };
    s.on('connect', () => setState('login'));
    s.on('data', (d) => { if (socket === s) onData(d); });
    s.on('error', (err) => logger.error('cluster socket error:', err?.code ?? err?.message));
    s.on('close', lost);
  }

  return {
    /** Start connecting (idempotent). */
    start() {
      if (running) return;
      running = true;
      attempt = 0;
      open();
    },

    /** Disconnect and stop reconnecting. */
    stop() {
      running = false;
      if (timer) timers.clearTimeout(timer);
      timer = null;
      socket?.destroy?.();
      socket = null;
      nextRetryMs = null;
      setState('stopped');
    },

    /** @returns {{state: string, attempt: number, nextRetryMs: number|null}} */
    status: () => ({ state, attempt, nextRetryMs }),

    /**
     * Send a spot to the cluster. Needs `allowPost` (owner config) and an online connection.
     * @param {{dx: string, downlinkHz: number, comment?: string}} spot
     * @throws {Error} `posting_disabled`, `not_connected`, `bad_spot`.
     */
    post({ dx, downlinkHz, comment = '' }) {
      if (!allowPost) throw new Error('posting_disabled');
      if (state !== 'online' || !socket) throw new Error('not_connected');
      if (!isCallsign(dx) || !Number.isFinite(downlinkHz)) throw new Error('bad_spot');
      socket.write(`DX ${(downlinkHz / 1000).toFixed(1)} ${dx} ${cleanText(comment, 60)}\r\n`);
    },
  };
}

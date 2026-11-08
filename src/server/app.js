import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  AuthError, LOGIN_COOKIE, SESSION_COOKIE, createAuth, createGoogleOidc, serializeCookie, parseCookies,
} from '../auth/index.js';
import { createPtt } from '../ptt/index.js';
import { createFileAudit } from '../ptt/audit.js';
import { createSdrangelClient, SdrangelError } from '../sdrangel/client.js';
import { createSdrangelPttDriver } from '../sdrangel/ptt-driver.js';
import { createStation, StationError } from '../modes/index.js';
import { createBeaconController } from '../beacon/index.js';
import { isLoopbackHost } from './config.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const WS_PATH = '/ws/control';
const WS_MAX_PAYLOAD = 4096;
const SESSION_MAX_AGE_SEC = 12 * 3600;

/**
 * Build the security headers for a response.
 * @param {{https: boolean, wsOrigin: string}} opts
 * @returns {Record<string, string>}
 */
export function securityHeaders({ https: isHttps, wsOrigin }) {
  const headers = {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      `connect-src 'self' ${wsOrigin}`,
      "media-src 'self' blob:",
      "worker-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  };
  if (isHttps) headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains';
  return headers;
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function sendHtml(res, status, html, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(html);
}

function isLocalRequest(req) {
  return isLoopbackHost(req.socket.remoteAddress ?? '');
}

const MAX_JSON_BYTES = 4096;

class BadRequest extends Error {}

async function readJson(req) {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new BadRequest('content_type');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new BadRequest('too_large');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('shape');
    return body;
  } catch {
    throw new BadRequest('bad_json');
  }
}

/**
 * Create the BricoHams application (HTTP(S) server, JSON API and WSS control channel).
 * Nothing is listening until `listen()` is called.
 * @param {Readonly<object>} config Validated config (see config.js).
 * @param {{oidc?: object, driver?: object, audit?: object, clock?: object, publicDir?: string, sdrangel?: object,
 *   spectrumSource?: () => Promise<{powersDb: ArrayLike<number>, centerHz: number, binHz: number}|null>, beaconAutoStart?: boolean,
 *   logger?: {error: Function, info?: Function}, tlsCredentials?: {cert: Buffer, key: Buffer}}} [deps] Injectable collaborators for tests.
 * @returns {{server: import('node:http').Server, ptt: object, auth: object, station: object, beacon: object|null, listen: () => Promise<{port: number, url: string}>, close: () => Promise<void>}}
 */
export function createApp(config, deps = {}) {
  const logger = deps.logger ?? console;
  const useTls = Boolean(config.tls);
  let publicUrl = new URL(config.publicUrl);
  const publicDir = deps.publicDir ?? fileURLToPath(new URL('../web/public', import.meta.url));

  const oidc = deps.oidc ?? createGoogleOidc(config.google);
  const audit = deps.audit ?? createFileAudit({ path: config.auditLogPath });
  const sdr = deps.sdrangel ?? createSdrangelClient({ baseUrl: config.sdrangel.baseUrl });
  const ptt = createPtt({
    tx: config.tx,
    driver: deps.driver ?? createSdrangelPttDriver({ client: sdr, txDeviceSet: config.station.txDeviceSet }),
    audit,
    clock: deps.clock,
    logger,
  });
  const station = createStation({
    client: sdr,
    rxDeviceSet: config.station.rxDeviceSet,
    txDeviceSet: config.station.txDeviceSet,
    lnbLoHz: config.station.lnbLoHz,
    applyToTx: config.station.applyCorrectionToTx,
    isTxActive: () => ptt.state === 'TX_ON',
    logger,
  });
  const beacon = deps.spectrumSource
    ? createBeaconController({
      getSpectrum: deps.spectrumSource,
      station,
      lnbLoHz: config.station.lnbLoHz,
      onStatus: (s) => broadcast({ type: 'beacon', ...publicBeacon(s) }),
      logger,
    })
    : null;
  const publicBeacon = (s) => ({
    status: s.status, offsetHz: s.offsetHz, appliedHz: s.appliedHz, snrDb: s.snrDb, reason: s.reason,
  });
  const beaconSnapshot = () => (beacon
    ? publicBeacon(beacon.status())
    : { status: 'no-lock', offsetHz: null, appliedHz: 0, snrDb: null, reason: 'no_source' });
  const auth = createAuth({ config, oidc, getRedirectUri: () => `${publicUrl.origin}/auth/callback` });

  const wsOrigin = () => `${publicUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${publicUrl.host}`;
  const headersFor = () => securityHeaders({ https: publicUrl.protocol === 'https:', wsOrigin: wsOrigin() });

  const handler = (req, res) => {
    route(req, res).catch((err) => {
      logger.error('request failed:', err?.message);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
      else res.destroy();
    });
  };
  let server;
  if (useTls) {
    const creds = deps.tlsCredentials ?? { cert: readFileSync(config.tls.certPath), key: readFileSync(config.tls.keyPath) };
    server = https.createServer({ ...creds, minVersion: 'TLSv1.2' }, handler);
  } else {
    server = http.createServer(handler);
  }

  async function route(req, res) {
    for (const [k, v] of Object.entries(headersFor())) res.setHeader(k, v);
    // Rejecting unexpected Host values blocks DNS-rebinding against the localhost listener.
    if (req.headers.host !== publicUrl.host) return sendJson(res, 421, { error: 'misdirected_request' });

    const url = new URL(req.url, publicUrl.origin);
    const { pathname } = url;
    try {
      if (pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true });
      if (pathname === '/auth/login' && req.method === 'GET') return await login(res);
      if (pathname === '/auth/callback' && req.method === 'GET') return await callback(req, res, url);
      if (pathname === '/auth/logout' && req.method === 'POST') {
        const session = auth.requireAuth(req, { csrf: true });
        auth.logout(session.id);
        closeSessionSockets(session.id);
        res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, '', { maxAgeSec: 0, sameSite: 'Strict' }));
        return sendJson(res, 200, { ok: true });
      }
      if (pathname === '/api/me' && req.method === 'GET') {
        const s = auth.requireAuth(req);
        return sendJson(res, 200, { user: s.user, csrfToken: s.csrfToken });
      }
      if (pathname === '/api/ptt' && req.method === 'GET') {
        auth.requireAuth(req);
        return sendJson(res, 200, publicPtt(null));
      }
      if (pathname === '/api/ptt/reset' && req.method === 'POST') {
        const s = auth.requireAuth(req, { minRole: 'owner', csrf: true });
        const actor = { id: 'http', ...s.user };
        return sendJson(res, 200, await ptt.ownerReset(actor, { local: isLocalRequest(req) }));
      }
      if (pathname === '/api/status' && req.method === 'GET') {
        auth.requireAuth(req);
        return sendJson(res, 200, { station: station.status(), beacon: beaconSnapshot(), ptt: publicPtt(null) });
      }
      if (pathname === '/api/beacon' && req.method === 'GET') {
        auth.requireAuth(req);
        return sendJson(res, 200, beaconSnapshot());
      }
      if (pathname === '/api/tune' && req.method === 'POST') {
        auth.requireAuth(req, { minRole: 'operator', csrf: true });
        const body = await readJson(req);
        if (typeof body.downlinkHz !== 'number') throw new BadRequest('downlinkHz');
        return sendJson(res, 200, await station.tune(body.downlinkHz));
      }
      if (pathname === '/api/mode' && req.method === 'POST') {
        auth.requireAuth(req, { minRole: 'operator', csrf: true });
        const body = await readJson(req);
        if (typeof body.mode !== 'string') throw new BadRequest('mode');
        // Reconfiguring the TX channel while the carrier is up could change what is radiated.
        if (ptt.state === 'TX_ON') return sendJson(res, 409, { error: 'tx_active' });
        return sendJson(res, 200, await station.setMode(body.mode));
      }
      if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) return sendJson(res, 404, { error: 'not_found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method_not_allowed' });
      return await serveStatic(req, res, pathname);
    } catch (err) {
      if (err instanceof AuthError) return sendJson(res, err.status, { error: err.code });
      if (err instanceof BadRequest) return sendJson(res, 400, { error: 'bad_request', detail: err.message });
      if (err instanceof StationError) return sendJson(res, 400, { error: err.code });
      if (err instanceof SdrangelError) {
        logger.error('sdrangel request failed:', err.kind, err.message);
        return sendJson(res, 502, { error: 'sdrangel_unavailable', kind: err.kind });
      }
      throw err;
    }
  }

  async function login(res) {
    const { url, loginId } = await auth.startLogin();
    // Lax (not Strict): the cookie must survive the cross-site redirect back from Google.
    res.writeHead(302, {
      Location: url,
      'Cache-Control': 'no-store',
      'Set-Cookie': serializeCookie(LOGIN_COOKIE, loginId, { maxAgeSec: 600, sameSite: 'Lax', path: '/auth' }),
    });
    res.end();
  }

  async function callback(req, res, url) {
    const loginId = parseCookies(req.headers.cookie)[LOGIN_COOKIE];
    try {
      const session = await auth.finishLogin({ search: url.search, loginId });
      // A 200 page with meta refresh instead of a 302: SameSite=Strict cookies are not sent on
      // requests that are part of a cross-site redirect chain, so a 302 would land on an unauthenticated page.
      const headers = [
        serializeCookie(SESSION_COOKIE, session.id, { maxAgeSec: SESSION_MAX_AGE_SEC, sameSite: 'Strict' }),
        serializeCookie(LOGIN_COOKIE, '', { maxAgeSec: 0, sameSite: 'Lax', path: '/auth' }),
      ];
      sendHtml(res, 200,
        '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/"><title>BricoHams</title><a href="/">Continue</a>',
        { 'Set-Cookie': headers });
    } catch (err) {
      if (!(err instanceof AuthError)) throw err;
      logger.error('login rejected:', err.code);
      sendHtml(res, err.status,
        `<!doctype html><meta charset="utf-8"><title>Login failed</title><p>Login failed (${err.code}).</p><a href="/">Back</a>`);
    }
  }

  async function serveStatic(req, res, pathname) {
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return sendJson(res, 400, { error: 'bad_request' });
    }
    if (rel.includes('\0')) return sendJson(res, 400, { error: 'bad_request' });
    let file = normalize(join(publicDir, rel));
    if (file !== publicDir && !file.startsWith(publicDir + sep)) return sendJson(res, 404, { error: 'not_found' });
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      sendJson(res, 404, { error: 'not_found' });
    }
  }

  // ---- WSS control channel ----
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });
  const sockets = new Map(); // connId -> {ws, sessionId}

  function publicPtt(connId) {
    const snap = ptt.snapshot();
    return {
      type: 'state',
      state: snap.state,
      txEnabled: snap.txEnabled,
      holder: snap.holder ? { callsign: snap.holder.callsign } : null,
      isHolder: connId !== null && snap.holder?.id === connId,
      lockoutReason: snap.lockoutReason,
    };
  }

  function send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  function closeSessionSockets(sessionId) {
    for (const c of sockets.values()) if (c.sessionId === sessionId) c.ws.close(4401, 'logged out');
  }

  ptt.on('state', (s) => {
    for (const [connId, c] of sockets) send(c.ws, publicPtt(connId));
    if (s.state !== 'TX_ON') station.onTxIdle().catch(() => {});
  });

  function broadcast(msg) {
    for (const c of sockets.values()) send(c.ws, msg);
  }

  server.on('upgrade', (req, socket, head) => {
    const reject = (code, text) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    try {
      const url = new URL(req.url, publicUrl.origin);
      if (url.pathname !== WS_PATH || req.headers.host !== publicUrl.host) return reject(404, 'Not Found');
      // Browsers always send Origin on WebSocket handshakes; this blocks cross-site WebSocket hijacking.
      if (req.headers.origin !== publicUrl.origin) return reject(403, 'Forbidden');
      const session = auth.authenticate(req);
      if (!session) return reject(401, 'Unauthorized');
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, session.id));
    } catch {
      reject(400, 'Bad Request');
    }
  });

  function onConnection(ws, sessionId) {
    const connId = randomBytes(8).toString('hex');
    sockets.set(connId, { ws, sessionId });
    send(ws, publicPtt(connId));
    send(ws, { type: 'beacon', ...beaconSnapshot() });

    ws.on('message', (data, isBinary) => {
      handleMessage(ws, connId, sessionId, data, isBinary).catch((err) => {
        logger.error('ws message failed:', err?.message);
      });
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      sockets.delete(connId);
      // Connection loss must always drop the carrier.
      ptt.release(connId, 'disconnect');
    });
  }

  async function handleMessage(ws, connId, sessionId, data, isBinary) {
    const session = auth.sessions.get(sessionId);
    if (!session) {
      ws.close(4401, 'session expired');
      return;
    }
    let msg;
    try {
      if (isBinary) throw new Error('binary');
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      send(ws, { type: 'error', error: 'bad_message' });
      return;
    }
    const actor = { id: connId, ...session.user };
    switch (msg?.type) {
      case 'heartbeat':
        ptt.heartbeat(connId);
        return;
      case 'turn':
        send(ws, { type: 'result', op: 'turn', ...ptt.requestTurn(actor) });
        return;
      case 'release':
        send(ws, { type: 'result', op: 'release', ...(await ptt.release(connId, 'released')) });
        return;
      case 'ptt': {
        const r = msg.down === true ? await ptt.keyDown(connId) : await ptt.keyUp(connId);
        send(ws, { type: 'result', op: 'ptt', ...r });
        return;
      }
      default:
        send(ws, { type: 'error', error: 'unknown_type' });
    }
  }

  const sweeper = setInterval(() => auth.sessions.sweep(), 60_000);
  sweeper.unref();

  let beaconTimer = null;
  let beaconBusy = false;
  function startBeaconLoop() {
    if (!beacon || deps.beaconAutoStart === false || beaconTimer) return;
    beaconTimer = setInterval(() => {
      if (beaconBusy) return;
      beaconBusy = true;
      beacon.step().catch((err) => logger.error('beacon step failed:', err?.message)).finally(() => { beaconBusy = false; });
    }, config.station.beaconIntervalMs);
    beaconTimer.unref();
  }

  return {
    server,
    ptt,
    station,
    beacon,
    /**
     * Start listening on the configured host/port.
     * @returns {Promise<{port: number, url: string}>}
     */
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          server.off('error', reject);
          const { port } = server.address();
          if (config.port === 0) {
            publicUrl = new URL(publicUrl.origin.replace(/:\d+$/, '') + `:${port}`);
          }
          startBeaconLoop();
          resolve({ port, url: publicUrl.origin });
        });
      });
    },
    /**
     * Stop the server, drop WebSocket clients and timers. TX is cut first.
     * @returns {Promise<void>}
     */
    async close() {
      clearInterval(sweeper);
      clearInterval(beaconTimer);
      const holder = ptt.holderId;
      if (holder) await ptt.release(holder, 'shutdown');
      ptt.dispose();
      for (const { ws } of sockets.values()) ws.terminate();
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}

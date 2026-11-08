import { LogError } from './store.js';
import { toAdif } from './adif.js';

const MAX_BULK = 100;
const QRZ_KEY_RE = /^[A-Za-z0-9-]{8,128}$/;
const QRZ_KEY_NAME = 'qrz_api_key';
const ID_RE = /^\/api\/log\/(\d{1,9})$/;

function parseIds(body, BadRequest) {
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK || !ids.every((n) => Number.isInteger(n) && n > 0)) {
    throw new BadRequest('ids');
  }
  return [...new Set(ids)];
}

/**
 * Build the logbook HTTP API. All routes need role operator or higher; writes also need the CSRF token.
 * @param {{auth: object, getStore: () => object, getLotw: () => (object|null), qrz: object, hasSecretsKey: boolean,
 *   io: {sendJson: Function, readJson: Function, BadRequest: Function}}} deps
 * @returns {{handle: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL) => Promise<boolean>}}
 *   `handle` returns false when the path is not a logbook route; errors propagate to the caller's error mapper.
 */
export function createLogApi({ auth, getStore, getLotw, qrz, hasSecretsKey, io, onQsoLogged = () => {} }) {
  const { sendJson, readJson, BadRequest } = io;
  let lotwBusy = false;

  // The QRZ key is write-only: no route returns it, only whether one is stored.
  const publicQso = (q) => q;

  function ownedOrOwner(session, qso) {
    if (session.user.role === 'owner' || qso.created_by === session.user.email) return;
    throw new LogError('not_your_qso', { status: 403 });
  }

  async function handle(req, res, url) {
    const { pathname } = url;
    if (!pathname.startsWith('/api/log')) return false;
    const m = req.method;
    const guard = (csrf) => auth.requireAuth(req, { minRole: 'operator', csrf });

    if (pathname === '/api/log' && m === 'GET') {
      guard(false);
      const num = (k, d) => (url.searchParams.has(k) ? Number(url.searchParams.get(k)) : d);
      const call = url.searchParams.get('call') ?? undefined;
      if (call !== undefined && !/^[A-Za-z0-9/]{1,15}$/.test(call)) throw new BadRequest('call');
      const out = getStore().list({ limit: num('limit', 100), offset: num('offset', 0), call });
      sendJson(res, 200, { items: out.items.map(publicQso), total: out.total });
      return true;
    }
    if (pathname === '/api/log' && m === 'POST') {
      const s = guard(true);
      const body = await readJson(req);
      const q = getStore().add(body, s.user, { force: body.force === true });
      try { onQsoLogged(q); } catch { /* an observer must never break logging */ }
      sendJson(res, 201, publicQso(q));
      return true;
    }
    if (pathname === '/api/log/export.adi' && m === 'GET') {
      guard(false);
      const data = toAdif(getStore().listForExport());
      res.writeHead(200, {
        'Content-Type': 'application/x-adif; charset=utf-8',
        'Content-Disposition': 'attachment; filename="bricohams-qo100.adi"',
        'Content-Length': Buffer.byteLength(data),
        'Cache-Control': 'no-store',
      });
      res.end(data);
      return true;
    }
    if (pathname === '/api/log/qrz-key') {
      if (m === 'GET') {
        const s = guard(false);
        sendJson(res, 200, { hasKey: hasSecretsKey && getStore().hasSecret(s.user.email, QRZ_KEY_NAME), canStore: hasSecretsKey });
        return true;
      }
      if (m === 'PUT') {
        const s = guard(true);
        if (!hasSecretsKey) throw new LogError('secrets_unavailable', { status: 503 });
        const body = await readJson(req);
        if (typeof body.apiKey !== 'string' || !QRZ_KEY_RE.test(body.apiKey.trim())) throw new BadRequest('apiKey');
        getStore().setSecret(s.user.email, QRZ_KEY_NAME, body.apiKey.trim());
        sendJson(res, 200, { hasKey: true });
        return true;
      }
      if (m === 'DELETE') {
        const s = guard(true);
        getStore().deleteSecret(s.user.email, QRZ_KEY_NAME);
        sendJson(res, 200, { hasKey: false });
        return true;
      }
    }
    if (pathname === '/api/log/lotw' && m === 'POST') {
      guard(true);
      const uploader = getLotw();
      if (!uploader) throw new LogError('lotw_not_configured', { status: 503 });
      const ids = parseIds(await readJson(req), BadRequest);
      const store = getStore();
      const qsos = store.listForExport(ids);
      if (qsos.length === 0) throw new LogError('not_found', { status: 404 });
      if (lotwBusy) throw new LogError('lotw_busy', { status: 409 });
      lotwBusy = true;
      try {
        const r = await uploader.upload(qsos);
        for (const q of qsos) store.setUploadStatus(q.id, { lotw_status: r.storeStatus });
        sendJson(res, 200, { ok: r.ok, status: r.status, message: r.message, ids: qsos.map((q) => q.id) });
      } finally {
        lotwBusy = false;
      }
      return true;
    }
    if (pathname === '/api/log/qrz' && m === 'POST') {
      const s = guard(true);
      const ids = parseIds(await readJson(req), BadRequest);
      const store = getStore();
      const key = hasSecretsKey ? store.getSecret(s.user.email, QRZ_KEY_NAME) : null;
      if (!key) throw new LogError('qrz_key_missing', { status: 409 });
      const results = [];
      for (const id of ids) {
        const q = store.get(id);
        if (!q) {
          results.push({ id, status: 'not_found' });
        } else if (q.qrz_status === 'sent') {
          results.push({ id, status: 'already_sent' });
        } else {
          const r = await qrz.insert(key, q);
          store.setUploadStatus(id, {
            qrz_status: r.status === 'inserted' ? 'sent' : r.status === 'duplicate' ? 'duplicate' : 'failed',
            qrz_logid: r.logId,
          });
          results.push({ id, status: r.status, reason: r.reason });
          if (r.status === 'auth_failed') break; // every further attempt would fail the same way
        }
      }
      sendJson(res, 200, { results });
      return true;
    }

    const idMatch = ID_RE.exec(pathname);
    if (idMatch) {
      const id = Number(idMatch[1]);
      if (m === 'GET') {
        guard(false);
        const q = getStore().get(id);
        if (!q) throw new LogError('not_found', { status: 404 });
        sendJson(res, 200, publicQso(q));
        return true;
      }
      if (m === 'PUT' || m === 'DELETE') {
        const s = guard(true);
        const store = getStore();
        const q = store.get(id);
        if (!q) throw new LogError('not_found', { status: 404 });
        ownedOrOwner(s, q);
        if (m === 'DELETE') {
          store.remove(id);
          sendJson(res, 200, { ok: true });
        } else {
          sendJson(res, 200, publicQso(store.update(id, await readJson(req))));
        }
        return true;
      }
    }
    sendJson(res, 404, { error: 'not_found' });
    return true;
  }

  return { handle };
}

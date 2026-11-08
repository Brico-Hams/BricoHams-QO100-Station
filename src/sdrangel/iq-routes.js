const IQ_PATH = /^\/api\/iq\/(\d{1,9})$/;
const IQ_PLAY_PATH = /^\/api\/iq\/(\d{1,9})\/playback$/;

/**
 * HTTP handlers for I/Q recording and playback. Recording/playback need the operator role, the policy switch the owner role;
 * every mutating request needs the CSRF token. Nothing here can reach the transmitter.
 * @param {{auth: object, getIq: () => object, station: object, io: {sendJson: Function, readJson: Function, BadRequest: new (m: string) => Error}}} deps
 * @returns {{handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL): Promise<boolean>}}
 */
export function createIqApi({ auth, getIq, station, io }) {
  const { sendJson, readJson } = io;
  const operator = (req) => auth.requireAuth(req, { minRole: 'operator', csrf: true });
  return {
    /**
     * @param {import('node:http').IncomingMessage} req
     * @param {import('node:http').ServerResponse} res
     * @param {URL} url
     * @returns {Promise<boolean>} `true` if handled.
     */
    async handle(req, res, url) {
      const { pathname } = url;
      const m = req.method;
      if (!pathname.startsWith('/api/iq')) return false;
      if (pathname === '/api/iq' && m === 'GET') {
        const s = auth.requireAuth(req, { minRole: 'operator' });
        const iq = getIq();
        return sendJson(res, 200, { ...iq.list(s.user), policy: iq.policy(), current: iq.status() }), true;
      }
      if (pathname === '/api/iq/start' && m === 'POST') {
        const s = operator(req);
        return sendJson(res, 201, await getIq().start(s.user, { centerHz: station.status().rxHz })), true;
      }
      if (pathname === '/api/iq/stop' && m === 'POST') {
        const s = operator(req);
        return sendJson(res, 200, await getIq().stop(s.user)), true;
      }
      if (pathname === '/api/iq/live' && m === 'POST') {
        const s = operator(req);
        return sendJson(res, 200, await getIq().live(s.user)), true;
      }
      if (pathname === '/api/iq/policy' && m === 'PUT') {
        auth.requireAuth(req, { minRole: 'owner', csrf: true });
        const b = await readJson(req);
        if (typeof b.enabled !== 'boolean') throw new io.BadRequest('enabled');
        const iq = getIq();
        await iq.setEnabled(b.enabled);
        return sendJson(res, 200, iq.policy()), true;
      }
      const pm = IQ_PLAY_PATH.exec(pathname);
      if (pm && m === 'POST') {
        const s = operator(req);
        return sendJson(res, 200, await getIq().playback(s.user, Number(pm[1]))), true;
      }
      const dm = IQ_PATH.exec(pathname);
      if (dm && m === 'DELETE') {
        const s = operator(req);
        await getIq().remove(s.user, Number(dm[1]));
        return sendJson(res, 200, { ok: true }), true;
      }
      return false;
    },
  };
}

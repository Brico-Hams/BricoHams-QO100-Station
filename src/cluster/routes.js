import { isCallsign, cleanText, toQo100Downlink } from './parser.js';

const MAX_UPLOAD_BYTES = 300 * 1024;

/**
 * HTTP handlers for DX spots and the activity calendar. Reading needs a login; "spot this" needs the operator role; calendar
 * refresh/upload the owner role; mutating requests need the CSRF token. Nothing here tunes or keys the radio.
 * @param {{auth: object, spots: object, cluster: object|null, postSpots: boolean, calendar: object, onSpot: (spot: object) => void,
 *   io: {sendJson: Function, readJson: Function, BadRequest: new (m: string) => Error}}} deps
 * @returns {{handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL): Promise<boolean>}}
 */
export function createClusterApi({ auth, spots, cluster, postSpots, calendar, onSpot, io }) {
  const { sendJson, readJson } = io;
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
      if (pathname === '/api/spots' && m === 'GET') {
        auth.requireAuth(req);
        return sendJson(res, 200, {
          enabled: cluster !== null, canPost: cluster !== null && postSpots, status: cluster?.status() ?? null, items: spots.list(),
        }), true;
      }
      if (pathname === '/api/spots' && m === 'POST') {
        auth.requireAuth(req, { minRole: 'operator', csrf: true });
        const b = await readJson(req);
        if (!isCallsign(b.dx)) throw new io.BadRequest('dx');
        if (typeof b.downlinkHz !== 'number') throw new io.BadRequest('downlinkHz');
        if (b.comment !== undefined && typeof b.comment !== 'string') throw new io.BadRequest('comment');
        const f = toQo100Downlink(b.downlinkHz);
        if (!f) throw new io.BadRequest('out_of_band');
        if (!cluster || !postSpots) return sendJson(res, 403, { error: 'posting_disabled' }), true;
        const comment = cleanText(b.comment ?? '', 60);
        try {
          cluster.post({ dx: b.dx, downlinkHz: f.downlinkHz, comment });
        } catch (err) {
          return sendJson(res, 409, { error: err.message === 'not_connected' ? 'not_connected' : 'posting_failed' }), true;
        }
        const stored = spots.add({ spotter: 'LOCAL', dx: b.dx, downlinkHz: f.downlinkHz, uplinkHz: f.uplinkHz, comment, time: Date.now() }, 'local');
        onSpot(stored);
        return sendJson(res, 201, stored), true;
      }
      if (pathname === '/api/calendar' && m === 'GET') {
        auth.requireAuth(req);
        return sendJson(res, 200, { ...calendar.status(), items: calendar.list() }), true;
      }
      if (pathname === '/api/calendar/refresh' && m === 'POST') {
        auth.requireAuth(req, { minRole: 'owner', csrf: true });
        try {
          return sendJson(res, 200, await calendar.refresh()), true;
        } catch (err) {
          return sendJson(res, err.message === 'calendar_disabled' ? 403 : 502, { error: err.message }), true;
        }
      }
      if (pathname === '/api/calendar/upload' && m === 'POST') {
        auth.requireAuth(req, { minRole: 'owner', csrf: true });
        const b = await readJson(req, MAX_UPLOAD_BYTES);
        if (typeof b.content !== 'string') throw new io.BadRequest('content');
        try {
          return sendJson(res, 200, calendar.load(b.content)), true;
        } catch (err) {
          return sendJson(res, err.message === 'calendar_disabled' ? 403 : 400, { error: err.message }), true;
        }
      }
      return false;
    },
  };
}

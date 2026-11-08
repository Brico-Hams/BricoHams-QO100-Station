import { createReadStream } from 'node:fs';
import { describeBandPlan } from './bandplan.js';
import { QO100_PRESETS } from './memories.js';
import { exportMemories, importMemories } from './memory-io.js';
import { FILTER_PRESETS, AGC_MODES } from './rx-profile.js';

const MAX_IMPORT_BYTES = 256 * 1024;

const MEMORY_PATH = /^\/api\/memories\/(\d{1,9})(\/recall)?$/;
const RECORDING_PATH = /^\/api\/recordings\/(\d{1,9})(\.wav)?$/;

/**
 * HTTP handlers for the operator conveniences: band plan, memories, RIT/XIT, TX lock, filter, RX DSP and RX recording.
 * Every mutating route needs the operator role and the CSRF token; nothing here can key the transmitter.
 * @param {{auth: object, station: object, memories: object, getRecorder: () => object, isTxActive: () => boolean,
 *   io: {sendJson: Function, readJson: Function, BadRequest: new (m: string) => Error}}} deps
 * @returns {{handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL): Promise<boolean>}}
 */
export function createStationApi({ auth, station, memories, getRecorder, isTxActive, io }) {
  const { sendJson, readJson } = io;
  const operator = (req) => auth.requireAuth(req, { minRole: 'operator', csrf: true });
  const anyUser = (req) => auth.requireAuth(req);

  async function recall(user, memory) {
    const current = station.status();
    // Same rule as POST /api/mode: the TX channel is not reconfigured while the carrier is up.
    if (current.mode !== memory.mode && isTxActive()) return { status: 409, body: { error: 'tx_active' } };
    if (current.mode !== memory.mode) await station.setMode(memory.mode);
    let status = await station.tune(memory.downlinkHz);
    if (memory.filter) status = await station.setFilter(memory.filter);
    return { status: 200, body: status };
  }

  return {
    /**
     * @param {import('node:http').IncomingMessage} req
     * @param {import('node:http').ServerResponse} res
     * @param {URL} url
     * @returns {Promise<boolean>} `true` if the request was handled.
     */
    async handle(req, res, url) {
      const { pathname } = url;
      const m = req.method;

      if (pathname === '/api/bandplan' && m === 'GET') {
        anyUser(req);
        return sendJson(res, 200, { ...describeBandPlan(), filters: FILTER_PRESETS, agcModes: AGC_MODES }), true;
      }

      if (pathname === '/api/memories' && m === 'GET') {
        const s = anyUser(req);
        return sendJson(res, 200, { items: memories.list(s.user), presets: QO100_PRESETS }), true;
      }
      if (pathname === '/api/memories' && m === 'POST') {
        const s = operator(req);
        return sendJson(res, 201, memories.add(s.user, await readJson(req))), true;
      }
      if (pathname === '/api/memories/export' && m === 'GET') {
        const s = anyUser(req);
        const format = url.searchParams.get('format') ?? 'json';
        const out = exportMemories(memories.list(s.user), format);
        res.writeHead(200, {
          'Content-Type': out.contentType,
          'Content-Disposition': `attachment; filename="${out.filename}"`,
          'Cache-Control': 'no-store',
        });
        return res.end(out.body), true;
      }
      if (pathname === '/api/memories/import' && m === 'POST') {
        const s = operator(req);
        const b = await readJson(req, MAX_IMPORT_BYTES);
        if (typeof b.content !== 'string') throw new io.BadRequest('content');
        if (b.dryRun !== undefined && typeof b.dryRun !== 'boolean') throw new io.BadRequest('dryRun');
        return sendJson(res, 200, importMemories({ store: memories, user: s.user, format: b.format, content: b.content, dryRun: b.dryRun === true })), true;
      }
      const mm = MEMORY_PATH.exec(pathname);
      if (mm) {
        const id = Number(mm[1]);
        if (mm[2] && m === 'POST') {
          const s = operator(req);
          const out = await recall(s.user, memories.get(s.user, id));
          return sendJson(res, out.status, out.body), true;
        }
        if (!mm[2] && m === 'PUT') {
          const s = operator(req);
          return sendJson(res, 200, memories.update(s.user, id, await readJson(req))), true;
        }
        if (!mm[2] && m === 'DELETE') {
          const s = operator(req);
          memories.remove(s.user, id);
          return sendJson(res, 200, { ok: true }), true;
        }
      }

      if (pathname === '/api/rit' && m === 'POST') {
        operator(req);
        const b = await readJson(req);
        for (const k of ['ritHz', 'xitHz']) if (b[k] !== undefined && typeof b[k] !== 'number') throw new io.BadRequest(k);
        return sendJson(res, 200, await station.setOffsets({ ritHz: b.ritHz, xitHz: b.xitHz })), true;
      }
      if (pathname === '/api/txlock' && m === 'POST') {
        operator(req);
        const b = await readJson(req);
        if (typeof b.locked !== 'boolean') throw new io.BadRequest('locked');
        if (b.txDownlinkHz !== undefined && typeof b.txDownlinkHz !== 'number') throw new io.BadRequest('txDownlinkHz');
        return sendJson(res, 200, await station.setTxLock({ locked: b.locked, txDownlinkHz: b.txDownlinkHz })), true;
      }
      if (pathname === '/api/filter' && m === 'POST') {
        operator(req);
        const b = await readJson(req);
        if (typeof b.preset !== 'string') throw new io.BadRequest('preset');
        return sendJson(res, 200, await station.setFilter(b.preset)), true;
      }
      if (pathname === '/api/rxdsp' && m === 'POST') {
        operator(req);
        return sendJson(res, 200, await station.setRxDsp(await readJson(req))), true;
      }
      if (pathname === '/api/notch' && m === 'POST') {
        operator(req);
        return sendJson(res, 200, await station.setNotch(await readJson(req))), true;
      }

      if (pathname === '/api/recordings' && m === 'GET') {
        const s = anyUser(req);
        const rec = getRecorder();
        return sendJson(res, 200, { ...rec.list(s.user), policy: rec.policy(), current: rec.status(s.user) }), true;
      }
      if (pathname === '/api/recordings/start' && m === 'POST') {
        const s = operator(req);
        const st = station.status();
        return sendJson(res, 201, getRecorder().start(s.user, { downlinkHz: st.downlinkHz, mode: st.mode })), true;
      }
      if (pathname === '/api/recordings/stop' && m === 'POST') {
        const s = operator(req);
        return sendJson(res, 200, getRecorder().stop(s.user)), true;
      }
      if (pathname === '/api/recordings/policy' && m === 'PUT') {
        auth.requireAuth(req, { minRole: 'owner', csrf: true });
        const b = await readJson(req);
        if (typeof b.enabled !== 'boolean') throw new io.BadRequest('enabled');
        const rec = getRecorder();
        rec.setEnabled(b.enabled);
        return sendJson(res, 200, rec.policy()), true;
      }
      const rm = RECORDING_PATH.exec(pathname);
      if (rm) {
        const id = Number(rm[1]);
        if (rm[2] && m === 'GET') {
          const s = auth.requireAuth(req, { minRole: 'operator' });
          const f = getRecorder().locate(s.user, id);
          res.writeHead(200, {
            'Content-Type': 'audio/wav',
            'Content-Length': f.size,
            'Content-Disposition': `attachment; filename="${f.name}"`,
            'Cache-Control': 'no-store',
          });
          createReadStream(f.path).on('error', () => res.destroy()).pipe(res);
          return true;
        }
        if (!rm[2] && m === 'DELETE') {
          const s = operator(req);
          getRecorder().remove(s.user, id);
          return sendJson(res, 200, { ok: true }), true;
        }
      }
      return false;
    },
  };
}

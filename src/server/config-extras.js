import { isCallsign } from '../cluster/parser.js';
import { WEBHOOK_EVENTS } from '../plugins/webhooks.js';
import { isPluginName } from '../plugins/static.js';

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{2,63}$/;
const MAX_ENDPOINTS = 10;
const MAX_PLUGINS = 20;

function bool(v, name, problems) {
  if (typeof v === 'boolean') return v;
  problems.push(`${name} must be true or false`);
  return false;
}

function isLoopback(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(?:\.\d{1,3}){3}$/.test(h);
}

function httpUrl(value, name, problems, { requireHttps = false } = {}) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
    if (u.username || u.password) {
      problems.push(`${name} must not contain credentials`);
      return null;
    }
    if (requireHttps && u.protocol !== 'https:' && !isLoopback(u.hostname)) {
      problems.push(`${name} must use https: unless it is a loopback address`);
      return null;
    }
    return u.href;
  } catch {
    problems.push(`${name} must be a valid http(s) URL`);
    return null;
  }
}

/**
 * Validate the optional Phase 13 sections (`iq`, `cluster`, `calendar`, `webhooks`, `plugins`). Every feature is off by default and
 * nothing connects outbound unless its own `enabled` is true. Webhook secrets are never read from the file, only from the
 * environment variable named by `secretEnv`.
 * @param {object} raw Parsed config file.
 * @param {Record<string, string|undefined>} env
 * @param {string[]} problems Collected validation problems (mutated).
 * @returns {{iq: object, cluster: object, calendar: object, webhooks: object, plugins: object}}
 */
export function parseExtraConfig(raw, env, problems) {
  const iqRaw = raw.iq ?? {};
  const iq = { enabled: bool(iqRaw.enabled ?? false, 'iq.enabled', problems), maxUserMb: iqRaw.maxUserMb ?? 2000, maxSeconds: iqRaw.maxSeconds ?? 600 };
  if (!isInt(iq.maxUserMb, 1, 1_000_000)) problems.push('iq.maxUserMb must be an integer between 1 and 1000000');
  if (!isInt(iq.maxSeconds, 10, 86_400)) problems.push('iq.maxSeconds must be an integer between 10 and 86400');

  const clRaw = raw.cluster ?? {};
  const cluster = {
    enabled: bool(clRaw.enabled ?? false, 'cluster.enabled', problems),
    host: clRaw.host ?? '',
    port: clRaw.port ?? 7300,
    callsign: typeof clRaw.callsign === 'string' ? clRaw.callsign.toUpperCase() : '',
    postSpots: bool(clRaw.postSpots ?? false, 'cluster.postSpots', problems),
  };
  if (cluster.enabled) {
    if (typeof cluster.host !== 'string' || !HOST_RE.test(cluster.host)) problems.push('cluster.host must be a host name or address when the cluster is enabled');
    if (!isInt(cluster.port, 1, 65535)) problems.push('cluster.port must be an integer between 1 and 65535');
    if (!isCallsign(cluster.callsign)) problems.push('cluster.callsign must be a callsign (letters, digits, "/") when the cluster is enabled');
  }

  const caRaw = raw.calendar ?? {};
  const calendar = { enabled: bool(caRaw.enabled ?? false, 'calendar.enabled', problems), url: null, refreshHours: caRaw.refreshHours ?? 6, maxKb: caRaw.maxKb ?? 256 };
  if (caRaw.url !== undefined && caRaw.url !== null && caRaw.url !== '') calendar.url = httpUrl(caRaw.url, 'calendar.url', problems);
  if (!isInt(calendar.refreshHours, 1, 168)) problems.push('calendar.refreshHours must be an integer between 1 and 168');
  if (!isInt(calendar.maxKb, 1, 2048)) problems.push('calendar.maxKb must be an integer between 1 and 2048');

  const whRaw = raw.webhooks ?? {};
  const webhooks = { enabled: bool(whRaw.enabled ?? false, 'webhooks.enabled', problems), endpoints: [] };
  const eps = whRaw.endpoints ?? [];
  if (!Array.isArray(eps) || eps.length > MAX_ENDPOINTS) problems.push(`webhooks.endpoints must be a list of at most ${MAX_ENDPOINTS} entries`);
  else {
    eps.forEach((e, i) => {
      const name = `webhooks.endpoints[${i}]`;
      const url = typeof e?.url === 'string' ? httpUrl(e.url, `${name}.url`, problems, { requireHttps: true }) : (problems.push(`${name}.url is required`), null);
      const events = Array.isArray(e?.events) ? e.events : [];
      if (events.length === 0 || !events.every((ev) => WEBHOOK_EVENTS.includes(ev))) {
        problems.push(`${name}.events must be a non-empty list of: ${WEBHOOK_EVENTS.join(', ')}`);
      }
      if (typeof e?.secretEnv !== 'string' || !ENV_NAME_RE.test(e.secretEnv)) {
        problems.push(`${name}.secretEnv must name an environment variable (the secret itself is never stored in the config file)`);
        return;
      }
      const secret = env[e.secretEnv] ?? '';
      if (webhooks.enabled && secret.length < 16) problems.push(`environment variable ${e.secretEnv} (webhook secret) must hold at least 16 characters`);
      if (url) webhooks.endpoints.push({ url, events: [...new Set(events)], secret });
    });
  }

  const plRaw = raw.plugins ?? {};
  const names = plRaw.enabled ?? [];
  const plugins = { enabled: [], dir: plRaw.dir ?? './plugins' };
  if (!Array.isArray(names) || names.length > MAX_PLUGINS || !names.every(isPluginName)) {
    problems.push(`plugins.enabled must be a list of at most ${MAX_PLUGINS} directory names (lowercase letters, digits, "-")`);
  } else plugins.enabled = [...new Set(names)];
  if (typeof plugins.dir !== 'string' || !plugins.dir) problems.push('plugins.dir must be a non-empty string');

  return { iq, cluster, calendar, webhooks, plugins };
}

/**
 * Freeze the extra sections and hide webhook secrets from logs.
 * @param {ReturnType<typeof parseExtraConfig>} extra
 * @returns {object}
 */
export function freezeExtraConfig(extra) {
  return {
    iq: Object.freeze(extra.iq),
    cluster: Object.freeze(extra.cluster),
    calendar: Object.freeze(extra.calendar),
    webhooks: Object.freeze({ ...extra.webhooks, endpoints: Object.freeze(extra.webhooks.endpoints.map((e) => Object.freeze({ ...e, events: Object.freeze(e.events) }))) }),
    plugins: Object.freeze({ ...extra.plugins, enabled: Object.freeze(extra.plugins.enabled) }),
  };
}

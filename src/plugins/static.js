import { join, normalize, sep, extname } from 'node:path';

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
const TYPES = Object.freeze({
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
});

/** @param {unknown} name @returns {boolean} Whether `name` is a valid plugin directory name (lowercase letters, digits, hyphen). */
export const isPluginName = (name) => typeof name === 'string' && NAME_RE.test(name);

/**
 * Map a request path `/plugins/<name>/<file>` to a file inside the plugins directory.
 * Only plugins named in `enabled` are served, every path segment is whitelisted (no `..`, no dotfiles, no backslashes or
 * encoded separators) and only static web file types are allowed, so nothing outside `<root>/<name>/` is reachable.
 * @param {string} root Absolute plugins directory.
 * @param {readonly string[]} enabled Names enabled by the owner.
 * @param {string} pathname Decoded URL path.
 * @returns {{file: string, contentType: string}|null} `null` if the path is not servable.
 */
export function resolvePluginFile(root, enabled, pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/plugins/')) return null;
  const parts = pathname.slice('/plugins/'.length).split('/');
  const [name, ...rest] = parts;
  if (!isPluginName(name) || !enabled.includes(name) || rest.length === 0 || rest.length > 6) return null;
  if (!rest.every((s) => SEGMENT_RE.test(s) && !s.includes('..'))) return null;
  const contentType = TYPES[extname(rest.at(-1)).toLowerCase()];
  if (!contentType) return null;
  const base = join(root, name);
  const file = normalize(join(base, ...rest));
  return file.startsWith(base + sep) ? { file, contentType } : null;
}

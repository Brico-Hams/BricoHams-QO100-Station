// FT8/FT4 77-bit message packing and unpacking.
// Port of the algorithms in ft8_lib (https://github.com/kgoba/ft8_lib), ft8/message.c and ft8/text.c.
// Copyright (c) 2018 Karlis Goba, MIT License (see NOTICE.md).
//
// Supported: standard messages (i3 = 1, 2), non-standard callsign messages (i3 = 4), free text (i3 = 0, n3 = 0) and
// telemetry (shown as hex). DXpedition, EU VHF contest, ARRL Field Day, ARRL RTTY roundup and WWROF messages are
// recognised as unsupported and skipped by the decoder (`unpackMessage` returns null).

const NTOKENS = 2063592;
const MAX22 = 4194304;
const MAXGRID4 = 32400;

const T_ALPHANUM_SPACE = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const T_ALPHANUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const T_LETTERS_SPACE = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const T_NUMERIC = '0123456789';
const T_ALPHANUM_SPACE_SLASH = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/';
const T_FULL = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+-./?';

const MASK64 = (1n << 64n) - 1n;

/**
 * Callsign hash store used to resolve `<CALL>` references (22, 12 and 10-bit hashes) seen earlier in the same session.
 * @param {number} [max] Maximum number of remembered callsigns (oldest are dropped).
 * @returns {{save(call: string): void, lookup(bits: 22|12|10, hash: number): string|null, size(): number}}
 */
export function createHashTable(max = 1024) {
  const byN22 = new Map();
  return {
    save(call) {
      const n22 = hashCall(call);
      if (n22 < 0 || call.length < 3) return;
      byN22.delete(n22);
      byN22.set(n22, call);
      if (byN22.size > max) byN22.delete(byN22.keys().next().value);
    },
    lookup(bits, hash) {
      if (bits === 22) return byN22.get(hash) ?? null;
      const shift = bits === 12 ? 10 : 12;
      for (const [n22, call] of byN22) if (n22 >> shift === hash) return call;
      return null;
    },
    size: () => byN22.size,
  };
}

/**
 * 22-bit hash of a callsign (up to 11 characters).
 * @param {string} call
 * @returns {number} The hash, or -1 if the callsign has characters outside `A-Z0-9/ `.
 */
export function hashCall(call) {
  let n58 = 0n;
  let i = 0;
  for (; i < call.length && i < 11; i++) {
    const j = T_ALPHANUM_SPACE_SLASH.indexOf(call[i]);
    if (j < 0) return -1;
    n58 = n58 * 38n + BigInt(j);
  }
  for (; i < 11; i++) n58 *= 38n;
  return Number(((47055833459n * n58) & MASK64) >> 42n) & 0x3fffff;
}

const isDigit = (c) => c >= '0' && c <= '9';
const isLetter = (c) => c >= 'A' && c <= 'Z';

/** Value of "CQ nnn" / "CQ abcd" modifier in the text after "CQ ", or -1. */
function parseCqModifier(token) {
  let nnum = 0;
  let nlet = 0;
  let m = 0;
  for (const c of token) {
    if (isDigit(c)) nnum++;
    else if (isLetter(c)) {
      nlet++;
      m = 27 * m + (c.charCodeAt(0) - 64);
    } else return -1;
  }
  if (token.length === 3 && nnum === 3) return Number(token);
  if (nnum === 0 && nlet >= 1 && nlet <= 4) return 1000 + m;
  return -1;
}

function packBasecall(call, length) {
  if (length <= 2) return -1;
  let c6 = '      ';
  const rest = call.slice(0, length);
  if (rest.startsWith('3DA0') && length > 4 && length <= 7) c6 = `3D0${rest.slice(4)}`.padEnd(6, ' ');
  else if (rest.startsWith('3X') && isLetter(rest[2] ?? '') && length <= 7) c6 = `Q${rest.slice(2)}`.padEnd(6, ' ');
  else if (isDigit(rest[2] ?? '') && length <= 6) c6 = rest.padEnd(6, ' ');
  else if (isDigit(rest[1] ?? '') && length <= 5) c6 = ` ${rest}`.padEnd(6, ' ');
  if (c6.length !== 6) return -1;
  const i0 = T_ALPHANUM_SPACE.indexOf(c6[0]);
  const i1 = T_ALPHANUM.indexOf(c6[1]);
  const i2 = T_NUMERIC.indexOf(c6[2]);
  const i3 = T_LETTERS_SPACE.indexOf(c6[3]);
  const i4 = T_LETTERS_SPACE.indexOf(c6[4]);
  const i5 = T_LETTERS_SPACE.indexOf(c6[5]);
  if ([i0, i1, i2, i3, i4, i5].some((v) => v < 0)) return -1;
  return ((((i0 * 36 + i1) * 10 + i2) * 27 + i3) * 27 + i4) * 27 + i5;
}

/** Pack a callsign or token into 28 bits plus the /R-/P flag; null if it cannot be represented. */
function pack28(call, hashes) {
  if (call === 'DE') return { n28: 0, ip: 0 };
  if (call === 'QRZ') return { n28: 1, ip: 0 };
  if (call === 'CQ') return { n28: 2, ip: 0 };
  if (call.startsWith('CQ ') && call.length < 8) {
    const v = parseCqModifier(call.slice(3));
    return v < 0 ? null : { n28: 3 + v, ip: 0 };
  }
  if (call.startsWith('<') && call.endsWith('>') && call.length >= 5) {
    const inner = call.slice(1, -1);
    const n22 = hashCall(inner);
    if (n22 < 0) return null;
    hashes?.save(inner);
    return { n28: NTOKENS + n22, ip: 0 };
  }
  let ip = 0;
  let lengthBase = call.length;
  if (call.endsWith('/P') || call.endsWith('/R')) {
    ip = 1;
    lengthBase -= 2;
  }
  const n = packBasecall(call, lengthBase);
  if (n >= 0) {
    hashes?.save(call);
    return { n28: NTOKENS + MAX22 + n, ip };
  }
  if (call.length >= 3 && call.length <= 11) {
    const n22 = hashCall(call);
    if (n22 < 0) return null;
    hashes?.save(call);
    return { n28: NTOKENS + n22, ip: 0 };
  }
  return null;
}

function unpack28(n28, ip, i3, hashes) {
  if (n28 < NTOKENS) {
    if (n28 === 0) return 'DE';
    if (n28 === 1) return 'QRZ';
    if (n28 === 2) return 'CQ';
    if (n28 <= 1002) return `CQ ${String(n28 - 3).padStart(3, '0')}`;
    if (n28 <= 532443) {
      let n = n28 - 1003;
      let s = '';
      for (let i = 0; i < 4; i++) {
        s = T_LETTERS_SPACE[n % 27] + s;
        n = Math.floor(n / 27);
      }
      return `CQ ${s.trim()}`;
    }
    return null;
  }
  let n = n28 - NTOKENS;
  if (n < MAX22) {
    const call = hashes?.lookup(22, n);
    return call ? `<${call}>` : '<...>';
  }
  n -= MAX22;
  const c = [];
  c[5] = T_LETTERS_SPACE[n % 27]; n = Math.floor(n / 27);
  c[4] = T_LETTERS_SPACE[n % 27]; n = Math.floor(n / 27);
  c[3] = T_LETTERS_SPACE[n % 27]; n = Math.floor(n / 27);
  c[2] = T_NUMERIC[n % 10]; n = Math.floor(n / 10);
  c[1] = T_ALPHANUM[n % 36]; n = Math.floor(n / 36);
  c[0] = T_ALPHANUM_SPACE[n % 37];
  const raw = c.join('');
  let call;
  if (raw.startsWith('3D0') && raw[3] !== ' ') call = `3DA0${raw.slice(3).trim()}`;
  else if (raw[0] === 'Q' && isLetter(raw[1])) call = `3X${raw.slice(1).trim()}`;
  else call = raw.trim();
  if (call.length < 3) return null;
  if (ip) {
    if (i3 === 1) call += '/R';
    else if (i3 === 2) call += '/P';
    else return null;
  }
  hashes?.save(call);
  return call;
}

function packGrid(extra) {
  if (extra === '') return MAXGRID4 + 1;
  if (extra === 'RRR') return MAXGRID4 + 2;
  if (extra === 'RR73') return MAXGRID4 + 3;
  if (extra === '73') return MAXGRID4 + 4;
  if (/^[A-R]{2}\d{2}$/.test(extra)) {
    return (((extra.charCodeAt(0) - 65) * 18 + (extra.charCodeAt(1) - 65)) * 10 + Number(extra[2])) * 10 + Number(extra[3]);
  }
  const m = /^(R?)([+-]?\d{1,2})$/.exec(extra);
  if (m) {
    const dd = Number(m[2]);
    if (dd < -30 || dd > 99) return -1;
    return (MAXGRID4 + 35 + dd) | (m[1] ? 0x8000 : 0);
  }
  return -1;
}

function unpackGrid(igrid4, ir) {
  if (igrid4 <= MAXGRID4) {
    let n = igrid4;
    const d3 = n % 10; n = Math.floor(n / 10);
    const d2 = n % 10; n = Math.floor(n / 10);
    const l1 = n % 18; n = Math.floor(n / 18);
    const l0 = n % 18;
    const grid = `${String.fromCharCode(65 + l0)}${String.fromCharCode(65 + l1)}${d2}${d3}`;
    return ir ? `R ${grid}` : grid;
  }
  const irpt = igrid4 - MAXGRID4;
  if (irpt === 1) return '';
  if (irpt === 2) return 'RRR';
  if (irpt === 3) return 'RR73';
  if (irpt === 4) return '73';
  const dd = irpt - 35;
  return `${ir ? 'R' : ''}${dd < 0 ? '-' : '+'}${String(Math.abs(dd)).padStart(2, '0')}`;
}

const toPayload = (p77) => {
  let v = p77 << 3n;
  const out = new Uint8Array(10);
  for (let i = 9; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
};

const fromPayload = (bytes) => {
  let v = 0n;
  for (let i = 0; i < 10; i++) v = (v << 8n) | BigInt(bytes[i]);
  return v >> 3n;
};

function packStandard(to, de, extra, hashes) {
  const a = pack28(to, hashes);
  const b = pack28(de, hashes);
  if (!a || !b) return null;
  let i3 = 1;
  if (to.endsWith('/P') || de.endsWith('/P')) {
    i3 = 2;
    if (to.endsWith('/R') || de.endsWith('/R')) return null;
  }
  const slash = de.indexOf('/');
  const icq = to === 'CQ' || to.startsWith('CQ ');
  if (slash >= 2 && icq && de.slice(slash) !== '/P' && de.slice(slash) !== '/R') return null;
  const igrid = packGrid(extra);
  if (igrid < 0) return null;
  const n29a = BigInt(a.n28 * 2 + a.ip);
  const n29b = BigInt(b.n28 * 2 + b.ip);
  const ir = igrid & 0x8000 ? 1n : 0n;
  return (n29a << 48n) | (n29b << 19n) | (ir << 18n) | (BigInt(igrid & 0x7fff) << 3n) | BigInt(i3);
}

function packNonstandard(to, de, extra, hashes) {
  const icq = to === 'CQ' || to.startsWith('CQ ');
  if (!icq && to.length < 3) return null;
  if (de.length < 3) return null;
  let iflip = 0;
  let n12 = 0;
  let call58;
  if (!icq) {
    if (de.startsWith('<') && de.endsWith('>')) iflip = 1;
    const call12 = iflip === 0 ? to : de;
    call58 = iflip === 0 ? de : to;
    const inner = call12.replace(/^<|>$/g, '');
    const n22 = hashCall(inner);
    if (n22 < 0) return null;
    hashes?.save(inner);
    n12 = n22 >> 10;
  } else {
    call58 = de;
  }
  call58 = call58.replace(/^<|>$/g, '');
  if (call58.length > 11) return null;
  let n58 = 0n;
  for (const c of call58) {
    const j = T_ALPHANUM_SPACE_SLASH.indexOf(c);
    if (j < 0) return null;
    n58 = n58 * 38n + BigInt(j);
  }
  hashes?.save(call58);
  const nrpt = icq ? 0 : { RRR: 1, RR73: 2, 73: 3 }[extra] ?? 0;
  return (BigInt(n12) << 65n) | (n58 << 7n) | (BigInt(iflip) << 6n) | (BigInt(nrpt) << 4n) | (BigInt(icq ? 1 : 0) << 3n) | 4n;
}

function packFreeText(text) {
  if (text.length > 13) return null;
  let v = 0n;
  const padded = text.padEnd(13, ' ');
  for (const c of padded) {
    const j = T_FULL.indexOf(c);
    if (j < 0) return null;
    v = v * 42n + BigInt(j);
  }
  return v << 6n;
}

/**
 * Pack message text into the 77-bit payload. Tries a standard message, then a non-standard callsign message, then free text
 * (13 characters of `0-9 A-Z + - . / ?`).
 * @param {string} text Message such as "CQ EA4AAA IN80" or "EA4AAA EA4BBB -10".
 * @param {ReturnType<typeof createHashTable>} [hashes] Optional hash store that learns the callsigns.
 * @returns {Uint8Array} 10 bytes (77 bits followed by 3 zero bits).
 * @throws {Error} If the text cannot be represented.
 */
export function packMessage(text, hashes) {
  if (typeof text !== 'string') throw new TypeError('message must be a string');
  const clean = text.toUpperCase().trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error('empty message');
  const tokens = clean.split(' ');
  let to;
  let de;
  let extra = '';
  let leftover = false;
  if (tokens[0] === 'CQ' && tokens.length >= 2) {
    let idx = 1;
    to = 'CQ';
    if (tokens.length >= 3 && parseCqModifier(tokens[1]) >= 0 && tokens[1].length <= 4) {
      to = `CQ ${tokens[1]}`;
      idx = 2;
    }
    de = tokens[idx];
    extra = tokens[idx + 1] ?? '';
    leftover = tokens.length > idx + 2;
  } else {
    to = tokens[0];
    de = tokens[1];
    extra = tokens[2] ?? '';
    leftover = tokens.length > 3;
  }
  let p = null;
  if (!leftover && de !== undefined) {
    p = packStandard(to, de, extra, hashes) ?? packNonstandard(to, de, extra, hashes);
  }
  p ??= packFreeText(clean);
  if (p === null) throw new Error('message cannot be encoded');
  return toPayload(p);
}

/**
 * Unpack a 77-bit payload.
 * @param {Uint8Array} payload 10 bytes.
 * @param {ReturnType<typeof createHashTable>} [hashes]
 * @returns {{text: string, type: 'standard'|'nonstandard'|'free'|'telemetry'}|null} null for unsupported or invalid messages.
 */
export function unpackMessage(payload, hashes) {
  const p = fromPayload(payload);
  const i3 = Number(p & 7n);
  if (i3 === 1 || i3 === 2) {
    const n29a = Number((p >> 48n) & 0x1fffffffn);
    const n29b = Number((p >> 19n) & 0x1fffffffn);
    const ir = Number((p >> 18n) & 1n);
    const igrid = Number((p >> 3n) & 0x7fffn);
    const to = unpack28(Math.floor(n29a / 2), n29a & 1, i3, hashes);
    if (to === null) return null;
    const de = unpack28(Math.floor(n29b / 2), n29b & 1, i3, hashes);
    if (de === null) return null;
    const extra = unpackGrid(igrid, ir);
    return { text: extra ? `${to} ${de} ${extra}` : `${to} ${de}`, type: 'standard' };
  }
  if (i3 === 4) {
    const n12 = Number((p >> 65n) & 0xfffn);
    let n58 = (p >> 7n) & ((1n << 58n) - 1n);
    const iflip = Number((p >> 6n) & 1n);
    const nrpt = Number((p >> 4n) & 3n);
    const icq = Number((p >> 3n) & 1n);
    let s = '';
    for (let i = 0; i < 11; i++) {
      s = T_ALPHANUM_SPACE_SLASH[Number(n58 % 38n)] + s;
      n58 /= 38n;
    }
    const decoded = s.trim();
    if (decoded.length >= 3) hashes?.save(decoded);
    const looked = hashes?.lookup(12, n12);
    const hashed = looked ? `<${looked}>` : '<...>';
    const [c1, c2] = iflip ? [decoded, hashed] : [hashed, decoded];
    if (icq) return { text: `CQ ${c2}`, type: 'nonstandard' };
    const extra = ['', 'RRR', 'RR73', '73'][nrpt];
    return { text: extra ? `${c1} ${c2} ${extra}` : `${c1} ${c2}`, type: 'nonstandard' };
  }
  if (i3 === 0) {
    const n3 = Number((p >> 3n) & 7n);
    let v = p >> 6n;
    if (n3 === 0) {
      let s = '';
      for (let i = 0; i < 13; i++) {
        s = T_FULL[Number(v % 42n)] + s;
        v /= 42n;
      }
      return { text: s.trim(), type: 'free' };
    }
    if (n3 === 5) return { text: v.toString(16).toUpperCase().padStart(18, '0'), type: 'telemetry' };
  }
  return null;
}

const CALL_RE = /^<?[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}(?:\/[A-Z0-9]{1,4})?>?$/;
const looksLikeCall = (t) => CALL_RE.test(t) && /[A-Z]/.test(t) && !/^<\.\.\.>$/.test(t);

/**
 * Split a decoded message into the fields used to prefill the log form.
 * @param {string} text
 * @returns {{cq: boolean, to: string|null, from: string|null, grid: string|null, report: string|null}}
 */
export function describeMessage(text) {
  const tokens = String(text).toUpperCase().trim().split(/\s+/).filter(Boolean);
  const out = { cq: false, to: null, from: null, grid: null, report: null };
  let rest = [];
  if (tokens[0] === 'CQ') {
    out.cq = true;
    const i = tokens.findIndex((t, idx) => idx > 0 && looksLikeCall(t));
    if (i > 0) {
      out.from = tokens[i].replace(/[<>]/g, '');
      rest = tokens.slice(i + 1);
    }
  } else if (tokens.length >= 2 && looksLikeCall(tokens[0]) && looksLikeCall(tokens[1])) {
    out.to = tokens[0].replace(/[<>]/g, '');
    out.from = tokens[1].replace(/[<>]/g, '');
    rest = tokens.slice(2);
  } else if (tokens.length >= 2 && tokens[0] === '<...>' && looksLikeCall(tokens[1])) {
    out.from = tokens[1].replace(/[<>]/g, '');
    rest = tokens.slice(2);
  }
  for (const t of rest) {
    if (t !== 'RR73' && /^[A-R]{2}\d{2}$/.test(t)) out.grid = t;
    else if (/^R?[+-]\d{2}$/.test(t)) out.report = t.replace(/^R/, '');
  }
  return out;
}

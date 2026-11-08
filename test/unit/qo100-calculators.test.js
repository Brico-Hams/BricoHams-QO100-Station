import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  dishGain, pointing, cascade, lnbLineup, helix, ifFromRf, rfFromIf, uplinkFromDownlink, loDrift, pllLoMHz,
} from '../../services/qo100-calculators/assets/qo100-math.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'services', 'qo100-calculators');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test('dish gain matches reference values', () => {
  near(dishGain({ diameterM: 1.5, freqHz: 11e9, efficiency: 0.6 }).gainDbi, 42.5, 0.3);
  near(dishGain({ diameterM: 0.6, freqHz: 10.489e9, efficiency: 0.55 }).gainDbi, 33.8, 0.3);
  near(dishGain({ diameterM: 0.6, freqHz: 2.4e9, efficiency: 0.55 }).gainDbi, 21.0, 0.3);
  near(dishGain({ diameterM: 0.6, freqHz: 10.489e9, efficiency: 0.55 }).beamwidthDeg, 70 * 0.028583 / 0.6, 0.05);
});

test('dish rejects invalid input', () => {
  assert.throws(() => dishGain({ diameterM: -1, freqHz: 10e9, efficiency: 0.5 }), RangeError);
  assert.throws(() => dishGain({ diameterM: 1, freqHz: 10e9, efficiency: NaN }), RangeError);
});

// Independent derivation: explicit 3-D vectors on a sphere, then East/North/Up projection.
function vectorLookAngles(latDeg, lonDeg, satLonDeg) {
  const r = (d) => (d * Math.PI) / 180;
  const Re = 6378.137;
  const Rs = 42164;
  const [la, lo, ls] = [r(latDeg), r(lonDeg), r(satLonDeg)];
  const st = [Re * Math.cos(la) * Math.cos(lo), Re * Math.cos(la) * Math.sin(lo), Re * Math.sin(la)];
  const sat = [Rs * Math.cos(ls), Rs * Math.sin(ls), 0];
  const d = sat.map((v, i) => v - st[i]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const E = [-Math.sin(lo), Math.cos(lo), 0];
  const N = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const U = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const az = ((Math.atan2(dot(d, E), dot(d, N)) * 180) / Math.PI + 360) % 360;
  const el = (Math.asin(dot(d, U) / Math.hypot(...d)) * 180) / Math.PI;
  return { az, el };
}

test('pointing from Madrid agrees with independent spherical derivation', () => {
  const p = pointing({ latDeg: 40.4168, lonDeg: -3.7038, declinationDeg: -1.5, offsetDeg: 22.5 });
  const ref = vectorLookAngles(40.4168, -3.7038, 25.8);
  near(p.azimuthTrueDeg, ref.az, 0.5);
  near(p.elevationDeg, ref.el, 0.5);
  assert.ok(p.elevationDeg > 32 && p.elevationDeg < 36);
  assert.ok(p.azimuthTrueDeg > 137 && p.azimuthTrueDeg < 143);
  near(p.azimuthMagneticDeg, p.azimuthTrueDeg + 1.5, 1e-9);
  near(p.mountTiltDeg, p.elevationDeg - 22.5, 1e-9);
  assert.ok(p.visible);
});

test('pointing covers other quadrants', () => {
  for (const [la, lo] of [[-33.9, 18.4], [35.7, 139.7], [-23.5, -46.6]]) {
    const p = pointing({ latDeg: la, lonDeg: lo });
    const ref = vectorLookAngles(la, lo, 25.8);
    near(p.elevationDeg, ref.el, 0.5);
    if (ref.el > 0) near(((p.azimuthTrueDeg - ref.az + 540) % 360) - 180, 0, 0.5);
  }
  assert.equal(pointing({ latDeg: 35.7, lonDeg: 139.7 }).visible, false);
  assert.throws(() => pointing({ latDeg: 91, lonDeg: 0 }), RangeError);
});

test('Friis cascade', () => {
  const r = cascade([{ nfDb: 3, gainDb: 10 }, { nfDb: 6, gainDb: 20 }]);
  near(r.noiseFigureDb, 10 * Math.log10(10 ** 0.3 + (10 ** 0.6 - 1) / 10), 1e-9);
  near(r.noiseFigureDb, 3.605, 0.01);
  near(r.gainDb, 30, 1e-9);
  // 3 dB passive loss ahead of a 3 dB NF stage: 6.02 dB
  near(cascade([{ nfDb: 3.0103, gainDb: -3.0103 }, { nfDb: 3.0103, gainDb: 20 }]).noiseFigureDb, 6.02, 0.01);
  near(cascade([{ nfDb: 0, gainDb: 0 }]).noiseTempK, 0, 1e-9);
});

test('LNB line-up budget is self-consistent', () => {
  const r = lnbLineup({
    dishGainDbi: 33.8, antennaTempK: 50, lnbNfDb: 0.5, lnbGainDb: 55, coaxLossDb: 3, biasTLossDb: 0.5, sdrNfDb: 6,
    eirpDbw: 10, slantRangeKm: 38000, freqHz: 10.489e9, bandwidthHz: 2500, atmLossDb: 0.5,
  });
  near(r.fsplDb, 204.45, 0.1);
  near(r.gtDbK, 33.8 - 10 * Math.log10(r.systemTempK), 1e-9);
  near(r.cn0DbHz, 10 - r.fsplDb - 0.5 + r.gtDbK + 228.6, 1e-9);
  near(r.snrDb, r.cn0DbHz - 10 * Math.log10(2500), 1e-9);
  assert.ok(r.systemTempK > 50);
});

test('helix dimensions at 2.4 GHz', () => {
  const h = helix({ freqHz: 2.4e9, turns: 6 });
  near(h.circumferenceMm, 124.9, 0.05);
  near(h.pitchMm, 31.2, 0.05);
  near(h.gainDbi, 10 * Math.log10(15 * 6 * 0.25), 1e-9);
  near(h.hpbwDeg, 52 / Math.sqrt(1.5), 1e-9);
  near(h.impedanceOhm, 140, 1e-9);
  assert.throws(() => helix({ freqHz: 2.4e9, turns: 1 }), RangeError);
});

test('IF / LO calculations', () => {
  near(ifFromRf(10489.75, 9750), 739.75, 1e-9);
  near(rfFromIf(739.75, 9750), 10489.75, 1e-9);
  near(uplinkFromDownlink(10489.5), 2400, 1e-9);
  near(pllLoMHz(25, 390), 9750, 1e-9);
  const d = loDrift({ beaconRfMHz: 10489.75, measuredIfMHz: 739.7505, nominalLoMHz: 9750 });
  near(d.driftHz, -500, 1e-3);
  near(d.driftPpm, -500 / 9750, 1e-6);
});

test('PHP plugin escapes output and makes no remote requests', () => {
  const php = read('qo100-calculators.php') + read('uninstall.php');
  for (const line of php.split('\n')) {
    if (/\b(echo|print)\b/.test(line) && !/\/\/|^\s*\*/.test(line)) assert.match(line, /esc_/, line);
  }
  assert.doesNotMatch(php, /wp_remote_|curl_|file_get_contents|fsockopen|add_option|update_option|\$wpdb/);
  assert.match(php, /License:\s+GPL-3\.0-or-later/);
  assert.match(php, /Text Domain:\s+bricohams-qo100/);
  for (const tag of ['dish', 'pointing', 'lnb', 'helix', 'ifcalc']) assert.ok(php.includes(`'${tag}'`));
  assert.match(php, /qo100_calculators/);
});

test('PHP string keys match the JS STRINGS keys', () => {
  const php = [...read('qo100-calculators.php').matchAll(/^\t\t'(\w+)'\s*=>\s*__\(/gm)].map((m) => m[1]).sort();
  const js = read('assets/qo100-calc.js');
  const block = js.slice(js.indexOf('export const STRINGS = {'), js.indexOf('\n};', js.indexOf('export const STRINGS')));
  const keys = [...block.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]).sort();
  assert.ok(keys.length > 50);
  assert.deepEqual(php, keys);
});

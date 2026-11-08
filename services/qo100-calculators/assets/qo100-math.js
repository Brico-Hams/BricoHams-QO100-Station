// Pure QO-100 calculator maths. No DOM, no network, no dependencies.
// Formulas re-derived from textbook sources (see README.md); no third-party code is used.

export const C_M_S = 299792458;
export const EARTH_RADIUS_KM = 6378.137;
export const GEO_RADIUS_KM = 42164;
export const QO100_LON_DEG = 25.8;
export const BOLTZMANN_DBW = -228.6; // 10*log10(k) in dBW/K/Hz
export const T0_K = 290;
export const UPLINK_DOWNLINK_OFFSET_MHZ = 8089.5;

const DEG = Math.PI / 180;
const db10 = (x) => 10 * Math.log10(x);

/**
 * Validates a finite number inside [min, max].
 * @param {unknown} v value
 * @param {string} name field name used in the error message
 * @param {number} [min]
 * @param {number} [max]
 * @returns {number}
 * @throws {RangeError} when the value is not a finite number in range
 */
export function checkNum(v, name, min = -Infinity, max = Infinity) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new RangeError(`${name} out of range`);
  }
  return v;
}

/**
 * Wavelength in metres.
 * @param {number} freqHz frequency in Hz (> 0)
 * @returns {number}
 */
export function wavelengthM(freqHz) {
  checkNum(freqHz, 'freqHz', 1);
  return C_M_S / freqHz;
}

/**
 * Parabolic dish gain G = eta*(pi*D/lambda)^2 and -3 dB beamwidth ~ 70*lambda/D.
 * @param {{diameterM:number, freqHz:number, efficiency:number}} p efficiency in (0,1]
 * @returns {{gainDbi:number, gainLinear:number, beamwidthDeg:number, wavelengthM:number}}
 */
export function dishGain({ diameterM, freqHz, efficiency }) {
  checkNum(diameterM, 'diameterM', 0.01, 100);
  checkNum(efficiency, 'efficiency', 0.01, 1);
  const lambda = wavelengthM(freqHz);
  const gainLinear = efficiency * (Math.PI * diameterM / lambda) ** 2;
  return {
    gainDbi: db10(gainLinear),
    gainLinear,
    beamwidthDeg: 70 * lambda / diameterM,
    wavelengthM: lambda,
  };
}

/**
 * Geostationary look angles on a spherical Earth.
 * Azimuth is atan2(E, N) of the station->satellite vector, which reduces to
 * atan2(sin(dLon), -sin(lat)*cos(dLon)); elevation uses the central angle gamma:
 * el = atan((cos(gamma) - Re/Rs) / sin(gamma)), cos(gamma) = cos(lat)*cos(dLon).
 * Skew is atan(sin(dLon)/tan(lat)); mountTilt subtracts the dish offset angle.
 * @param {{latDeg:number, lonDeg:number, satLonDeg?:number, declinationDeg?:number, offsetDeg?:number}} p
 *   lonDeg east positive; declinationDeg east positive.
 * @returns {{azimuthTrueDeg:number, azimuthMagneticDeg:number, elevationDeg:number,
 *   mountTiltDeg:number, skewDeg:number, slantRangeKm:number, visible:boolean}}
 */
export function pointing({ latDeg, lonDeg, satLonDeg = QO100_LON_DEG, declinationDeg = 0, offsetDeg = 0 }) {
  checkNum(latDeg, 'latDeg', -90, 90);
  checkNum(lonDeg, 'lonDeg', -180, 180);
  checkNum(satLonDeg, 'satLonDeg', -180, 180);
  checkNum(declinationDeg, 'declinationDeg', -90, 90);
  checkNum(offsetDeg, 'offsetDeg', 0, 90);
  const lat = latDeg * DEG;
  let dLon = (satLonDeg - lonDeg) % 360;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  const dl = dLon * DEG;
  const cosG = Math.cos(lat) * Math.cos(dl);
  const sinG = Math.sqrt(Math.max(0, 1 - cosG * cosG));
  const k = EARTH_RADIUS_KM / GEO_RADIUS_KM;
  const elevationDeg = sinG === 0 ? (cosG > 0 ? 90 : -90) : Math.atan2(cosG - k, sinG) / DEG;
  let az = Math.atan2(Math.sin(dl), -Math.sin(lat) * Math.cos(dl)) / DEG;
  az = (az + 360) % 360;
  const skewDeg = Math.abs(latDeg) < 1e-9 ? (dLon === 0 ? 0 : Math.sign(dLon) * 90) : Math.atan(Math.sin(dl) / Math.tan(lat)) / DEG;
  const slantRangeKm = Math.sqrt(EARTH_RADIUS_KM ** 2 + GEO_RADIUS_KM ** 2 - 2 * EARTH_RADIUS_KM * GEO_RADIUS_KM * cosG);
  return {
    azimuthTrueDeg: az,
    azimuthMagneticDeg: (az - declinationDeg + 720) % 360,
    elevationDeg,
    mountTiltDeg: elevationDeg - offsetDeg,
    skewDeg,
    slantRangeKm,
    visible: elevationDeg > 0,
  };
}

/**
 * Friis cascaded noise figure. F = F1 + (F2-1)/G1 + (F3-1)/(G1*G2) + ...
 * A passive loss is a stage with nfDb = lossDb and gainDb = -lossDb.
 * @param {{nfDb:number, gainDb:number}[]} stages in signal order
 * @returns {{noiseFigureDb:number, noiseTempK:number, gainDb:number}}
 */
export function cascade(stages) {
  if (!Array.isArray(stages) || stages.length === 0) throw new RangeError('stages required');
  let f = 0;
  let gainLin = 1;
  let gainDb = 0;
  stages.forEach((s, i) => {
    checkNum(s.nfDb, 'nfDb', 0, 100);
    checkNum(s.gainDb, 'gainDb', -100, 100);
    const fi = 10 ** (s.nfDb / 10);
    f += i === 0 ? fi : (fi - 1) / gainLin;
    gainLin *= 10 ** (s.gainDb / 10);
    gainDb += s.gainDb;
  });
  return { noiseFigureDb: db10(f), noiseTempK: T0_K * (f - 1), gainDb };
}

/**
 * Free-space path loss in dB.
 * @param {number} distanceKm
 * @param {number} freqHz
 * @returns {number}
 */
export function fsplDb(distanceKm, freqHz) {
  checkNum(distanceKm, 'distanceKm', 1);
  return 20 * Math.log10(4 * Math.PI * distanceKm * 1000 / wavelengthM(freqHz));
}

/**
 * LNB line-up and downlink budget: dish -> LNB -> coax -> bias-T -> SDR.
 * Tsys = Tant + Te(cascade referred to the LNB input); G/T = Gdish - 10log10(Tsys);
 * C/N0 = EIRP - FSPL - Latm + G/T - 10log10(k); SNR = C/N0 - 10log10(B).
 * @param {object} p
 * @param {number} p.dishGainDbi
 * @param {number} p.antennaTempK sky + spillover noise at the feed
 * @param {number} p.lnbNfDb
 * @param {number} p.lnbGainDb
 * @param {number} p.coaxLossDb
 * @param {number} p.biasTLossDb
 * @param {number} p.sdrNfDb
 * @param {number} p.eirpDbw downlink EIRP (user supplied; verify current value)
 * @param {number} p.slantRangeKm
 * @param {number} p.freqHz
 * @param {number} p.bandwidthHz
 * @param {number} [p.atmLossDb]
 * @returns {{noiseFigureDb:number, systemTempK:number, gtDbK:number, fsplDb:number, cn0DbHz:number, snrDb:number}}
 */
export function lnbLineup(p) {
  checkNum(p.antennaTempK, 'antennaTempK', 0, 1000);
  checkNum(p.eirpDbw, 'eirpDbw', -50, 100);
  checkNum(p.bandwidthHz, 'bandwidthHz', 1, 1e9);
  const atm = checkNum(p.atmLossDb ?? 0, 'atmLossDb', 0, 30);
  const casc = cascade([
    { nfDb: p.lnbNfDb, gainDb: p.lnbGainDb },
    { nfDb: checkNum(p.coaxLossDb, 'coaxLossDb', 0, 100), gainDb: -p.coaxLossDb },
    { nfDb: checkNum(p.biasTLossDb, 'biasTLossDb', 0, 100), gainDb: -p.biasTLossDb },
    { nfDb: p.sdrNfDb, gainDb: 0 },
  ]);
  const systemTempK = p.antennaTempK + casc.noiseTempK;
  const gtDbK = checkNum(p.dishGainDbi, 'dishGainDbi', -20, 100) - db10(systemTempK);
  const fspl = fsplDb(p.slantRangeKm, p.freqHz);
  const cn0DbHz = p.eirpDbw - fspl - atm + gtDbK - BOLTZMANN_DBW;
  return {
    noiseFigureDb: casc.noiseFigureDb,
    systemTempK,
    gtDbK,
    fsplDb: fspl,
    cn0DbHz,
    snrDb: cn0DbHz - db10(p.bandwidthHz),
  };
}

/**
 * Helix antenna (Kraus, axial mode): C = lambda, S = 0.25*lambda,
 * G = 15*(C/lambda)^2*n*S/lambda, HPBW = 52/((C/lambda)*sqrt(n*S/lambda)),
 * Z ~ 140*C/lambda ohm, axial ratio ~ (2n+1)/2n.
 * @param {{freqHz:number, turns:number}} p
 * @returns {object} dimensions in millimetres, gain in dBi, angles in degrees
 */
export function helix({ freqHz, turns }) {
  checkNum(turns, 'turns', 3, 50);
  const lambda = wavelengthM(freqHz);
  const c = lambda;
  const s = 0.25 * lambda;
  const gainLin = 15 * (c / lambda) ** 2 * turns * s / lambda;
  const zMatch = Math.sqrt(140 * 50);
  return {
    wavelengthMm: lambda * 1000,
    circumferenceMm: c * 1000,
    diameterMm: (c / Math.PI) * 1000,
    pitchMm: s * 1000,
    lengthMm: turns * s * 1000,
    wirePerTurnMm: Math.hypot(c, s) * 1000,
    totalWireMm: turns * Math.hypot(c, s) * 1000,
    gainDbi: db10(gainLin),
    hpbwDeg: 52 / ((c / lambda) * Math.sqrt(turns * s / lambda)),
    groundPlaneMinMm: 0.75 * lambda * 1000,
    groundPlaneRecMm: lambda * 1000,
    impedanceOhm: 140 * (c / lambda),
    matchStripOhm: zMatch,
    axialRatio: (2 * turns + 1) / (2 * turns),
  };
}

/**
 * LO frequency in MHz of a PLL LNB.
 * @param {number} refMHz reference oscillator
 * @param {number} multiplier PLL multiplication factor
 * @returns {number}
 */
export function pllLoMHz(refMHz, multiplier) {
  return checkNum(refMHz, 'refMHz', 1, 1000) * checkNum(multiplier, 'multiplier', 1, 10000);
}

/**
 * IF = RF - LO (all MHz). Valid for the usual low-side LO.
 * @param {number} rfMHz
 * @param {number} loMHz
 * @returns {number}
 */
export function ifFromRf(rfMHz, loMHz) {
  return checkNum(rfMHz, 'rfMHz', 1) - checkNum(loMHz, 'loMHz', 1);
}

/**
 * RF = IF + LO (all MHz).
 * @param {number} ifMHz
 * @param {number} loMHz
 * @returns {number}
 */
export function rfFromIf(ifMHz, loMHz) {
  return checkNum(ifMHz, 'ifMHz', 0) + checkNum(loMHz, 'loMHz', 1);
}

/**
 * Uplink frequency matching a downlink frequency (downlink - 8089.5 MHz).
 * @param {number} downMHz
 * @returns {number}
 */
export function uplinkFromDownlink(downMHz) {
  return checkNum(downMHz, 'downMHz', 1) - UPLINK_DOWNLINK_OFFSET_MHZ;
}

/**
 * Real LO from a measured beacon IF and the LO drift against the nominal LO.
 * @param {{beaconRfMHz:number, measuredIfMHz:number, nominalLoMHz:number}} p
 * @returns {{actualLoMHz:number, driftHz:number, driftPpm:number}}
 */
export function loDrift({ beaconRfMHz, measuredIfMHz, nominalLoMHz }) {
  const actualLoMHz = checkNum(beaconRfMHz, 'beaconRfMHz', 1) - checkNum(measuredIfMHz, 'measuredIfMHz', 0);
  const driftMHz = actualLoMHz - checkNum(nominalLoMHz, 'nominalLoMHz', 1);
  return { actualLoMHz, driftHz: driftMHz * 1e6, driftPpm: (driftMHz / nominalLoMHz) * 1e6 };
}

// BricoHams manual: computed charts. Run `node docs/manual/figures/generate-charts.mjs` to (re)write the four SVG files.
// The maths is exported as pure functions so test/unit/manual-charts.test.js can check known values.
// No dependencies; the output is plain SVG with an opaque light background so it reads the same in light and dark pages.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const NAVY = '#12263f';
const ORANGE = '#e8871e';
const GREY = '#5b6b7b';
const LIGHT = '#f7f8fa';

/**
 * Complementary error function, accurate to about 1e-12 relative over the range used here.
 * Power series for small x (no cancellation: all terms are positive), continued fraction for the tail.
 * @param {number} x
 * @returns {number}
 */
export function erfc(x) {
  if (x < 0) return 2 - erfc(-x);
  if (x < 2.5) {
    let term = x;
    let sum = x;
    for (let n = 1; n < 200; n++) {
      term *= (2 * x * x) / (2 * n + 1);
      sum += term;
      if (term < 1e-17 * sum) break;
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * Math.exp(-x * x) * sum;
  }
  let t = x;
  for (let k = 80; k >= 1; k--) t = x + k / 2 / t;
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * t);
}

/**
 * Gaussian tail probability Q(x).
 * @param {number} x
 * @returns {number}
 */
export function qfunc(x) {
  return 0.5 * erfc(x / Math.SQRT2);
}

/**
 * Bit error rate of BPSK (and of Gray-coded QPSK, per bit) in AWGN: Q(sqrt(2 Eb/N0)).
 * @param {number} ebn0Db Eb/N0 in dB.
 * @returns {number}
 */
export function berPsk(ebn0Db) {
  return qfunc(Math.sqrt(2 * 10 ** (ebn0Db / 10)));
}

/**
 * Approximate bit error rate of Gray-coded square M-QAM in AWGN (tight above ~1e-3).
 * @param {number} m Constellation size: 4, 16, 64, 256...
 * @param {number} ebn0Db Eb/N0 in dB.
 * @returns {number}
 */
export function berQam(m, ebn0Db) {
  const k = Math.log2(m);
  if (!Number.isInteger(k) || k % 2 !== 0) throw new RangeError('m must be a square power of two');
  const g = 10 ** (ebn0Db / 10);
  const p = ((4 / k) * (1 - 1 / Math.sqrt(m))) * qfunc(Math.sqrt(((3 * k) / (m - 1)) * g));
  return Math.min(p, 0.5);
}

/**
 * Shannon capacity per unit bandwidth of an AWGN channel.
 * @param {number} snrDb Signal-to-noise ratio in dB.
 * @returns {number} Bits per second per hertz.
 */
export function shannonSpectralEfficiency(snrDb) {
  return Math.log2(1 + 10 ** (snrDb / 10));
}

/**
 * Fraction of the transmitted OFDM symbol time spent on the cyclic prefix: Ncp / (N + Ncp).
 * @param {number} n FFT size.
 * @param {number} cp Cyclic prefix length in samples.
 * @returns {number} Value between 0 and 1.
 */
export function cpOverhead(n, cp) {
  if (!(n > 0) || !(cp >= 0)) throw new RangeError('n must be positive and cp non-negative');
  return cp / (n + cp);
}

/**
 * Raised-cosine spectrum, normalised so H(0) = 1.
 * @param {number} fT Frequency times the symbol period (f / Rs).
 * @param {number} alpha Roll-off factor, 0 to 1.
 * @returns {number}
 */
export function raisedCosine(fT, alpha) {
  const a = Math.abs(fT);
  const lo = (1 - alpha) / 2;
  const hi = (1 + alpha) / 2;
  if (alpha === 0) return a < 0.5 ? 1 : a === 0.5 ? 0.5 : 0;
  if (a <= lo) return 1;
  if (a >= hi) return 0;
  return 0.5 * (1 + Math.cos((Math.PI / alpha) * (a - lo)));
}

const fmt = (v) => (Math.round(v * 100) / 100).toString();

function frame(title, desc, body, { width = 800, height = 500 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="t d">
<title id="t">${title}</title>
<desc id="d">${desc}</desc>
<style>text{font:14px system-ui,'Segoe UI',Arial,sans-serif;fill:${NAVY}}.s{font-size:12px;fill:${GREY}}.b{font-weight:700}.h{font-size:16px;font-weight:700}.grid{stroke:#d5dbe2;stroke-width:1}.axis{stroke:${NAVY};stroke-width:1.5}</style>
<rect width="${width}" height="${height}" fill="${LIGHT}"/>
${body}
<text x="${width - 10}" y="${height - 10}" text-anchor="end" class="s">BricoHams · bricohams.org</text>
</svg>
`;
}

function plotFrame({ x0, x1, y0, y1, xTicks, yTicks, xLabel, yLabel }) {
  let out = '';
  for (const t of xTicks) out += `<line class="grid" x1="${fmt(t.px)}" y1="${y0}" x2="${fmt(t.px)}" y2="${y1}"/><text x="${fmt(t.px)}" y="${y1 + 18}" text-anchor="middle" class="s">${t.label}</text>`;
  for (const t of yTicks) out += `<line class="grid" x1="${x0}" y1="${fmt(t.py)}" x2="${x1}" y2="${fmt(t.py)}"/><text x="${x0 - 8}" y="${fmt(t.py + 4)}" text-anchor="end" class="s">${t.label}</text>`;
  out += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" class="axis"/>`;
  out += `<text x="${(x0 + x1) / 2}" y="${y1 + 42}" text-anchor="middle">${xLabel}</text>`;
  out += `<text transform="translate(24 ${(y0 + y1) / 2}) rotate(-90)" text-anchor="middle">${yLabel}</text>`;
  return out;
}

/**
 * Builds the BER chart: BPSK/QPSK, 16-QAM and 64-QAM in AWGN, log scale 1e-12..1.
 * @returns {string} SVG document.
 */
export function berChartSvg() {
  const x0 = 80; const x1 = 760; const y0 = 60; const y1 = 420;
  const px = (db) => x0 + (db / 24) * (x1 - x0);
  const py = (ber) => y0 + ((0 - Math.log10(ber)) / 12) * (y1 - y0);
  const xTicks = []; for (let d = 0; d <= 24; d += 4) xTicks.push({ px: px(d), label: `${d}` });
  const yTicks = []; for (let e = 0; e >= -12; e -= 2) yTicks.push({ py: py(10 ** e), label: e === 0 ? '1' : `1e${e}` });
  const curves = [
    { name: 'BPSK / QPSK', f: berPsk, style: `stroke="${NAVY}" stroke-width="3" stroke-dasharray="none"`, lx: 190 },
    { name: '16-QAM', f: (d) => berQam(16, d), style: `stroke="${ORANGE}" stroke-width="3" stroke-dasharray="12 4"`, lx: 330 },
    { name: '64-QAM', f: (d) => berQam(64, d), style: `stroke="${GREY}" stroke-width="3" stroke-dasharray="2 4"`, lx: 480 },
  ];
  let body = plotFrame({ x0, x1, y0, y1, xTicks, yTicks, xLabel: 'Eb/N0 (dB)', yLabel: 'Tasa de error de bit (BER)' });
  body += `<text x="${x0}" y="36" class="h">BER teórico en canal AWGN (codificación Gray)</text>`;
  for (const c of curves) {
    const pts = [];
    for (let d = 0; d <= 24.001; d += 0.1) {
      const b = c.f(d);
      if (b < 1e-12) break;
      pts.push(`${fmt(px(d))},${fmt(py(b))}`);
    }
    body += `<polyline fill="none" ${c.style} points="${pts.join(' ')}"/>`;
  }
  body += `<circle cx="${fmt(px(9.6))}" cy="${fmt(py(berPsk(9.6)))}" r="5" fill="${ORANGE}" stroke="${NAVY}" stroke-width="1.5"/>`;
  body += `<text x="${fmt(px(9.6) + 10)}" y="${fmt(py(berPsk(9.6)) - 8)}" class="s">9,6 dB → ~1e-5</text>`;
  curves.forEach((c, i) => {
    const y = 90 + i * 22;
    body += `<line x1="600" y1="${y}" x2="640" y2="${y}" fill="none" ${c.style}/><text x="648" y="${y + 4}">${c.name}</text>`;
  });
  return frame('BER frente a Eb/N0 para BPSK/QPSK, 16-QAM y 64-QAM',
    'Curvas teóricas de tasa de error de bit en canal AWGN con escala logarítmica de 1e-12 a 1. Cada modulación más densa necesita más Eb/N0 para la misma BER. BPSK alcanza 1e-5 hacia 9,6 dB.', body);
}

/**
 * Builds the Shannon capacity chart (bit/s/Hz against SNR, 0 to 30 dB).
 * @returns {string} SVG document.
 */
export function shannonChartSvg() {
  const x0 = 80; const x1 = 760; const y0 = 60; const y1 = 420;
  const px = (db) => x0 + (db / 30) * (x1 - x0);
  const py = (c) => y1 - (c / 10) * (y1 - y0);
  const xTicks = []; for (let d = 0; d <= 30; d += 5) xTicks.push({ px: px(d), label: `${d}` });
  const yTicks = []; for (let c = 0; c <= 10; c += 2) yTicks.push({ py: py(c), label: `${c}` });
  let body = plotFrame({ x0, x1, y0, y1, xTicks, yTicks, xLabel: 'SNR (dB)', yLabel: 'C / B (bit/s/Hz)' });
  body += `<text x="${x0}" y="36" class="h">Capacidad de Shannon por hercio</text>`;
  const pts = []; const approx = [];
  for (let d = 0; d <= 30.001; d += 0.25) {
    pts.push(`${fmt(px(d))},${fmt(py(shannonSpectralEfficiency(d)))}`);
    if (d >= 6) approx.push(`${fmt(px(d))},${fmt(py(d / 3.0103))}`);
  }
  body += `<polyline fill="none" stroke="${GREY}" stroke-width="2" stroke-dasharray="7 5" points="${approx.join(' ')}"/>`;
  body += `<polyline fill="none" stroke="${NAVY}" stroke-width="3" points="${pts.join(' ')}"/>`;
  for (const d of [0, 10, 20]) {
    const c = shannonSpectralEfficiency(d);
    body += `<circle cx="${fmt(px(d))}" cy="${fmt(py(c))}" r="5" fill="${ORANGE}" stroke="${NAVY}" stroke-width="1.5"/><text x="${fmt(px(d) + 8)}" y="${fmt(py(c) + 18)}" class="s">${d} dB: ${c.toFixed(2).replace('.', ',')}</text>`;
  }
  body += `<line x1="520" y1="120" x2="560" y2="120" stroke="${NAVY}" stroke-width="3"/><text x="568" y="124">log2(1 + SNR)</text>`;
  body += `<line x1="520" y1="144" x2="560" y2="144" stroke="${GREY}" stroke-width="2" stroke-dasharray="7 5"/><text x="568" y="148">SNR(dB) / 3,01 (SNR alta)</text>`;
  return frame('Capacidad de canal AWGN en bit/s/Hz entre 0 y 30 dB de SNR',
    'La capacidad por hercio vale 1 bit/s/Hz a 0 dB, 3,46 a 10 dB y 6,66 a 20 dB. A SNR alta crece unos 3,3 bit/s/Hz por cada 10 dB, casi una recta.', body);
}

/**
 * Builds the OFDM cyclic-prefix overhead bar chart for N = 64.
 * @returns {string} SVG document.
 */
export function cpChartSvg() {
  const n = 64;
  const cps = [4, 8, 16, 32];
  const x0 = 80; const x1 = 760; const y0 = 60; const y1 = 420;
  const py = (pct) => y1 - (pct / 40) * (y1 - y0);
  const yTicks = []; for (let p = 0; p <= 40; p += 10) yTicks.push({ py: py(p), label: `${p} %` });
  let body = plotFrame({ x0, x1, y0, y1, xTicks: [], yTicks, xLabel: 'Longitud del prefijo cíclico (muestras), N = 64', yLabel: 'Tiempo útil perdido (%)' });
  body += `<text x="${x0}" y="36" class="h">Coste del prefijo cíclico: Ncp / (N + Ncp)</text>`;
  const slot = (x1 - x0) / cps.length;
  cps.forEach((cp, i) => {
    const pct = cpOverhead(n, cp) * 100;
    const bx = x0 + slot * i + slot * 0.2;
    const fill = cp === 16 ? ORANGE : NAVY;
    body += `<rect x="${fmt(bx)}" y="${fmt(py(pct))}" width="${fmt(slot * 0.6)}" height="${fmt(y1 - py(pct))}" fill="${fill}"/>`;
    body += `<text x="${fmt(bx + slot * 0.3)}" y="${fmt(py(pct) - 8)}" text-anchor="middle" class="b">${pct.toFixed(1).replace('.', ',')} %</text>`;
    body += `<text x="${fmt(bx + slot * 0.3)}" y="${y1 + 18}" text-anchor="middle" class="s">CP = ${cp}</text>`;
  });
  return frame('Sobrecarga del prefijo cíclico en OFDM con N = 64',
    'Barras para prefijos de 4, 8, 16 y 32 muestras sobre 64: 5,9 %, 11,1 %, 20 % y 33,3 % del tiempo de símbolo. El prefijo de 16 muestras, en naranja, cuesta el 20 %.', body);
}

/**
 * Builds the raised-cosine frequency response chart for alpha 0, 0.25, 0.5, 0.75 and 1.
 * @returns {string} SVG document.
 */
export function raisedCosineChartSvg() {
  const x0 = 80; const x1 = 760; const y0 = 60; const y1 = 420;
  const px = (v) => x0 + ((v + 1) / 2) * (x1 - x0);
  const py = (h) => y1 - h * (y1 - y0 - 20);
  const xTicks = []; for (let v = -1; v <= 1.001; v += 0.5) xTicks.push({ px: px(v), label: v.toFixed(1).replace('.', ',') });
  const yTicks = []; for (let h = 0; h <= 1.001; h += 0.25) yTicks.push({ py: py(h), label: h.toFixed(2).replace('.', ',') });
  let body = plotFrame({ x0, x1, y0, y1, xTicks, yTicks, xLabel: 'Frecuencia normalizada f·T (T = periodo de símbolo)', yLabel: 'Respuesta |H(f)| normalizada' });
  body += `<text x="${x0}" y="36" class="h">Filtro de coseno alzado según el factor de caída α</text>`;
  const styles = [
    { a: 0, s: `stroke="${NAVY}" stroke-width="3"` },
    { a: 0.25, s: `stroke="${ORANGE}" stroke-width="3" stroke-dasharray="12 4"` },
    { a: 0.5, s: `stroke="${GREY}" stroke-width="3" stroke-dasharray="2 4"` },
    { a: 0.75, s: `stroke="${NAVY}" stroke-width="3" stroke-dasharray="9 5"` },
    { a: 1, s: `stroke="${ORANGE}" stroke-width="3" stroke-dasharray="14 4 2 4"` },
  ];
  styles.forEach((c, i) => {
    const pts = [];
    if (c.a === 0) {
      for (const [v, h] of [[-1, 0], [-0.5, 0], [-0.5, 1], [0.5, 1], [0.5, 0], [1, 0]]) pts.push(`${fmt(px(v))},${fmt(py(h))}`);
    } else {
      for (let k = 0; k <= 400; k++) {
        const v = -1 + k / 200;
        pts.push(`${fmt(px(v))},${fmt(py(raisedCosine(v, c.a)))}`);
      }
    }
    body += `<polyline fill="none" ${c.s} points="${pts.join(' ')}"/>`;
    const ly = 92 + i * 20;
    body += `<line x1="${x1 - 150}" y1="${ly}" x2="${x1 - 110}" y2="${ly}" fill="none" ${c.s}/><text x="${x1 - 102}" y="${ly + 4}">α = ${String(c.a).replace('.', ',')}</text>`;
  });
  return frame('Respuesta en frecuencia del coseno alzado para α = 0, 0,25, 0,5, 0,75 y 1',
    'Cinco curvas simétricas respecto de f = 0. Con α = 0 la respuesta es un rectángulo con borde en f·T = 0,5. Al subir α el borde se suaviza y el ancho ocupado crece hasta (1 + α)/2 a cada lado.', body);
}

/**
 * Renders every chart.
 * @returns {Record<string, string>} Map of file name to SVG text.
 */
export function renderAll() {
  return {
    'fig-23-ber-teorico-qam.svg': berChartSvg(),
    'fig-24-capacidad-shannon.svg': shannonChartSvg(),
    'fig-25-ofdm-prefijo-ciclico.svg': cpChartSvg(),
    'fig-26-coseno-alzado.svg': raisedCosineChartSvg(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = dirname(fileURLToPath(import.meta.url));
  for (const [name, svg] of Object.entries(renderAll())) {
    writeFileSync(join(dir, name), svg);
    console.log(`written ${name}`);
  }
}

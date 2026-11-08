// BricoHams QO-100 calculators UI. Builds forms from a spec using DOM APIs only (no innerHTML).
// UI strings default to Spanish; WordPress overrides them through the data-i18n attribute.
import {
  dishGain, pointing, lnbLineup, helix, pllLoMHz, ifFromRf, rfFromIf, uplinkFromDownlink, loDrift,
  UPLINK_DOWNLINK_OFFSET_MHZ,
} from './qo100-math.js';

export const STRINGS = {
  err_input: 'Revisa los valores: alguno no es válido o está fuera de rango.',
  calc: 'Calcular',
  results: 'Resultados',
  sources: 'Fuentes de las fórmulas',
  course: 'Curso Iniciación QO-100, EA5EN Mateo',
  disclaimer: 'Cálculos orientativos; verifica con medidas reales.',
  dish_title: 'Antena parabólica: ganancia y apertura',
  dish_diam: 'Diámetro (m)',
  dish_eta: 'Eficiencia (0-1)',
  dish_freq: 'Frecuencia',
  dish_f_down: '10,489 GHz (bajada)',
  dish_f_up: '2,400 GHz (subida)',
  dish_f_custom: 'Personalizada (GHz)',
  dish_fc: 'Frecuencia personalizada (GHz)',
  r_gain: 'Ganancia',
  r_bw: 'Ancho de haz a -3 dB',
  r_lambda: 'Longitud de onda',
  point_title: 'Apuntado de la parabólica a QO-100 (25,8° E)',
  p_lat: 'Latitud (° N positivo)',
  p_lon: 'Longitud (° E positivo)',
  p_decl: 'Declinación magnética (° E positivo, la introduces tú)',
  p_off: 'Ángulo de offset del plato (°; 0 si es simétrico)',
  p_geo: 'Usar mi ubicación',
  p_geo_err: 'No se pudo obtener la ubicación; introdúcela a mano.',
  r_az_t: 'Azimut verdadero',
  r_az_m: 'Azimut magnético',
  r_el: 'Elevación real al satélite',
  r_tilt: 'Inclinación del plato a ajustar (elevación - offset)',
  r_skew: 'Skew del LNB (signo según convención del dibujo; ver README)',
  r_range: 'Distancia al satélite',
  r_novis: 'Atención: QO-100 no es visible desde esta posición.',
  lnb_title: 'Línea LNB y balance de enlace',
  l_gain: 'Ganancia de la parabólica (dBi)',
  l_tant: 'Temperatura de antena (K)',
  l_lnbnf: 'NF del LNB (dB)',
  l_lnbg: 'Ganancia del LNB (dB)',
  l_coax: 'Pérdida del coaxial (dB)',
  l_bias: 'Pérdida del bias-T (dB)',
  l_sdrnf: 'NF del SDR (dB)',
  l_eirp: 'EIRP de bajada (dBW)',
  l_eirp_note: 'Valor orientativo editable: verifica el EIRP vigente.',
  l_range: 'Distancia al satélite (km)',
  l_bw: 'Ancho de banda (Hz)',
  l_atm: 'Pérdida atmosférica (dB)',
  r_nf: 'Figura de ruido total',
  r_tsys: 'Temperatura de sistema',
  r_gt: 'G/T',
  r_fspl: 'Pérdida en espacio libre',
  r_cn0: 'C/N0',
  r_snr: 'SNR en el ancho de banda',
  helix_title: 'Hélice de 2,4 GHz (alimentador RHCP, Kraus)',
  h_freq: 'Frecuencia (MHz)',
  h_turns: 'Número de vueltas',
  r_circ: 'Circunferencia (≈ λ)',
  r_diam: 'Diámetro de la hélice',
  r_pitch: 'Paso (≈ 0,25 λ)',
  r_len: 'Longitud axial',
  r_wire: 'Hilo total aproximado',
  r_hgain: 'Ganancia estimada',
  r_hpbw: 'HPBW',
  r_gp: 'Plano de masa (mínimo 0,75 λ, recomendado ≈ 1 λ)',
  r_z: 'Impedancia aproximada',
  r_match: 'Banda de adaptación λ/4 (para 50 Ω)',
  r_ar: 'Relación axial aproximada',
  h_note: 'Conductor de cobre o latón de ~3-4 mm; alimenta en el plano de masa. Adapta los ~140 Ω a 50 Ω con una tira λ/4 de ~84 Ω que se estrecha sobre la primera media vuelta.',
  if_title: 'LO e IF del LNB',
  i_lo: 'LO del LNB',
  i_lo_9750: '9750 MHz',
  i_lo_9739: '9739 MHz',
  i_lo_pll: 'PLL (referencia × factor)',
  i_lo_custom: 'Personalizado (MHz)',
  i_custom: 'LO personalizado (MHz)',
  i_ref: 'Referencia PLL (MHz)',
  i_mul: 'Factor PLL',
  i_rf: 'Frecuencia de bajada RF (MHz)',
  i_meas: 'IF medida de la baliza (MHz, opcional)',
  i_beacon: 'Baliza de referencia (MHz)',
  r_lo: 'LO usado',
  r_if: 'IF de la frecuencia',
  r_up: 'Subida correspondiente (RF - 8089,5)',
  r_edge_lo: 'IF del borde inferior NB (10489,500)',
  r_edge_hi: 'IF del borde superior NB (10490,000)',
  r_beacon_if: 'IF esperada de la baliza',
  r_actual_lo: 'LO real estimado',
  r_drift: 'Deriva del LO',
};

const SOURCES = {
  dish: [['rftools.io: antena parabólica', 'https://rftools.io/es/calculators/antenna/parabolic-dish-antenna/']],
  pointing: [
    ['eshail.batc.org.uk/point', 'https://eshail.batc.org.uk/point/'],
    ['dishpointer.com', 'https://www.dishpointer.com/es/'],
  ],
  lnb: [['pabr.org lnblineup', 'https://www.pabr.org/radio/lnblineup/lnblineup.en.html']],
  helix: [['J. D. Kraus, Antennas (helix de modo axial)', null]],
  ifcalc: [['eshail.batc.org.uk/nb', 'https://eshail.batc.org.uk/nb/']],
};

const BEACONS = ['10489.750', '10489.500', '10490.000'];

const f = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');

const SPECS = {
  dish: {
    title: 'dish_title',
    fields: [
      { n: 'd', l: 'dish_diam', v: 0.6, step: 'any' },
      { n: 'eta', l: 'dish_eta', v: 0.55, step: 'any' },
      { n: 'fsel', l: 'dish_freq', select: [['10.489', 'dish_f_down'], ['2.4', 'dish_f_up'], ['custom', 'dish_f_custom']] },
      { n: 'fc', l: 'dish_fc', v: 10.489, step: 'any' },
    ],
    compute(v) {
      const ghz = v.fsel === 'custom' ? v.fc : Number(v.fsel);
      const r = dishGain({ diameterM: v.d, efficiency: v.eta, freqHz: ghz * 1e9 });
      return [['r_gain', `${f(r.gainDbi)} dBi`], ['r_bw', `${f(r.beamwidthDeg)}°`], ['r_lambda', `${f(r.wavelengthM * 1000, 1)} mm`]];
    },
  },
  pointing: {
    title: 'point_title',
    geo: true,
    fields: [
      { n: 'lat', l: 'p_lat', v: 40.4168, step: 'any' },
      { n: 'lon', l: 'p_lon', v: -3.7038, step: 'any' },
      { n: 'decl', l: 'p_decl', v: 0, step: 'any' },
      { n: 'off', l: 'p_off', v: 0, step: 'any' },
    ],
    compute(v, t) {
      const r = pointing({ latDeg: v.lat, lonDeg: v.lon, declinationDeg: v.decl, offsetDeg: v.off });
      const rows = [
        ['r_az_t', `${f(r.azimuthTrueDeg)}°`], ['r_az_m', `${f(r.azimuthMagneticDeg)}°`],
        ['r_el', `${f(r.elevationDeg)}°`], ['r_tilt', `${f(r.mountTiltDeg)}°`],
        ['r_skew', `${f(r.skewDeg)}°`], ['r_range', `${f(r.slantRangeKm, 0)} km`],
      ];
      if (!r.visible) rows.unshift(['r_novis', '']);
      return rows;
    },
  },
  lnb: {
    title: 'lnb_title',
    fields: [
      { n: 'g', l: 'l_gain', v: 33.8, step: 'any' },
      { n: 'tant', l: 'l_tant', v: 50, step: 'any' },
      { n: 'lnbnf', l: 'l_lnbnf', v: 0.5, step: 'any' },
      { n: 'lnbg', l: 'l_lnbg', v: 55, step: 'any' },
      { n: 'coax', l: 'l_coax', v: 3, step: 'any' },
      { n: 'bias', l: 'l_bias', v: 0.5, step: 'any' },
      { n: 'sdrnf', l: 'l_sdrnf', v: 6, step: 'any' },
      { n: 'eirp', l: 'l_eirp', v: 10, step: 'any', note: 'l_eirp_note' },
      { n: 'range', l: 'l_range', v: 38000, step: 'any' },
      { n: 'bw', l: 'l_bw', v: 2500, step: 'any' },
      { n: 'atm', l: 'l_atm', v: 0.5, step: 'any' },
    ],
    compute(v) {
      const r = lnbLineup({
        dishGainDbi: v.g, antennaTempK: v.tant, lnbNfDb: v.lnbnf, lnbGainDb: v.lnbg, coaxLossDb: v.coax,
        biasTLossDb: v.bias, sdrNfDb: v.sdrnf, eirpDbw: v.eirp, slantRangeKm: v.range, freqHz: 10.489e9,
        bandwidthHz: v.bw, atmLossDb: v.atm,
      });
      return [
        ['r_nf', `${f(r.noiseFigureDb)} dB`], ['r_tsys', `${f(r.systemTempK, 1)} K`], ['r_gt', `${f(r.gtDbK)} dB/K`],
        ['r_fspl', `${f(r.fsplDb)} dB`], ['r_cn0', `${f(r.cn0DbHz)} dBHz`], ['r_snr', `${f(r.snrDb)} dB`],
      ];
    },
  },
  helix: {
    title: 'helix_title',
    fields: [
      { n: 'f', l: 'h_freq', v: 2400, step: 'any' },
      { n: 'n', l: 'h_turns', v: 6, step: 1 },
    ],
    note: 'h_note',
    compute(v) {
      const r = helix({ freqHz: v.f * 1e6, turns: v.n });
      return [
        ['r_circ', `${f(r.circumferenceMm, 1)} mm`], ['r_diam', `${f(r.diameterMm, 1)} mm`], ['r_pitch', `${f(r.pitchMm, 1)} mm`],
        ['r_len', `${f(r.lengthMm, 1)} mm`], ['r_wire', `${f(r.totalWireMm, 0)} mm`], ['r_hgain', `${f(r.gainDbi)} dBi`],
        ['r_hpbw', `${f(r.hpbwDeg, 1)}°`], ['r_gp', `${f(r.groundPlaneMinMm, 0)} - ${f(r.groundPlaneRecMm, 0)} mm`],
        ['r_z', `${f(r.impedanceOhm, 0)} Ω`], ['r_match', `${f(r.matchStripOhm, 0)} Ω`], ['r_ar', f(r.axialRatio)],
      ];
    },
  },
  ifcalc: {
    title: 'if_title',
    fields: [
      { n: 'lo', l: 'i_lo', select: [['9750', 'i_lo_9750'], ['9739', 'i_lo_9739'], ['pll', 'i_lo_pll'], ['custom', 'i_lo_custom']] },
      { n: 'custom', l: 'i_custom', v: 9750, step: 'any' },
      { n: 'ref', l: 'i_ref', v: 25, step: 'any' },
      { n: 'mul', l: 'i_mul', v: 390, step: 'any' },
      { n: 'rf', l: 'i_rf', v: 10489.75, step: 'any' },
      { n: 'beacon', l: 'i_beacon', select: BEACONS.map((b) => [b, b]), raw: true },
      { n: 'meas', l: 'i_meas', v: '', step: 'any', optional: true },
    ],
    compute(v) {
      const lo = v.lo === 'pll' ? pllLoMHz(v.ref, v.mul) : v.lo === 'custom' ? v.custom : Number(v.lo);
      const rows = [
        ['r_lo', `${f(lo, 3)} MHz`], ['r_if', `${f(ifFromRf(v.rf, lo), 3)} MHz`],
        ['r_up', `${f(uplinkFromDownlink(v.rf), 3)} MHz`],
        ['r_edge_lo', `${f(ifFromRf(10489.5, lo), 3)} MHz`], ['r_edge_hi', `${f(ifFromRf(10490, lo), 3)} MHz`],
        ['r_beacon_if', `${f(ifFromRf(Number(v.beacon), lo), 3)} MHz`],
      ];
      if (v.meas !== undefined) {
        const d = loDrift({ beaconRfMHz: Number(v.beacon), measuredIfMHz: v.meas, nominalLoMHz: lo });
        rows.push(['r_actual_lo', `${f(d.actualLoMHz, 6)} MHz`], ['r_drift', `${f(d.driftHz, 0)} Hz (${f(d.driftPpm, 2)} ppm)`]);
      }
      return rows;
    },
  },
};

export { UPLINK_DOWNLINK_OFFSET_MHZ };

const el = (tag, attrs = {}, text) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};

/**
 * Reads form values: numbers by default, strings for selects, undefined for empty optional fields.
 * @param {HTMLFormElement} form
 * @param {object[]} fields spec fields
 * @returns {object}
 */
export function readValues(form, fields) {
  const out = {};
  for (const fd of fields) {
    const raw = form.elements[fd.n].value;
    if (fd.select) out[fd.n] = raw;
    else if (raw.trim() === '') out[fd.n] = fd.optional ? undefined : NaN;
    else out[fd.n] = Number(raw);
  }
  return out;
}

/**
 * Mounts one calculator into a container element.
 * @param {HTMLElement} root element with data-calc and optional data-i18n (JSON)
 * @returns {void}
 */
export function mount(root) {
  const spec = SPECS[root.dataset.calc];
  if (!spec) return;
  let over = {};
  try { over = JSON.parse(root.dataset.i18n || '{}'); } catch { over = {}; }
  const t = (k) => (typeof over[k] === 'string' ? over[k] : STRINGS[k] ?? k);
  const uid = `bh-${root.dataset.calc}-${Math.random().toString(36).slice(2, 7)}`;

  root.textContent = '';
  root.classList.add('bh-qo100');
  root.appendChild(el('h3', {}, t(spec.title)));
  const form = el('form', { class: 'bh-form', novalidate: '' });
  for (const fd of spec.fields) {
    const wrap = el('div', { class: 'bh-field' });
    wrap.appendChild(el('label', { for: `${uid}-${fd.n}` }, t(fd.l)));
    let input;
    if (fd.select) {
      input = el('select', { id: `${uid}-${fd.n}`, name: fd.n });
      for (const [val, lab] of fd.select) {
        const o = el('option', { value: val }, fd.raw ? lab : t(lab));
        input.appendChild(o);
      }
    } else {
      input = el('input', { id: `${uid}-${fd.n}`, name: fd.n, type: 'number', step: String(fd.step ?? 'any'), inputmode: 'decimal', value: String(fd.v) });
    }
    wrap.appendChild(input);
    if (fd.note) {
      input.setAttribute('aria-describedby', `${uid}-${fd.n}-note`);
      wrap.appendChild(el('small', { id: `${uid}-${fd.n}-note`, class: 'bh-note' }, t(fd.note)));
    }
    form.appendChild(wrap);
  }
  const actions = el('div', { class: 'bh-actions' });
  actions.appendChild(el('button', { type: 'submit', class: 'bh-btn' }, t('calc')));
  const out = el('div', { class: 'bh-results', role: 'status', 'aria-live': 'polite' });

  const run = () => {
    out.textContent = '';
    try {
      const rows = spec.compute(readValues(form, spec.fields), t);
      out.appendChild(el('h4', {}, t('results')));
      const dl = el('dl');
      for (const [k, val] of rows) {
        dl.appendChild(el('dt', {}, t(k)));
        dl.appendChild(el('dd', {}, val));
      }
      out.appendChild(dl);
    } catch {
      out.appendChild(el('p', { class: 'bh-error' }, t('err_input')));
    }
  };

  if (spec.geo && typeof navigator !== 'undefined' && navigator.geolocation) {
    const geo = el('button', { type: 'button', class: 'bh-btn bh-btn-alt' }, t('p_geo'));
    // Geolocation is requested only on an explicit click.
    geo.addEventListener('click', () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          form.elements.lat.value = pos.coords.latitude.toFixed(4);
          form.elements.lon.value = pos.coords.longitude.toFixed(4);
          run();
        },
        () => { out.textContent = ''; out.appendChild(el('p', { class: 'bh-error' }, t('p_geo_err'))); },
        { timeout: 10000 },
      );
    });
    actions.appendChild(geo);
  }
  form.appendChild(actions);
  form.addEventListener('submit', (ev) => { ev.preventDefault(); run(); });
  form.addEventListener('change', run);
  root.appendChild(form);
  if (spec.note) root.appendChild(el('p', { class: 'bh-note' }, t(spec.note)));
  root.appendChild(out);

  const foot = el('footer', { class: 'bh-sources' });
  foot.appendChild(el('strong', {}, `${t('sources')}: `));
  const items = SOURCES[root.dataset.calc].map(([name, url]) => {
    if (!url) return document.createTextNode(name);
    return el('a', { href: url, rel: 'noopener noreferrer', target: '_blank' }, name);
  });
  items.push(document.createTextNode(t('course')));
  items.forEach((n, i) => { if (i) foot.appendChild(document.createTextNode(' · ')); foot.appendChild(n); });
  foot.appendChild(el('p', { class: 'bh-note' }, t('disclaimer')));
  root.appendChild(foot);
  run();
}

/**
 * Mounts every [data-calc] element in the document.
 * @returns {void}
 */
export function init() {
  document.querySelectorAll('[data-calc]').forEach(mount);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}

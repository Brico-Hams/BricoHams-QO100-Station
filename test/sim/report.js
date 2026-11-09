// Generates docs/testing/sim-report.md (Spanish) from the metrics persisted by the *.sim.test.js scenarios.
// Run after the scenarios (done automatically by the last scenario file) or manually: `node test/sim/report.js`.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadResults } from './metrics.js';

const REPORT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/testing/sim-report.md');

const SCENARIOS = [
  ['beacon', 'Baliza y deriva del LNB'],
  ['digital', 'FT8 / FT4 de extremo a extremo'],
  ['cw', 'CW con QSB y ruido'],
  ['ptt', 'PTT: heartbeat, TOT y desconexiones'],
  ['contention', 'Competencia por el turno (5 operadores)'],
  ['cluster', 'Cluster DX (telnet simulado)'],
  ['qso', 'QSO completo con SDRangel estricto'],
];

const num = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—');
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(0)} %` : '—');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`), ''].join('\n');

function summary(results) {
  const rows = SCENARIOS.map(([id, name]) => {
    const r = results[id];
    if (!r) return [name, 'no ejecutado', '—', '—'];
    const failed = r.cases.filter((c) => c.status !== 'pass');
    const ok = r.cases.length > 0 && failed.length === 0;
    const secs = r.cases.reduce((a, c) => a + c.ms, 0) / 1000;
    return [name, ok ? '✅ pasa' : `❌ falla${failed[0]?.error ? `: ${failed[0].error.replace(/\|/g, '/').replace(/\s+/g, ' ')}` : ''}`, `${r.cases.length}`, `${secs.toFixed(1)} s`];
  });
  return `## Resumen\n\n${table(['Escenario', 'Resultado', 'Casos', 'Duración'], rows)}`;
}

function beaconSection(r) {
  const m = r?.metrics ?? {};
  const rows = Object.entries(m).map(([engine, s]) => [
    engine, num(s.errMaxHz), num(s.errP50Hz), num(s.errP95Hz), num(s.errP99Hz), num(s.errRmsHz), num(s.maxDriftHz, 0),
    num(s.firstLockS, 0), num(s.relockS, 0), String(s.writesWhileUnlocked ?? '—'),
  ]);
  if (!rows.length) return '## Baliza\n\nSin datos.\n';
  return `## Baliza: error de corrección tras el enganche\n\nDeriva simulada de 2 h (rampa térmica + paseo aleatorio) y un corte de baliza de 10 s. Errores en Hz tras el enganche.\n\n${table(
    ['Motor', 'Máx |err|', 'P50', 'P95', 'P99', 'RMS', 'Deriva máx (Hz)', 'Primer enganche (s)', 'Reenganche (s)', 'Escrituras sin enganche'], rows)}`;
}

function digitalSection(r) {
  const m = r?.metrics ?? {};
  const ft8 = m.FT8 ?? [];
  const ft4 = m.FT4 ?? [];
  if (!ft8.length && !ft4.length) return '## FT8 / FT4\n\nSin datos.\n';
  const levels = [...new Set([...ft8, ...ft4].map((x) => x.snrDb))].sort((a, b) => a - b);
  const cell = (arr, snr) => {
    const x = arr.find((y) => y.snrDb === snr);
    return x ? `${pct(x.rate)} (${x.decoded}/${x.trials})` : '—';
  };
  const wrong = [...ft8, ...ft4].reduce((a, x) => a + (x.falseDecodes ?? 0), 0);
  return `## FT8 / FT4: tasa de decodificación frente a SNR\n\nSNR referido a 2500 Hz. Cadena: generador de banda → demodulador USB → decodificador. Decodificaciones erróneas: ${wrong}; decodificaciones en ruido puro: ${m.noiseOnlyDecodes ?? '—'}.\n\n${table(
    ['SNR (dB)', 'FT8', 'FT4'], levels.map((s) => [String(s), cell(ft8, s), cell(ft4, s)]))}`;
}

function cwSection(r) {
  const rows = r?.metrics?.cer;
  if (!rows?.length) return '## CW\n\nSin datos.\n';
  const wpms = [...new Set(rows.map((x) => x.wpm))].sort((a, b) => a - b);
  const snrs = [...new Set(rows.map((x) => x.snrDb))].sort((a, b) => a - b);
  const body = wpms.map((w) => [`${w} WPM`, ...snrs.map((s) => {
    const x = rows.find((y) => y.wpm === w && y.snrDb === s);
    return x ? `${(x.cer * 100).toFixed(1)} % (${x.errors}/${x.chars})` : '—';
  })]);
  return `## CW: tasa de error de carácter (CER)\n\nQSB de 0,1–0,5 Hz y ruido blanco; columnas por SNR en 2500 Hz.\n\n${table(['Velocidad', ...snrs.map((s) => `${s} dB`)], body)}`;
}

function pttSection(r) {
  const s = r?.metrics?.summary;
  if (!s) return '## PTT\n\nSin datos.\n';
  const l = s.cutLatencyMs ?? {};
  const o = s.cutLatencyOverTimeout ?? {};
  return `## PTT: latencia de corte por pérdida de heartbeat\n\n${s.sessions} sesiones aleatorias con reloj simulado (pérdida, jitter y reordenación de heartbeats, pulsaciones y desconexiones). Tiempo entre el último heartbeat válido y la caída de portadora.\n\n${table(
    ['Mín (ms)', 'P50', 'P95', 'P99', 'Máx', 'P50 / timeout', 'P99 / timeout', 'Máx / timeout'],
    [[num(l.min, 0), num(l.p50, 0), num(l.p95, 0), num(l.p99, 0), num(l.max, 0), num(o.p50, 2), num(o.p99, 2), num(o.max, 2)]])}\n${table(
    ['Pulsaciones', 'Heartbeats enviados', 'Perdidos', 'Entregados', 'Cortes por heartbeat', 'Cortes por TOT', 'Exceso TOT máx (ms)'],
    [[s.keyings, s.heartbeatsSent, s.heartbeatsLost, s.heartbeatsDelivered, s.heartbeatCuts, s.totCuts, num(s.totOvershootMsMax, 0)]])}`;
}

function contentionSection(r) {
  const s = r?.metrics?.summary;
  if (!s) return '## Competencia por el turno\n\nSin datos.\n';
  const rows = (s.grantsPerOperator ?? []).map((g, i) => [`Operador ${i + 1}`, String(g), String(s.denialsPerOperator?.[i] ?? '—')]);
  return `## Competencia por el turno\n\n${s.operators} operadores, ${s.attemptsPerOperator} intentos cada uno. Máximo de titulares simultáneos: ${s.maxSimultaneousHolders}. Índice de Jain: ${s.jainIndex} (1 = reparto perfecto). Mediana de respuesta a \`turn\`: ${s.grantReplyMsP50} ms. Cesión tras desconexión del titular: ${s.handoverAfterDisconnectMs} ms.\n\n${table(['Operador', 'Turnos concedidos', 'Denegados'], rows)}`;
}

function clusterSection(r) {
  const s = r?.metrics?.summary;
  if (!s) return '## Cluster DX\n\nSin datos.\n';
  return `## Cluster DX\n\n${table(['Contador', 'Valor'], [
    ['Líneas enviadas', s.linesSent], ['Spots válidos (descarga)', s.valid], ['Spots válidos (formato subida)', s.uplink],
    ['Fuera de banda', s.outOfBand], ['Malformadas', s.malformed], ['Spots aceptados / esperados', `${s.acceptedSpots} / ${s.expectedSpots}`],
    ['Desconexiones forzadas', s.disconnects], ['Reconexiones', s.reconnects], ['Logins', s.logins],
    ['Secuencia de backoff en caída total (ms)', (s.backoffSequenceMs ?? []).join(', ')], ['Estado final', s.finalState],
  ])}`;
}

function qsoSection(r) {
  const s = r?.metrics?.summary;
  if (!s) return '## QSO completo\n\nSin datos.\n';
  const rows = Object.entries(s.requestsByRoute ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [`\`${k}\``, String(v)]);
  return `## QSO completo con SDRangel estricto\n\nPeticiones a SDRangel: ${s.sdrangelRequests}. Errores de validación swagger: ${s.swaggerValidationErrors}. Bytes UDP hacia UDPSource: ${s.udpBytesArmed} en ARMED, ${s.udpBytesTxOn} en TX_ON, ${s.udpBytesAfterRelease} tras soltar el PTT (${s.udpDatagrams} datagramas).\n\n${table(['Petición', 'Nº'], rows)}`;
}

/**
 * Build the report text.
 * @param {ReturnType<typeof loadResults>} results
 * @param {Date} [date]
 * @returns {string} Markdown, in Spanish.
 */
export function renderReport(results, date = new Date()) {
  return [
    '<p align="center">',
    '  <a href="https://bricohams.org"><img src="../../branding/bricohams_horizontal.png" alt="BricoHams" width="360"></a>',
    '</p>',
    '',
    '<p align="center"><strong>Radioafición · Hazlo tú mismo</strong></p>',
    '',
    '# Informe de simulaciones QO-100',
    '',
    `Fecha: ${date.toISOString().slice(0, 10)}. Generado por \`npm run sim\` (\`test/sim/report.js\`); no edites este fichero a mano.`,
    '',
    'Las simulaciones son deterministas (PRNG con semilla) y no usan red, hardware ni SDRangel real. Los resultados validan la lógica del software, no sustituyen a las pruebas con el equipo real ([CHECKLIST](CHECKLIST.md)).',
    '',
    summary(results),
    beaconSection(results.beacon),
    digitalSection(results.digital),
    cwSection(results.cw),
    pttSection(results.ptt),
    contentionSection(results.contention),
    clusterSection(results.cluster),
    qsoSection(results.qso),
  ].join('\n');
}

/**
 * Write docs/testing/sim-report.md atomically from the persisted scenario results.
 * @returns {string} Path of the written report.
 */
export function writeReport() {
  const text = renderReport(loadResults());
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  const tmp = `${REPORT_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, REPORT_PATH);
  return REPORT_PATH;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`written ${writeReport()}`);
}

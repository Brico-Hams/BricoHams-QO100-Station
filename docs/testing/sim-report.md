<p align="center">
  <a href="https://bricohams.org"><img src="../../branding/bricohams_horizontal.png" alt="BricoHams" width="360"></a>
</p>

<p align="center"><strong>Radioafición · Hazlo tú mismo</strong></p>

# Informe de simulaciones QO-100

Fecha: 2026-11-09. Generado por `npm run sim` (`test/sim/report.js`); no edites este fichero a mano.

Las simulaciones son deterministas (PRNG con semilla) y no usan red, hardware ni SDRangel real. Los resultados validan la lógica del software, no sustituyen a las pruebas con el equipo real ([CHECKLIST](CHECKLIST.md)).

## Resumen

| Escenario | Resultado | Casos | Duración |
| --- | --- | --- | --- |
| Baliza y deriva del LNB | ✅ pasa | 3 | 363.2 s |
| FT8 / FT4 de extremo a extremo | ✅ pasa | 3 | 76.6 s |
| CW con QSB y ruido | ✅ pasa | 1 | 47.0 s |
| PTT: heartbeat, TOT y desconexiones | ✅ pasa | 1 | 0.6 s |
| Competencia por el turno (5 operadores) | ✅ pasa | 1 | 2.8 s |
| Cluster DX (telnet simulado) | ✅ pasa | 1 | 0.7 s |
| QSO completo con SDRangel estricto | ✅ pasa | 1 | 1.9 s |

## Baliza: error de corrección tras el enganche

Deriva simulada de 2 h (rampa térmica + paseo aleatorio) y un corte de baliza de 10 s. Errores en Hz tras el enganche.

| Motor | Máx |err| | P50 | P95 | P99 | RMS | Deriva máx (Hz) | Primer enganche (s) | Reenganche (s) | Escrituras sin enganche |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bricohams | 21.0 | 7.9 | 14.7 | 17.3 | 8.9 | 7954 | 6 | 4 | 0 |
| sdrangel-freqtracker | 8.7 | 5.1 | 6.7 | 7.4 | 5.2 | 3601 | 6 | 4 | 0 |

## FT8 / FT4: tasa de decodificación frente a SNR

SNR referido a 2500 Hz. Cadena: generador de banda → demodulador USB → decodificador. Decodificaciones erróneas: 0; decodificaciones en ruido puro: 0.

| SNR (dB) | FT8 | FT4 |
| --- | --- | --- |
| -24 | 0 % (0/2) | 0 % (0/2) |
| -22 | 0 % (0/2) | 0 % (0/2) |
| -20 | 50 % (1/2) | 0 % (0/2) |
| -18 | 50 % (1/2) | 0 % (0/2) |
| -16 | 100 % (2/2) | 0 % (0/2) |
| -15 | 100 % (10/10) | — |
| -14 | 100 % (2/2) | 50 % (1/2) |
| -12 | 100 % (2/2) | 90 % (9/10) |
| -10 | 100 % (2/2) | 100 % (2/2) |
| -8 | 100 % (2/2) | 100 % (2/2) |
| -6 | 100 % (2/2) | 100 % (2/2) |
| -4 | 100 % (2/2) | 100 % (2/2) |
| -2 | 100 % (2/2) | 100 % (2/2) |
| 0 | 100 % (2/2) | 100 % (2/2) |

## CW: tasa de error de carácter (CER)

QSB de 0,1–0,5 Hz y ruido blanco; columnas por SNR en 2500 Hz.

| Velocidad | 0 dB | 6 dB | 12 dB |
| --- | --- | --- | --- |
| 10 WPM | 49.0 % (25/51) | 0.0 % (0/51) | 0.0 % (0/51) |
| 15 WPM | 62.7 % (32/51) | 0.0 % (0/51) | 0.0 % (0/51) |
| 20 WPM | 86.3 % (44/51) | 3.9 % (2/51) | 0.0 % (0/51) |
| 25 WPM | 82.4 % (42/51) | 3.9 % (2/51) | 0.0 % (0/51) |
| 30 WPM | 76.5 % (39/51) | 11.8 % (6/51) | 0.0 % (0/51) |
| 35 WPM | 60.8 % (31/51) | 11.8 % (6/51) | 0.0 % (0/51) |

## PTT: latencia de corte por pérdida de heartbeat

1000 sesiones aleatorias con reloj simulado (pérdida, jitter y reordenación de heartbeats, pulsaciones y desconexiones). Tiempo entre el último heartbeat válido y la caída de portadora.

| Mín (ms) | P50 | P95 | P99 | Máx | P50 / timeout | P99 / timeout | Máx / timeout |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 150 | 835 | 1433 | 1485 | 1499 | 0.75 | 0.75 | 0.75 |

| Pulsaciones | Heartbeats enviados | Perdidos | Entregados | Cortes por heartbeat | Cortes por TOT | Exceso TOT máx (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| 2010 | 211216 | 29678 | 180217 | 1119 | 223 | 0 |

## Competencia por el turno

5 operadores, 14 intentos cada uno. Máximo de titulares simultáneos: 1. Índice de Jain: 1 (1 = reparto perfecto). Mediana de respuesta a `turn`: 3 ms. Cesión tras desconexión del titular: 28.4 ms.

| Operador | Turnos concedidos | Denegados |
| --- | --- | --- |
| Operador 1 | 14 | 62 |
| Operador 2 | 14 | 88 |
| Operador 3 | 14 | 77 |
| Operador 4 | 14 | 92 |
| Operador 5 | 14 | 71 |

## Cluster DX

| Contador | Valor |
| --- | --- |
| Líneas enviadas | 500 |
| Spots válidos (descarga) | 183 |
| Spots válidos (formato subida) | 90 |
| Fuera de banda | 107 |
| Malformadas | 120 |
| Spots aceptados / esperados | 273 / 273 |
| Desconexiones forzadas | 3 |
| Reconexiones | 3 |
| Logins | 4 |
| Secuencia de backoff en caída total (ms) | 20, 40, 80, 160, 200 |
| Estado final | waiting |

## QSO completo con SDRangel estricto

Peticiones a SDRangel: 41. Errores de validación swagger: 0. Bytes UDP hacia UDPSource: 0 en ARMED, 19200 en TX_ON, 0 tras soltar el PTT (20 datagramas).

| Petición | Nº |
| --- | --- |
| `DELETE /sdrangel/deviceset/{n}/device/run` | 1 |
| `GET /sdrangel/deviceset/{n}` | 5 |
| `GET /sdrangel/deviceset/{n}/channel/{n}/settings` | 9 |
| `GET /sdrangel/deviceset/{n}/device/run` | 1 |
| `GET /sdrangel/deviceset/{n}/device/settings` | 8 |
| `PATCH /sdrangel/deviceset/{n}/channel/{n}/settings` | 9 |
| `PATCH /sdrangel/deviceset/{n}/device/settings` | 4 |
| `POST /sdrangel/deviceset/{n}/channel` | 2 |
| `POST /sdrangel/deviceset/{n}/device/run` | 1 |
| `POST /sdrangel/deviceset/{n}/spectrum/server` | 1 |

# Equipos y programas de QO-100 y su equivalencia en BricoHams

*Basado en el Curso Iniciación QO-100 de EA5EN Mateo (ver [referencias](../references/ea5en/README.md)); resumen propio. Marcas y precios son ejemplos del curso, no recomendaciones.*

## Programas

| Programa (según el curso) | Para qué lo usa el curso | Equivalente en BricoHams |
|---|---|---|
| **SDR Console** (G4ELI), diapositivas 33 a 38 | Recibir con un RTL-SDR, definir un *converter* con el LO del LNB para que el dial muestre los 10 GHz en lugar de la FI de unos 739 MHz, y ver la baliza y el NB en espectro y cascada | La pantalla de radio de BricoHams muestra directamente la frecuencia de bajada (10489,xxx MHz). El «convertidor» es `station.lnbLoHz`, y la baliza corrige después la deriva fina. SDR Console es propietario y solo se cita como idea. |
| **SDR# / Airspy** (diapositiva 37) | Sintonizar la FI (ej. 739,771 MHz) y, con el offset del convertidor, ver 10489,750 MHz | SDRangel hace de motor de radio con el mismo conjunto de dispositivos. El *offset* del convertidor equivale a `station.lnbLoHz`. |
| **SDRangel** | No figura en el curso | Es el motor de BricoHams: RX por la FI, TX en 2400 MHz. |
| **Zadig** (diapositivas 33 y 34) | Instalar el controlador WinUSB del RTL-SDR en Windows | Requisito previo de SDRangel con RTL-SDR en Windows; BricoHams no lo instala. |
| **AO40Rcv** v2.04 (diapositiva 39) | Decodificar la telemetría de la baliza BPSK central (tensiones, temperaturas, contadores FEC) | No incluido: BricoHams solo mide la frecuencia de la baliza, no decodifica su telemetría. Puedes usar AO40Rcv aparte sobre el audio de la baliza. |
| **WebSDR QO-100** (diapositiva 48: IS0GRB, DB0HAL, BATC) y el **receptor OpenWebRX+ de EA5EN** | Escuchar el transpondedor sin equipo propio | [plugin-openwebrx.md](plugin-openwebrx.md) para tu propio receptor público; el de EA5EN se puede usar como referencia externa (ver [checklist](../testing/CHECKLIST.md), sección D). |
| Herramientas de apuntado: Satlex, DishPointer, BATC (diapositivas 13 y 14) | Calcular azimut, elevación y giro de polarización | Fuera de BricoHams; ver [qo100-fundamentos.md](qo100-fundamentos.md). |
| Calculadora de parábolas (rftools) | Ganancia del plato a 11 GHz | Fuera de BricoHams. |

## Equipos de recepción

| Equipo | Nota del curso | Relación con BricoHams |
|---|---|---|
| LNB Octagon, Bullseye, Televes universal (LO 9750 MHz), diapositiva 18 | Los típicos para RX | `station.lnbLoHz` = 9 750 000 000 Hz por defecto |
| Bias-T (diapositiva 19) | 12–14 V polarización vertical, 16–18 V horizontal | Externo al programa |
| SDR comerciales (diapositiva 22) y SDR tipo RTL-SDR, SDRplay, Airspy | Sirven para la FI | Todos en el conjunto de dispositivos 0 de SDRangel; ver [primera puesta en marcha](primera-puesta-en-marcha.md) |
| Convertidores RX 144/432 MHz con referencia (diapositivas 20 y 21) | Alimentan el LNB y dan referencia de 25 MHz | Cambia la FI; configura `station.lnbLoHz` y la frecuencia central de SDRangel de acuerdo con esa FI |

## Equipos de transmisión

| Equipo | Nota del curso | Relación con BricoHams |
|---|---|---|
| Up-converter 144/432 MHz → 2,4 GHz (HiDes, SG-Labs, DXPatrol, Kuhne), diapositivas 23 a 25 | Convierte la salida de un transceptor | Si lo usas, el TX device de SDRangel trabaja en VHF/UHF: ajusta la frecuencia de TX en SDRangel; BricoHams asume una subida directa de 2400 MHz, así que esta configuración requiere pruebas |
| ADALM-Pluto, LimeSDR, HackRF directos a 2,4 GHz + amplificador | Alternativa barata | Dispositivo TX directo en el conjunto 1 (es el caso previsto) |
| Amplificadores de 2,4 GHz y su ventilación (diapositivas 27 a 29 y 47) | De 1 W a 12 W | Fuera de BricoHams; usa siempre corte físico y carga ficticia |
| Hélice o parche RHCP (diapositiva 26) | Antena de subida | Fuera de BricoHams |
| **GPSDO** de 10 MHz (diapositiva 30) | Fundamental para FT8/FT4 | Reduce la necesidad de `station.applyCorrectionToTx` |

## Cómo se corresponden los ajustes

| Concepto del curso | Ajuste de BricoHams |
|---|---|
| *Offset* del convertidor / oscilador local (9750 MHz) | `station.lnbLoHz` |
| Buscar la baliza a mano para calcular el LO real | Estado de la baliza en la pantalla («locked» y desplazamiento en Hz) |
| Corrección por deriva del LNB | Módulo de baliza (automático) |
| GPSDO común para TX y RX | `station.applyCorrectionToTx: false` (por defecto) |

Para los valores exactos y las diferencias entre el curso y el código, ver [las discrepancias](qo100-fundamentos.md#frecuencias-de-referencia-y-discrepancias-con-el-curso).

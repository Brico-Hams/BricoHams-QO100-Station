# Comparativa de equipos para una estación QO-100

> **Todos los precios** proceden de tres fuentes fechadas: el BOM de estudio (`study-BOM-2026-11-07.csv`), el CSV de referencia (`antenaSatCommrotor-reference-prices-2026-10-10.csv`) y el curso EA5EN (diapositiva 40, sin fecha). Cada uno muestra fecha y fuente en `components.csv` y **hay que verificarlos antes de comprar**. Las conversiones de USD a EUR usan **0,89238 EUR/USD** (tasa implícita del CSV de referencia de 2026-10-10) y están marcadas como *convertido*. Base fiscal: la del CSV de referencia varía por fila (sin IVA alemán/de importación, o precio bruto mostrado); el BOM de estudio indica precio de lista sin IVA ni envío; los del curso son indicativos. Donde no hay precio se deja `n/d`.

## Avisos importantes

1. **Plutos clónicos:** usa un ADALM-Pluto original. Clones y "Pluto+" tienen osciladores, potencia y firmware sin verificar.
2. **PA chinos baratos no lineales:** muchos módulos de 2,4 GHz (clase EDUP) no son lineales ni tienen ficha. La SSB necesita linealidad: elige un PA con IP1dB documentado, mide con un medidor de potencia y usa atenuador + filtro paso banda.
3. **El LNB debe cubrir 10,489 GHz:** muchos LNB universales empiezan en 10,7 GHz y no sirven; comprueba la ficha y mide con la baliza.
4. **Nunca conectes la FI del LNB (~740 MHz) a la entrada de HF de un SDR** (por ejemplo la del Hermes Lite 2) ni dejes pasar DC hacia un SDR sin bloqueo: usa un inyector con bloqueo de DC.
5. Prueba el TX siempre en **carga artificial** antes de conectar la antena. 2,4 GHz: no te sitúes delante del feed con TX activo.

## RX (SDR de recepción de la FI del LNB)

| SDR | Precio | Calidad que importa | Idoneidad QO-100 |
|---|---|---|---|
| RTL-SDR Blog V3/V4 | n/d (curso: SDR 30-300 USD ≈ 26,77-267,71 EUR, *convertido*, sin fecha) | TCXO ~0,5-1 ppm; 8 bits | Muy buena para empezar; ruido de cuantificación mayor |
| SDRplay RSP1B / RSPdx | n/d (BOM de estudio 2026-11-07) | 14 bits; 1 kHz-2 GHz | Muy buena; la usa el receptor de EA5EN |
| Airspy Mini / R2 | n/d | 12 bits; TCXO 0,5 ppm | Muy buena; solo RX |
| HackRF One | n/d | 8 bits; half-duplex | Aceptable; mejor como TX |

## TX (generación de la excitación 2400,0-2400,5 MHz)

| SDR | Precio | Calidad | Idoneidad |
|---|---|---|---|
| ADALM-Pluto original | n/d | Oscilador de baja precisión (lo compensa la corrección de la baliza); potencia muy baja | Muy buena, documentada |
| Pluto+ (clon) | n/d | Sin verificar | Arriesgada |
| HackRF One | n/d | 8 bits; half-duplex | Válida en TX |
| LimeSDR Mini 2.0 | 535,43 EUR (2026-10-10, CSV de referencia; USD 600 ya convertido, sin IVA de importación) | Full-duplex, 12 bits | Buena pero cara |
| USRP B200mini-i | 1548,28 EUR (*convertido* de 1735 USD, BOM de estudio 2026-11-07, sin IVA/envío) | AD9364, 56 MHz, ref. 10 MHz | Excelente |
| Hermes Lite 2 | 240,05 EUR (*convertido* de 269 USD, BOM de estudio 2026-11-07) | HF QRP | Solo con transverter (SQ5NRY ≈ 200 EUR con IVA PL, BOM del autor en el BOM de estudio) |

## LNB y referencia de frecuencia

| Opción | Precio | Deriva | Idoneidad |
|---|---|---|---|
| LNB estándar LO 9750 | n/d | Alta (decenas o cientos de kHz; medir) | Barata, corregible con la baliza |
| Bullseye (TCXO de fábrica) | 26,77 EUR (*convertido* de 30 USD, curso EA5EN diapositiva 40, sin fecha) | Baja (ppm del TCXO) | Muy buena relación calidad/precio |
| LNB PLL con ref. externa 25/27 MHz | n/d | La de la referencia | La mejor con GPSDO |
| LNB con TCXO modificado (OK2ZAW) | n/d | Baja | Para quien suelda |
| GPSDO 10 MHz | n/d | Mínima | Solo en escenarios avanzados |

## Conversores y amplificadores

| Elemento | Precio | Notas |
|---|---|---|
| SG-Lab, DXPatrol, SQ5NRY | SQ5NRY ≈ 200 EUR (BOM de estudio); los demás n/d | Transverters y conversores: ver `components.csv` |
| PA clase EDUP | n/d | No lineal: medir y no sobrepasar |
| PA lineal con ficha | n/d | Preferible |
| Bias-T/inyector 13/18 V | 4,46-13,39 EUR (*convertido* de 5-15 USD, curso EA5EN, sin fecha) | Con bloqueo de DC al SDR |

## Platos y feeds

| Plato | G a 10,489 GHz / 2,4 GHz (η = 0,55) | Precio |
|---|---|---|
| 60 cm | 33,8 / 21,0 dBi | n/d |
| 80 cm | 36,3 / 23,5 dBi | 71,39-107,09 EUR (rango 80-120 USD del curso, *convertido*, sin fecha) |
| 90 cm | 37,3 / 24,5 dBi | n/d |
| 120 cm | 39,8 / 27,0 dBi | n/d |

Feeds: helix impreso (DIY; [helix-2g4.md](../antennas/helix-2g4.md)) o POTY ([poty-patch.md](../antennas/poty-patch.md)). Soporte/trípode: 26,77-107,09 EUR (curso, *convertido*).

## Kits recomendados por escalón

Los totales suman **solo las partidas con precio**; "sin precio" son partidas que aún hay que presupuestar. Rango = suma de mínimos y de máximos.

| Escalón | Contenido (con precio) | Total conocido (mín-máx EUR) | Partidas sin precio |
|---|---|---|---|
| Económico | SDR clase RTL-SDR 26,77-267,71 + LNB Bullseye 26,77 + inyector 4,46-13,39 + plato 71,39-107,09 + soporte 26,77-107,09 + bobina ASA 23,46 | **179,62-545,51** | Pluto, PA, filtro, atenuador, fuente, coax, conectores, feed, medidor, carga |
| Equilibrado | CM5 115,67 + IO 18,40 + fuente USB 12,40 + LNB Bullseye 26,77 + inyector 4,46-13,39 + portafusibles 8,91 + Powerpole 15,16 + ASA 23,46 + soporte 26,77-107,09 | **252,00-341,25** | RSP1B/Airspy, Pluto, GPSDO, LNB PLL, PA lineal, plato 90 cm, coax |
| Alt. HL2 | Hermes Lite 2 240,05 + transverter SQ5NRY 200,00 + ASA 23,46 | **463,51** | Receptor de FI, plato, LNB, medición |
| Avanzado | USRP B200mini-i 1548,28 + CM5 115,67 + IO 18,40 + fuente USB 12,40 + ASA 23,46 | **1718,21** | GPSDO, LNB PLL, plato 120 cm, PA, filtros, coax |

**Verificar antes de comprar:** todos los precios y su base fiscal (IVA, envío, aduana), la cobertura de entrada del LNB, el modelo y el sentido de giro del feed, y la linealidad del PA con medidas propias.

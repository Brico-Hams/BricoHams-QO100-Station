<p align="center">
  <a href="https://bricohams.org"><img src="../../../branding/bricohams_horizontal.png" alt="BricoHams" width="360"></a>
</p>

# Radio definida por software (SDR) para radioaficionados: de la teoría a la estación QO-100

**BricoHams** · *Radioafición · Hazlo tú mismo* · <https://bricohams.org>

- **Autores:** Anatol EA5KAO, Diego EA5JEF y Pedro Roca Molina.
- **Versión:** 1.0
- **Idioma maestro:** español (las traducciones se derivan de esta versión).
- **Licencia del texto y de las figuras:** [Creative Commons BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es). El código del repositorio (`src/`, `services/`, `plugins/`) se distribuye bajo **GPL-3.0-or-later** (véase [`NOTICE.md`](../../../NOTICE.md)).

Este manual es una obra original. Explica la radio definida por software con ejemplos reales de la banda estrecha de QO-100 y del código de esta estación. Los libros y proyectos de terceros se citan solo como lectura recomendada; ninguna marca, empresa o proyecto citado respalda a BricoHams ni a este manual (no hay patrocinio ni aval de terceros).

## Cómo usar este manual

Cada capítulo tiene: objetivos, explicación con ejemplos numéricos de QO-100, al menos una figura, un recuadro **«Cómo lo hace BricoHams»** con enlaces a archivos reales del repositorio, ejercicios con solución y una línea de **«Lectura recomendada»**. Las prácticas del [capítulo 12](12-practicas.md) se ejecutan con Node 24 y sin hardware ni red.

Las figuras 23 a 26 (BER teórica, capacidad de Shannon, prefijo cíclico OFDM, coseno alzado) se calculan con un script. Para regenerarlas: `node docs/manual/figures/generate-charts.mjs`.

## Índice

| Cap. | Archivo | Tema |
|---|---|---|
| 0 | [Prólogo](00-prologo.md) | A quién va dirigido y cómo leerlo |
| 1 | [¿Qué es una SDR?](01-que-es-sdr.md) | Arquitectura general y la cadena de QO-100 |
| 2 | [Señales y sistemas](02-senales-y-sistemas.md) | Muestreo, Nyquist, aliasing, I/Q, FFT, ventanas, diezmado |
| 3 | [Ruido y probabilidad](03-ruido-y-probabilidad.md) | Ruido térmico, SNR, Eb/N0, figura de ruido |
| 4 | [Modulación digital](04-modulacion-digital.md) | FSK, PSK, FT8, FT4, CW, conformado de pulsos |
| 5 | [Hardware SDR](05-hardware-sdr.md) | FI cero, ADC, fugas del oscilador, referencia de reloj |
| 6 | [Sincronización de tiempo](06-sincronizacion-de-tiempo.md) | Símbolos, franjas de 15 s, UTC y NTP |
| 7 | [Sincronización de portadora](07-sincronizacion-de-portadora.md) | Desvío de frecuencia y baliza como referencia |
| 8 | [Tramas y codificación](08-tramas-y-codificacion.md) | Costas, CRC-14, LDPC(174,91) |
| 9 | [Canal y ecualización](09-canal-y-ecualizacion.md) | Canal satelital, Doppler, multitrayecto, AGC |
| 10 | [OFDM](10-ofdm.md) | Concepto y por qué QO-100 NB no lo usa |
| 11 | [Aplicaciones en QO-100](11-aplicaciones-qo100.md) | La estación BricoHams completa |
| 12 | [Prácticas](12-practicas.md) | Laboratorios con el código del repositorio |
| — | [Glosario](glosario.md) | Términos y siglas |
| — | [Bibliografía](bibliografia.md) | Lecturas y documentación |

## Figuras

Las figuras están en [`../figures/`](../figures/) (`fig-NN-<tema>.svg`), son SVG escritos a mano o generados con script, con título y descripción accesibles, y usan la paleta BricoHams (azul marino `#12263f`, naranja `#e8871e`, gris `#5b6b7b`).

# Prólogo

![Bloques de una SDR](../figures/fig-01-bloques-sdr.svg)

Hace pocos años, escuchar el satélite geoestacionario QO-100 exigía una cadena de equipos caros y cerrados. Hoy un dongle de unas decenas de euros, un LNB y un plato de TV permiten ver en pantalla toda la banda estrecha de 500 kHz y decodificar a la vez decenas de comunicados. Lo que cambió no es la antena: es que **la radio pasó del circuito al algoritmo**.

Este manual quiere que entiendas ese algoritmo lo bastante bien como para depurar tu estación, elegir hardware con criterio y leer el código de BricoHams sin miedo.

## A quién va dirigido

- Radioaficionados con estudios de electrónica básica o ganas de aprenderla.
- Constructores («hazlo tú mismo») que montan plato, LNB, hélice y SDR y quieren saber *por qué* funcionan.
- Estudiantes que buscan ejemplos de DSP con un caso real y reproducible.

No hace falta saber programar, pero las prácticas del [capítulo 12](12-practicas.md) usan Node.js (versión 24) y son más provechosas si te animas a editar los ejemplos.

## Cómo está organizado

Los capítulos 2 a 10 siguen el camino de la señal, desde el aire hasta el mensaje decodificado: muestreo, ruido, modulación, hardware, sincronización de tiempo y de portadora, codificación, canal y OFDM. El capítulo 11 junta todo en la estación BricoHams y el 12 propone laboratorios.

Cada capítulo termina con ejercicios resueltos. Las cifras de QO-100 (frecuencias, transposición del satélite, FI del LNB) proceden del código del repositorio, en [`src/modes/frequencies.js`](../../../src/modes/frequencies.js); los parámetros de FT8 y FT4, de [`src/modes/ft8-constants.js`](../../../src/modes/ft8-constants.js).

## Convenciones

- Decimales con coma en el texto; en el código, punto.
- «dB» son relaciones de potencia (10·log₁₀) salvo indicación; dBm, dBW y dBFS llevan su referencia.
- Los valores marcados como *ilustrativos* son hipótesis para practicar, no mediciones de tu estación.

## Honestidad sobre las fuentes

Este texto es original: explica los conceptos con palabras y ejemplos propios. Donde un libro cubre un tema con más profundidad, lo indicamos como lectura recomendada (por capítulo, sin reproducir su contenido). Verifica siempre los parámetros operativos (frecuencias de baliza, límites de potencia, plan de bandas) en las fuentes oficiales de AMSAT-DL y de tu administración.

**Lectura recomendada:** Collins et al., *Software-Defined Radio for Engineers*, cap. 1 (Introduction to Software-Defined Radio).

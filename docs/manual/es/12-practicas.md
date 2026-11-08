# 12. Prácticas

Todas las prácticas se ejecutan en la raíz del repositorio, con Node 24, sin red, sin hardware y sin cuentas. Se usan los módulos reales de `src/`.

## Práctica 1: ejecutar las pruebas que ilustran conceptos

```
node --test test/unit/ft8.test.js test/unit/beacon.test.js test/unit/ptt.test.js
node --test test/unit/manual-charts.test.js
```

Lee [`test/unit/ft8.test.js`](../../../test/unit/ft8.test.js): sintetiza señales con ruido y comprueba la decodificación. Cambia el SNR en `noisySlot(...)` y observa en qué valor deja de decodificar (capítulos 3 y 8).

## Práctica 2: sintetizar y decodificar FT8

Crea un archivo temporal `lab-ft8.mjs` en la raíz (no lo subas al repositorio) con:

```js
import { synthSlot } from './src/modes/ft8-encode.js';
import { decodeSlot } from './src/modes/ft8-decode.js';
import { addAwgn, sigmaForSnr } from './test/fixtures/dsp.js';

const slot = synthSlot('CQ EA4AAA IN80', 'FT8', { freqHz: 1500, amplitude: 0.1 });
const noisy = addAwgn(slot, sigmaForSnr(0.1, -10), 42);
console.log(decodeSlot(noisy, { mode: 'FT8' }));
```

Ejecuta `node lab-ft8.mjs`. Verás `{ text, freqHz, dtSec, snrDb, ... }`. Comprueba la firma exacta de `addAwgn` y `sigmaForSnr` en [`test/fixtures/dsp.js`](../../../test/fixtures/dsp.js) antes de ejecutar. Experimenta:

- Baja la SNR de −10 a −18 dB hasta perder el mensaje (capítulo 8).
- Mueve `freqHz` entre 200 y 3000 Hz.
- Superpón dos mensajes a frecuencias distintas sumando los arreglos.

## Práctica 3: medir el desvío de la baliza con un espectro simulado

```js
import { estimateBeaconOffset } from './src/beacon/index.js';

const n = 1024;
const powersDb = new Float32Array(n).fill(-90);
powersDb[519] = -62; powersDb[520] = -55; powersDb[521] = -60;
console.log(estimateBeaconOffset({
  powersDb, centerHz: 739_750_000, binHz: 100, expectedHz: 739_750_000,
}));
```

Resultado esperado: `found: true`, `offsetHz` ≈ +808 Hz (bin 520 + δ ≈ 0,083). Prueba además un pico demasiado bajo (SNR < 10 dB) y observa `reason: 'low_snr'`. Para la trama binaria completa, [`test/fixtures/spectrum-frame.js`](../../../test/fixtures/spectrum-frame.js) genera el formato que lee `src/webrtc/spectrum.js`.

## Práctica 4: presupuesto de enlace con las calculadoras

```js
import { lnbLineup } from './services/qo100-calculators/assets/qo100-math.js';

console.log(lnbLineup({
  dishGainDbi: 37.3, antennaTempK: 60, lnbNfDb: 0.6, lnbGainDb: 55,
  coaxLossDb: 3, biasTLossDb: 0.3, sdrNfDb: 6,
  eirpDbw: 30, slantRangeKm: 38000, freqHz: 10_489_750_000, bandwidthHz: 2700,
}));
```

El EIRP de 30 dBW es **ilustrativo**: sustitúyelo por el valor real que publique AMSAT-DL. Compara la NF y G/T con los cálculos del capítulo 3 y comprueba qué ocurre al duplicar el diámetro del plato (+6 dB de ganancia).

## Práctica 5: los gráficos del manual

```
node docs/manual/figures/generate-charts.mjs
```

Vuelve a generar las figuras 23 a 26. Edita `generate-charts.mjs` para cambiar los factores de caída del coseno alzado o los valores de CP y observa cómo cambian las figuras.

## Entrega sugerida

Anota en un cuaderno: (1) el SNR mínimo de decodificación FT8 que obtuviste, (2) el desvío medido de la baliza, (3) el G/T y el SNR del enlace de tu estación. Compara con las mediciones reales del manual de puesta en marcha ([`docs/help/primera-puesta-en-marcha.md`](../../help/primera-puesta-en-marcha.md)).

## Soluciones orientativas

1. Anota el SNR más bajo en que aún decodificas; depende de la semilla y de la definición de SNR de `sigmaForSnr` (verifícala en el fixture).
2. ≈ +808 Hz, con el pico en el bin 520.
3. El SNR de 2700 Hz resulta de la fórmula del capítulo 3; con EIRP 30 dBW y los valores anteriores sale en torno a 37 dB.

**Lectura recomendada:** Collins et al., *Software-Defined Radio for Engineers*, cap. 11 (Applications for Software-Defined Radio).

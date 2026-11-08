[ES](../es/12-practicas.md) · [EN](../en/12-practicas.md) · [FR](../fr/12-practicas.md) · [PT](../pt/12-practicas.md)

# 12. Labs

All labs are run from the repository root, with Node 24, no network, no hardware and no accounts. The real modules in `src/` are used.

## Lab 1: run the tests that illustrate concepts

```
node --test test/unit/ft8.test.js test/unit/beacon.test.js test/unit/ptt.test.js
node --test test/unit/manual-charts.test.js
```

Read [`test/unit/ft8.test.js`](../../../test/unit/ft8.test.js): it synthesizes signals with noise and checks decoding. Change the SNR in `noisySlot(...)` and observe at which value it stops decoding (chapters 3 and 8).

## Lab 2: synthesize and decode FT8

Create a temporary file `lab-ft8.mjs` in the root (do not commit it to the repository) with:

```js
import { synthSlot } from './src/modes/ft8-encode.js';
import { decodeSlot } from './src/modes/ft8-decode.js';
import { addAwgn, sigmaForSnr } from './test/fixtures/dsp.js';

const slot = synthSlot('CQ EA4AAA IN80', 'FT8', { freqHz: 1500, amplitude: 0.1 });
const noisy = addAwgn(slot, sigmaForSnr(0.1, -10), 42);
console.log(decodeSlot(noisy, { mode: 'FT8' }));
```

Run `node lab-ft8.mjs`. You will see `{ text, freqHz, dtSec, snrDb, ... }`. Check the exact signature of `addAwgn` and `sigmaForSnr` in [`test/fixtures/dsp.js`](../../../test/fixtures/dsp.js) before running. Experiment:

- Lower the SNR from −10 to −18 dB until the message is lost (chapter 8).
- Move `freqHz` between 200 and 3000 Hz.
- Superimpose two messages at different frequencies by adding the arrays.

## Lab 3: measure the beacon offset with a simulated spectrum

```js
import { estimateBeaconOffset } from './src/beacon/index.js';

const n = 1024;
const powersDb = new Float32Array(n).fill(-90);
powersDb[519] = -62; powersDb[520] = -55; powersDb[521] = -60;
console.log(estimateBeaconOffset({
  powersDb, centerHz: 739_750_000, binHz: 100, expectedHz: 739_750_000,
}));
```

Expected result: `found: true`, `offsetHz` ≈ +808 Hz (bin 520 + δ ≈ 0.083). Also try a peak that is too low (SNR < 10 dB) and observe `reason: 'low_snr'`. For the full binary frame, [`test/fixtures/spectrum-frame.js`](../../../test/fixtures/spectrum-frame.js) generates the format read by `src/webrtc/spectrum.js`.

## Lab 4: link budget with the calculators

```js
import { lnbLineup } from './services/qo100-calculators/assets/qo100-math.js';

console.log(lnbLineup({
  dishGainDbi: 37.3, antennaTempK: 60, lnbNfDb: 0.6, lnbGainDb: 55,
  coaxLossDb: 3, biasTLossDb: 0.3, sdrNfDb: 6,
  eirpDbw: 30, slantRangeKm: 38000, freqHz: 10_489_750_000, bandwidthHz: 2700,
}));
```

The 30 dBW EIRP is **illustrative**: replace it with the real value published by AMSAT-DL. Compare the NF and G/T with the calculations in chapter 3 and check what happens when you double the dish diameter (+6 dB of gain).

## Lab 5: the manual's charts

```
node docs/manual/figures/generate-charts.mjs
```

It regenerates figures 23 to 26. Edit `generate-charts.mjs` to change the raised-cosine roll-off factors or the CP values and observe how the figures change.

## Suggested deliverable

Write down in a notebook: (1) the minimum FT8 decoding SNR you obtained, (2) the measured beacon offset, (3) the G/T and the link SNR of your station. Compare with the real measurements in the start-up guide ([`docs/help/primera-puesta-en-marcha.md`](../../help/primera-puesta-en-marcha.md)).

## Indicative solutions

1. Write down the lowest SNR at which you can still decode; it depends on the seed and on the SNR definition of `sigmaForSnr` (check it in the fixture).
2. ≈ +808 Hz, with the peak in bin 520.
3. The 2700 Hz SNR results from the formula in chapter 3; with EIRP 30 dBW and the values above it comes out around 37 dB.

**Further reading:** Collins et al., Software-Defined Radio for Engineers, ch. 11

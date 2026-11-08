[ES](../es/12-practicas.md) · [EN](../en/12-practicas.md) · [FR](../fr/12-practicas.md) · [PT](../pt/12-practicas.md)

# 12. Travaux pratiques

Tous les travaux pratiques s'exécutent à la racine du dépôt, avec Node 24, sans réseau, sans matériel et sans compte. On utilise les vrais modules de `src/`.

## Pratique 1 : exécuter les tests qui illustrent les concepts

```
node --test test/unit/ft8.test.js test/unit/beacon.test.js test/unit/ptt.test.js
node --test test/unit/manual-charts.test.js
```

Lisez [`test/unit/ft8.test.js`](../../../test/unit/ft8.test.js) : il synthétise des signaux avec du bruit et vérifie le décodage. Changez le SNR dans `noisySlot(...)` et observez à partir de quelle valeur le décodage échoue (chapitres 3 et 8).

## Pratique 2 : synthétiser et décoder du FT8

Créez un fichier temporaire `lab-ft8.mjs` à la racine (ne le versionnez pas dans le dépôt) avec :

```js
import { synthSlot } from './src/modes/ft8-encode.js';
import { decodeSlot } from './src/modes/ft8-decode.js';
import { addAwgn, sigmaForSnr } from './test/fixtures/dsp.js';

const slot = synthSlot('CQ EA4AAA IN80', 'FT8', { freqHz: 1500, amplitude: 0.1 });
const noisy = addAwgn(slot, sigmaForSnr(0.1, -10), 42);
console.log(decodeSlot(noisy, { mode: 'FT8' }));
```

Exécutez `node lab-ft8.mjs`. Vous verrez `{ text, freqHz, dtSec, snrDb, ... }`. Vérifiez la signature exacte de `addAwgn` et `sigmaForSnr` dans [`test/fixtures/dsp.js`](../../../test/fixtures/dsp.js) avant d'exécuter. Expérimentez :

- Baissez le SNR de −10 à −18 dB jusqu'à perdre le message (chapitre 8).
- Déplacez `freqHz` entre 200 et 3000 Hz.
- Superposez deux messages à des fréquences différentes en additionnant les tableaux.

## Pratique 3 : mesurer le décalage de la balise avec un spectre simulé

```js
import { estimateBeaconOffset } from './src/beacon/index.js';

const n = 1024;
const powersDb = new Float32Array(n).fill(-90);
powersDb[519] = -62; powersDb[520] = -55; powersDb[521] = -60;
console.log(estimateBeaconOffset({
  powersDb, centerHz: 739_750_000, binHz: 100, expectedHz: 739_750_000,
}));
```

Résultat attendu : `found: true`, `offsetHz` ≈ +808 Hz (bin 520 + δ ≈ 0,083). Essayez aussi un pic trop bas (SNR < 10 dB) et observez `reason: 'low_snr'`. Pour la trame binaire complète, [`test/fixtures/spectrum-frame.js`](../../../test/fixtures/spectrum-frame.js) génère le format lu par `src/webrtc/spectrum.js`.

## Pratique 4 : bilan de liaison avec les calculateurs

```js
import { lnbLineup } from './services/qo100-calculators/assets/qo100-math.js';

console.log(lnbLineup({
  dishGainDbi: 37.3, antennaTempK: 60, lnbNfDb: 0.6, lnbGainDb: 55,
  coaxLossDb: 3, biasTLossDb: 0.3, sdrNfDb: 6,
  eirpDbw: 30, slantRangeKm: 38000, freqHz: 10_489_750_000, bandwidthHz: 2700,
}));
```

L'EIRP de 30 dBW est **illustratif** : remplacez-le par la valeur réelle publiée par AMSAT-DL. Comparez le NF et le G/T avec les calculs du chapitre 3 et vérifiez ce qui se passe en doublant le diamètre de la parabole (+6 dB de gain).

## Pratique 5 : les graphiques du manuel

```
node docs/manual/figures/generate-charts.mjs
```

Régénère les figures 23 à 26. Modifiez `generate-charts.mjs` pour changer les facteurs de retombée du cosinus surélevé ou les valeurs de CP et observez l'évolution des figures.

## Livrable suggéré

Notez dans un carnet : (1) le SNR minimal de décodage FT8 que vous avez obtenu, (2) le décalage mesuré de la balise, (3) le G/T et le SNR de la liaison de votre station. Comparez avec les mesures réelles du manuel de mise en service ([`docs/help/primera-puesta-en-marcha.md`](../../help/primera-puesta-en-marcha.md)).

## Solutions indicatives

1. Notez le SNR le plus bas auquel vous décodez encore ; il dépend de la graine et de la définition du SNR de `sigmaForSnr` (vérifiez-la dans le fixture).
2. ≈ +808 Hz, avec le pic dans le bin 520.
3. Le SNR dans 2700 Hz résulte de la formule du chapitre 3 ; avec un EIRP de 30 dBW et les valeurs ci-dessus, on obtient environ 37 dB.

Lecture recommandée : Collins et al., Software-Defined Radio for Engineers, ch. 11

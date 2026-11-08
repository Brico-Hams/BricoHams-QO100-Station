[ES](../es/12-practicas.md) · [EN](../en/12-practicas.md) · [FR](../fr/12-practicas.md) · [PT](../pt/12-practicas.md)

# 12. Práticas

Todas as práticas executam-se na raiz do repositório, com Node 24, sem rede, sem hardware e sem contas. Usam-se os módulos reais de `src/`.

## Prática 1: executar os testes que ilustram conceitos

```
node --test test/unit/ft8.test.js test/unit/beacon.test.js test/unit/ptt.test.js
node --test test/unit/manual-charts.test.js
```

Leia [`test/unit/ft8.test.js`](../../../test/unit/ft8.test.js): sintetiza sinais com ruído e verifica a descodificação. Mude a SNR em `noisySlot(...)` e observe em que valor deixa de descodificar (capítulos 3 e 8).

## Prática 2: sintetizar e descodificar FT8

Crie um ficheiro temporário `lab-ft8.mjs` na raiz (não o submeta ao repositório) com:

```js
import { synthSlot } from './src/modes/ft8-encode.js';
import { decodeSlot } from './src/modes/ft8-decode.js';
import { addAwgn, sigmaForSnr } from './test/fixtures/dsp.js';

const slot = synthSlot('CQ EA4AAA IN80', 'FT8', { freqHz: 1500, amplitude: 0.1 });
const noisy = addAwgn(slot, sigmaForSnr(0.1, -10), 42);
console.log(decodeSlot(noisy, { mode: 'FT8' }));
```

Execute `node lab-ft8.mjs`. Verá `{ text, freqHz, dtSec, snrDb, ... }`. Verifique a assinatura exata de `addAwgn` e `sigmaForSnr` em [`test/fixtures/dsp.js`](../../../test/fixtures/dsp.js) antes de executar. Experimente:

- Baixe a SNR de −10 para −18 dB até perder a mensagem (capítulo 8).
- Mova `freqHz` entre 200 e 3000 Hz.
- Sobreponha duas mensagens a frequências diferentes somando os arrays.

## Prática 3: medir o desvio da baliza com um espectro simulado

```js
import { estimateBeaconOffset } from './src/beacon/index.js';

const n = 1024;
const powersDb = new Float32Array(n).fill(-90);
powersDb[519] = -62; powersDb[520] = -55; powersDb[521] = -60;
console.log(estimateBeaconOffset({
  powersDb, centerHz: 739_750_000, binHz: 100, expectedHz: 739_750_000,
}));
```

Resultado esperado: `found: true`, `offsetHz` ≈ +808 Hz (bin 520 + δ ≈ 0,083). Experimente também um pico demasiado baixo (SNR < 10 dB) e observe `reason: 'low_snr'`. Para a trama binária completa, [`test/fixtures/spectrum-frame.js`](../../../test/fixtures/spectrum-frame.js) gera o formato que `src/webrtc/spectrum.js` lê.

## Prática 4: orçamento de ligação com as calculadoras

```js
import { lnbLineup } from './services/qo100-calculators/assets/qo100-math.js';

console.log(lnbLineup({
  dishGainDbi: 37.3, antennaTempK: 60, lnbNfDb: 0.6, lnbGainDb: 55,
  coaxLossDb: 3, biasTLossDb: 0.3, sdrNfDb: 6,
  eirpDbw: 30, slantRangeKm: 38000, freqHz: 10_489_750_000, bandwidthHz: 2700,
}));
```

O EIRP de 30 dBW é **ilustrativo**: substitua-o pelo valor real publicado pela AMSAT-DL. Compare a NF e o G/T com os cálculos do capítulo 3 e verifique o que acontece ao duplicar o diâmetro do prato (+6 dB de ganho).

## Prática 5: os gráficos do manual

```
node docs/manual/figures/generate-charts.mjs
```

Volta a gerar as figuras 23 a 26. Edite `generate-charts.mjs` para alterar os fatores de roll-off do cosseno elevado ou os valores de CP e observe como mudam as figuras.

## Entrega sugerida

Anote num caderno: (1) a SNR mínima de descodificação FT8 que obteve, (2) o desvio medido da baliza, (3) o G/T e a SNR da ligação da sua estação. Compare com as medições reais do manual de colocação em funcionamento ([`docs/help/primera-puesta-en-marcha.md`](../../help/primera-puesta-en-marcha.md)).

## Soluções orientativas

1. Anote a SNR mais baixa em que ainda descodifica; depende da semente e da definição de SNR de `sigmaForSnr` (verifique-a no fixture).
2. ≈ +808 Hz, com o pico no bin 520.
3. A SNR de 2700 Hz resulta da fórmula do capítulo 3; com EIRP 30 dBW e os valores anteriores fica em torno de 37 dB.

**Leitura recomendada:** Collins et al., *Software-Defined Radio for Engineers*, ch. 11 (Applications for Software-Defined Radio).

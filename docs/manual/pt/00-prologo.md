[ES](../es/00-prologo.md) · [EN](../en/00-prologo.md) · [FR](../fr/00-prologo.md) · [PT](../pt/00-prologo.md)

# Prólogo

![Blocos de um SDR](../figures/fig-01-bloques-sdr.svg)

*Figura 1: Blocos de um SDR.*

Há poucos anos, ouvir o satélite geoestacionário QO-100 exigia uma cadeia de equipamentos caros e fechados. Hoje um dongle de algumas dezenas de euros, um LNB e uma antena parabólica de TV permitem ver no ecrã toda a banda estreita de 500 kHz e descodificar em simultâneo dezenas de comunicações. O que mudou não é a antena: é que **o rádio passou do circuito para o algoritmo**.

Este manual quer que compreenda esse algoritmo o suficiente para depurar a sua estação, escolher hardware com critério e ler o código do BricoHams sem medo.

## A quem se dirige

- Radioamadores com formação de eletrónica básica ou vontade de a aprender.
- Construtores («faça-o você mesmo») que montam prato, LNB, hélice e SDR e querem saber *porque* funcionam.
- Estudantes que procuram exemplos de DSP com um caso real e reprodutível.

Não é preciso saber programar, mas as práticas do [capítulo 12](12-practicas.md) usam Node.js (versão 24) e são mais proveitosas se se atrever a editar os exemplos.

## Como está organizado

Os capítulos 2 a 10 seguem o caminho do sinal, desde o ar até à mensagem descodificada: amostragem, ruído, modulação, hardware, sincronização de tempo e de portadora, codificação, canal e OFDM. O capítulo 11 junta tudo na estação BricoHams e o 12 propõe laboratórios.

Cada capítulo termina com exercícios resolvidos. Os valores do QO-100 (frequências, transposição do satélite, FI do LNB) provêm do código do repositório, em [`src/modes/frequencies.js`](../../../src/modes/frequencies.js); os parâmetros de FT8 e FT4, de [`src/modes/ft8-constants.js`](../../../src/modes/ft8-constants.js).

## Convenções

- Decimais com vírgula no texto; no código, ponto.
- «dB» são relações de potência (10·log₁₀) salvo indicação; dBm, dBW e dBFS levam a sua referência.
- Os valores marcados como *ilustrativos* são hipóteses para praticar, não medições da sua estação.

## Honestidade sobre as fontes

Este texto é original: explica os conceitos com palavras e exemplos próprios. Onde um livro cobre um tema com mais profundidade, indicamo-lo como leitura recomendada (por capítulo, sem reproduzir o seu conteúdo). Verifique sempre os parâmetros operacionais (frequências de baliza, limites de potência, plano de bandas) nas fontes oficiais da AMSAT-DL e da sua administração.

**Leitura recomendada:** Collins et al., *Software-Defined Radio for Engineers*, ch. 1 (Introduction to Software-Defined Radio).

[ES](../es/README.md) · [EN](../en/README.md) · [FR](../fr/README.md) · [PT](../pt/README.md)

<p align="center">
  <a href="https://bricohams.org"><img src="../../../branding/bricohams_horizontal.png" alt="BricoHams" width="360"></a>
</p>

# Rádio definido por software (SDR) para radioamadores: da teoria à estação QO-100

**BricoHams** · *Radioamadorismo · Faça-o você mesmo* · <https://bricohams.org>

- **Autores:** Anatol EA5KAO, Diego EA5JEF e Pedro Roca Molina.
- **Versão:** 1.0
- **Idioma mestre:** espanhol (as traduções derivam dele).
- **Licença do texto e das figuras:** [Creative Commons BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.pt). O código do repositório (`src/`, `services/`, `plugins/`) é distribuído sob **GPL-3.0-or-later** (ver [`NOTICE.md`](../../../NOTICE.md)).

Este manual é uma obra original. Explica o rádio definido por software com exemplos reais da banda estreita do QO-100 e do código desta estação. Os livros e projetos de terceiros são citados apenas como leitura recomendada; nenhuma marca, empresa ou projeto citado apoia o BricoHams nem este manual (não há apoio nem aval de terceiros).

## Como usar este manual

Cada capítulo tem: objetivos, explicação com exemplos numéricos do QO-100, pelo menos uma figura, uma caixa **«Como o BricoHams o faz»** com ligações a ficheiros reais do repositório, exercícios com solução e uma linha de **«Leitura recomendada»**. As práticas do [capítulo 12](12-practicas.md) executam-se com Node 24 e sem hardware nem rede.

As figuras 23 a 26 (BER teórica, capacidade de Shannon, prefixo cíclico OFDM, cosseno elevado) são calculadas com um script. Para as regenerar: `node docs/manual/figures/generate-charts.mjs`.

## Índice

| Cap. | Ficheiro | Tema |
|---|---|---|
| 0 | [Prólogo](00-prologo.md) | A quem se dirige e como lê-lo |
| 1 | [O que é um SDR?](01-que-es-sdr.md) | Arquitetura geral e a cadeia do QO-100 |
| 2 | [Sinais e sistemas](02-senales-y-sistemas.md) | Amostragem, Nyquist, aliasing, I/Q, FFT, janelas, dizimação |
| 3 | [Ruído e probabilidade](03-ruido-y-probabilidad.md) | Ruído térmico, SNR, Eb/N0, figura de ruído |
| 4 | [Modulação digital](04-modulacion-digital.md) | FSK, PSK, FT8, FT4, CW, conformação de pulsos |
| 5 | [Hardware SDR](05-hardware-sdr.md) | FI zero, ADC, fugas do oscilador, referência de relógio |
| 6 | [Sincronização de tempo](06-sincronizacion-de-tiempo.md) | Símbolos, intervalos de 15 s, UTC e NTP |
| 7 | [Sincronização de portadora](07-sincronizacion-de-portadora.md) | Desvio de frequência e baliza como referência |
| 8 | [Tramas e codificação](08-tramas-y-codificacion.md) | Costas, CRC-14, LDPC(174,91) |
| 9 | [Canal e equalização](09-canal-y-ecualizacion.md) | Canal por satélite, Doppler, multipercurso, AGC |
| 10 | [OFDM](10-ofdm.md) | Conceito e porque o QO-100 NB não o usa |
| 11 | [Aplicações no QO-100](11-aplicaciones-qo100.md) | A estação BricoHams completa |
| 12 | [Práticas](12-practicas.md) | Laboratórios com o código do repositório |
| — | [Glossário](glosario.md) | Termos e siglas |
| — | [Bibliografia](bibliografia.md) | Leituras e documentação |

## Figuras

As figuras estão em [`../figures/`](../figures/) (`fig-NN-<tema>.svg`), são SVG escritos à mão ou gerados com script, com título e descrição acessíveis, e usam a paleta BricoHams (azul-marinho `#12263f`, laranja `#e8871e`, cinzento `#5b6b7b`). O texto interno das figuras está em espanhol; nos capítulos em português cada figura leva uma legenda traduzida.

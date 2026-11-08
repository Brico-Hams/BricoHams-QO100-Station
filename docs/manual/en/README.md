[ES](../es/README.md) · [EN](../en/README.md) · [FR](../fr/README.md) · [PT](../pt/README.md)

<p align="center">
  <a href="https://bricohams.org"><img src="../../../branding/bricohams_horizontal.png" alt="BricoHams" width="360"></a>
</p>

# Software-Defined Radio (SDR) for Radio Amateurs: From Theory to the QO-100 Station

**BricoHams** · *Amateur radio · Do it yourself* · <https://bricohams.org>

- **Authors:** Anatol EA5KAO, Diego EA5JEF and Pedro Roca Molina.
- **Version:** 1.0
- **Master language:** Spanish (translations derive from it).
- **License of the text and figures:** [Creative Commons BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.en). The repository code (`src/`, `services/`, `plugins/`) is distributed under **GPL-3.0-or-later** (see [`NOTICE.md`](../../../NOTICE.md)).

This manual is an original work. It explains software-defined radio with real examples from the QO-100 narrowband transponder and from this station's code. Third-party books and projects are cited only as recommended reading; no cited brand, company or project endorses BricoHams or this manual (there is no sponsorship or third-party endorsement).

## How to use this manual

Each chapter has: objectives, an explanation with numerical QO-100 examples, at least one figure, a **"How BricoHams does it"** box with links to real files in the repository, exercises with solutions, and a **"Further reading"** line. The labs in [chapter 12](12-practicas.md) run with Node 24 and need no hardware or network.

Figures 23 to 26 (theoretical BER, Shannon capacity, OFDM cyclic prefix, raised cosine) are computed by a script. To regenerate them: `node docs/manual/figures/generate-charts.mjs`.

## Contents

| Ch. | File | Topic |
|---|---|---|
| 0 | [Preface](00-prologo.md) | Who it is for and how to read it |
| 1 | [What is an SDR?](01-que-es-sdr.md) | General architecture and the QO-100 chain |
| 2 | [Signals and systems](02-senales-y-sistemas.md) | Sampling, Nyquist, aliasing, I/Q, FFT, windows, decimation |
| 3 | [Noise and probability](03-ruido-y-probabilidad.md) | Thermal noise, SNR, Eb/N0, noise figure |
| 4 | [Digital modulation](04-modulacion-digital.md) | FSK, PSK, FT8, FT4, CW, pulse shaping |
| 5 | [SDR hardware](05-hardware-sdr.md) | Zero-IF, ADC, oscillator leakage, clock reference |
| 6 | [Timing synchronization](06-sincronizacion-de-tiempo.md) | Symbols, 15 s slots, UTC and NTP |
| 7 | [Carrier synchronization](07-sincronizacion-de-portadora.md) | Frequency offset and the beacon as a reference |
| 8 | [Frames and coding](08-tramas-y-codificacion.md) | Costas, CRC-14, LDPC(174,91) |
| 9 | [Channel and equalization](09-canal-y-ecualizacion.md) | Satellite channel, Doppler, multipath, AGC |
| 10 | [OFDM](10-ofdm.md) | The concept and why QO-100 NB does not use it |
| 11 | [QO-100 applications](11-aplicaciones-qo100.md) | The complete BricoHams station |
| 12 | [Labs](12-practicas.md) | Labs using the repository code |
| — | [Glossary](glosario.md) | Terms and acronyms |
| — | [Bibliography](bibliografia.md) | Readings and documentation |

## Figures

The figures are in [`../figures/`](../figures/) (`fig-NN-<topic>.svg`). They are hand-written or script-generated SVGs with accessible titles and descriptions, and use the BricoHams palette (navy `#12263f`, orange `#e8871e`, gray `#5b6b7b`). The figures are shared among all language versions, so their embedded text is in Spanish; each figure has a translated caption underneath.

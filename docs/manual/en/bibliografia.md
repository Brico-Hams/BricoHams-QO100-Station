[ES](../es/bibliografia.md) · [EN](../en/bibliografia.md) · [FR](../fr/bibliografia.md) · [PT](../pt/bibliografia.md)

# Bibliography and Readings

## Reference book (recommended reading by chapter)

Travis F. Collins, Robin Getz, Di Pu, Alexander M. Wyglinski. *Software-Defined Radio for Engineers*. Artech House, 2018. ISBN 978-1-63081-457-1. All rights reserved by its authors; this manual does not reproduce or translate its content.

| Book chapter | Topic | Chapter of this manual |
|---|---|---|
| 1. Introduction to Software-Defined Radio | Overview | [1](01-que-es-sdr.md) |
| 2. Signals and Systems | Sampling, FFT, filters | [2](02-senales-y-sistemas.md) |
| 3. Probability in Communications | Noise, probability | [3](03-ruido-y-probabilidad.md) |
| 4. Digital Communications Fundamentals | Modulation | [4](04-modulacion-digital.md) |
| 5. Understanding SDR Hardware | Hardware | [5](05-hardware-sdr.md) |
| 6. Timing Synchronization | Timing | [6](06-sincronizacion-de-tiempo.md) |
| 7. Carrier Synchronization | Carrier | [7](07-sincronizacion-de-portadora.md) |
| 8. Frame Synchronization and Channel Coding | Frames and coding | [8](08-tramas-y-codificacion.md) |
| 9. Channel Estimation and Equalization | Channel | [9](09-canal-y-ecualizacion.md) |
| 10. Orthogonal Frequency Division Multiplexing | OFDM | [10](10-ofdm.md) |
| 11. Applications for Software-Defined Radio | Applications | [11](11-aplicaciones-qo100.md) |

## Documentation and projects

- **SDRangel**: project documentation and official wiki (the radio engine used by BricoHams, independently).
- **AMSAT-DL**: official information about QO-100 (frequencies, beacons, usage rules).
- **BATC** (British Amateur Television Club): information about the QO-100 wideband transponder and DATV.
- **EA5EN**: QO-100 course in Spanish (chapter-by-chapter summary; cited as a source of ideas and not reproduced). Notes in [`docs/references/ea5en/README.md`](../../references/ea5en/README.md).
- **GNU Radio**: documentation and tutorials, for experimenting with block-based DSP.
- **GQRX**: documentation of the open-source SDR receiver.

## Inside this repository

- Design: [`docs/superpowers/specs/2026-11-08-qo100-station-design.md`](../../superpowers/specs/2026-11-08-qo100-station-design.md)
- Architecture decisions: [`docs/adr/`](../../adr/README.md)
- User guides: [`docs/help/`](../../help/index.md)
- SDR software comparison: [`docs/references/sdr-software/comparison.md`](../../references/sdr-software/comparison.md)

Company, product and project names belong to their owners. None of them endorses BricoHams or this manual; they are cited only as technical references.

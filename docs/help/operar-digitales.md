# Operar en modos digitales (FT8 y FT4)

*English: [src/modes/README.md](../../src/modes/README.md).*

## Estado

BricoHams ajusta el canal, la sintonía y las ranuras UTC (FT8: 15 s; FT4: 7,5 s), pero **el decodificador de FT8/FT4 aún no está integrado**: el sistema indica «decoder not available» y no muestra mensajes decodificados. Por ahora puedes usar un programa externo (WSJT-X) con el audio, o contribuir con un decodificador (ver [DEVELOPER.md](../DEVELOPER.md)).

## Frecuencias

Segmento digital: 10489,540–10489,650 MHz. Frecuencias por defecto (sin verificar, confirma el plan actual):

| Modo | Bajada |
|---|---|
| FT8 | 10489,540 MHz |
| FT4 | 10489,560 MHz |

## Uso

1. Pulsa **FT8** o **FT4**. El paso de sintonía es 50 Hz.
2. Controla la hora: el reloj del equipo debe estar sincronizado (NTP) para encajar en las ranuras.
3. Transmite igual que en [SSB](operar-ssb.md): **Arm TX**, PTT, TOT. Mantén la potencia baja.
4. Registra el contacto con el informe en dB (−50 a +50), por ejemplo `-07`.

En el registro, FT4 se exporta a ADIF como `MODE=MFSK`, `SUBMODE=FT4`.

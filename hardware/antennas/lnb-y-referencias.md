# LNB y referencias de frecuencia

QO-100 se escucha a 10,489-10,50 GHz. Un LNB con LO de 9750 MHz entrega la baliza central de 10 489,750 MHz a unos 739,75 MHz de FI (ver [qo100-fundamentos](../../docs/help/qo100-fundamentos.md)). Condiciones previas: **el LNB debe cubrir 10,489 GHz** (un LNB "universal" con entrada de 10,7 GHz hacia arriba no sirve; comprueba la ficha y mide con la baliza).

## Tipos

| Tipo | Deriva | Ventajas | Inconvenientes |
|---|---|---|---|
| **LNB estándar (oscilador libre/DRO)** | Grande: decenas a cientos de kHz y variable con la temperatura (medir con la baliza) | Barato y fácil de encontrar | Imposible operar SSB sin corregir la frecuencia; la corrección automática de BricoHams usa la baliza |
| **LNB con PLL y referencia externa (25 o 27 MHz)** | Depende de la referencia: con GPSDO es mínima | El mismo LO sirve para RX y TX; se puede disciplinar | Hay que aportar la referencia por el propio cable o por entrada aparte; no asumas el modelo |
| **LNB con TCXO modificado** (p. ej. el tipo Bullseye de fábrica, o la modificación documentada por OK2ZAW) | Del orden de ppm del TCXO; mucho menor que el estándar | Estable sin equipo extra | La modificación exige soldar a mano; ver la entrada TCXO de `ok2zaw.blogspot.com` (lista de URLs) |
| **GPSDO como referencia (10 MHz)** | Mejor posible | Estabiliza LNB PLL, transverters y SDR; referencia común | Coste y antena GPS exterior |

## Cómo se mide la deriva

1. Sintoniza la baliza central de QO-100 (10 489,750 MHz).
2. Compara la FI medida con 739,750 MHz (con LO nominal de 9750 MHz): la diferencia es la deriva (ver `loDrift()` en `qo100-math.js`).
3. BricoHams aplica esa corrección en RX y en TX (módulo `beacon`).

## Alimentación y seguridad

El LNB se alimenta por el coaxial: 13 V para polarización vertical y 18 V para horizontal en un LNB universal (la banda estrecha se escucha con 13 V según el curso EA5EN, **verificar con tu LNB**). **Nunca conectes la FI del LNB a la entrada de HF de un SDR** y no dejes pasar DC hacia un SDR sin bloquear: usa un inyector de bias-T con bloqueo de DC (ver la cajita [sma_biast_enclosure](../3d/scad/sma_biast_enclosure.scad)).

## Referencias

- Curso Iniciación QO-100, EA5EN Mateo: diapositivas 18 (LNB), 40 (esquema simple de RX) y 48 (lista de enlaces), resumidas en `docs/references/ea5en/`.
- Enlaces de `docs/references/ea5en/urls.txt`: `pabr.org/radio/lnblineup` (alineación de LNB), `ok2zaw.blogspot.com/search/label/TCXO` (modificación TCXO), `eshail.batc.org.uk` (wiki del BATC) y la documentación de AMSAT-DL.

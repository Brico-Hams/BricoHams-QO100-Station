# Operar en CW

*English: [src/modes/README.md](../../src/modes/README.md).*

## Estado

El modo **CW** configura el canal y el plan de banda (segmento 10489,505–10489,540 MHz, frecuencia por defecto 10489,525 MHz, paso de sintonía 10 Hz). El **decodificador de CW** está integrado: busca solo el tono (300–1200 Hz), adapta el umbral y la velocidad (5–40 WPM) y muestra el texto en la lista **Decoded** de la pantalla de radio, con la velocidad estimada y el tono. Funciona mejor con señales limpias y buena relación señal/ruido; con QSB fuerte o manipulado irregular puede equivocarse, así que copia también de oído. Los nombres de los ajustes del manipulador CW en SDRangel están sin verificar.

## Recepción

1. Pulsa **CW** y sintoniza con clic o flechas (Mayúsculas ×10).
2. Pulsa **Listen** y ajusta el volumen.
3. Respeta que la zona de CW está junto a la baliza: no pises la baliza.

## Transmisión

La transmisión CW depende de que SDRangel y el modulador acepten el manipulado; no está comprobado en hardware real. Pruébalo con carga ficticia ([CHECKLIST](../testing/CHECKLIST.md), G). Sigue el mismo procedimiento de turno, **Arm TX**, PTT y TOT descrito en [operar-ssb.md](operar-ssb.md).

Al registrar un contacto CW el informe por defecto es 599.

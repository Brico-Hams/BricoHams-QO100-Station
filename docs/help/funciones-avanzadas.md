# Funciones avanzadas

*English: see [ARCHITECTURE.md](../ARCHITECTURE.md) and ADRs 0011-0015.*

Estas herramientas aparecen en tarjetas de la vista de radio. Los **oyentes** pueden ver el estado; solo **operadores** y el **propietario** pueden cambiar la radio. Nada de lo descrito aquí transmite: el PTT sigue las reglas de turno y mantener pulsado ([operar-ssb.md](operar-ssb.md)).

> **Estado honesto:** se ha probado con simulaciones. Los ajustes de AGC, squelch y reducción de ruido dependen de nombres de campos de SDRangel que hay que comprobar con tu versión (ver [CHECKLIST](../testing/CHECKLIST.md)).

## Memorias de frecuencia

- **Guardar:** pon nombre (1-32 caracteres), modo y frecuencia actual; opcionalmente el ancho de filtro. Máximo 200 por usuario. No se repite nombre (sin distinguir mayúsculas).
- **Recuperar:** elige la memoria y pulsa *Recuperar*. Cambia modo, sintoniza y aplica el filtro. Si estás transmitiendo no se puede cambiar de modo (`tx_active`).
- **Compartidas:** el propietario puede marcar una memoria como compartida: la ven todos, solo él la edita.
- **Presets QO-100** integrados: baliza BPSK, segmento CW, FT8, FT4 y SSB.
- Las memorias son privadas: nadie ve las tuyas salvo que sean compartidas.

## Plan de bandas

El espectro muestra los segmentos del transpondedor de banda estrecha (baliza, CW, digital, SSB…), tomados de `/api/bandplan`. Es una ayuda visual, no una autorización de transmitir.

## RIT, XIT y bloqueo TX/RX

- **RIT** desplaza solo la recepción (±9999 Hz). **XIT** desplaza solo la transmisión.
- **Bloquear TX a RX** (por defecto): tu TX sigue a la frecuencia de recepción. Desbloquéalo y fija una frecuencia de TX para trabajar en **split**.
- **Mi señal:** indica la diferencia entre tu TX en el downlink y tu RX, para saber dónde escucharte.
- Los cambios de XIT/split se aplican **después de soltar el PTT**, nunca con la portadora activa.
- Las frecuencias deben quedar dentro del transpondedor de banda estrecha (10 489,505-10 489,990 MHz).

## Filtros, AGC, squelch y reducción de ruido

- **Ancho de filtro** por modo: SSB y CW (estrecho/normal/ancho), FT8 y FT4 (normal/ancho). *Normal* es el valor por defecto de siempre y se restablece al cambiar de modo.
- **AGC:** apagado, lento, medio, rápido. **Squelch:** -100 a 0 dB, o desactivado. **Reducción de ruido:** sí/no. Se conservan al cambiar de modo.
- Afectan solo al receptor. Si tu SDRangel usa otros nombres de ajustes, el cambio puede ignorarse (verificar).

## Espectro y cascada

Solo cambian tu pantalla y se guardan en tu navegador:

- **Zoom:** 1×, 2×, 4×, 8×, 16× alrededor de la frecuencia de recepción.
- **Promedio** (varias tramas, en potencia lineal) y **retención de picos**.
- **Paletas:** clásica, grises, fuego, viridis. **Contraste** ajustable.

## Grabación de audio recibido

- *Grabar* guarda el audio RX en un WAV (12 kHz, mono, 16 bits) en el servidor. Pulsa de nuevo para parar. Descarga o borra tus grabaciones en la lista.
- Límites: tamaño por archivo y espacio por usuario (por defecto 100 MB y 1000 MB); una grabación a la vez por usuario. Al llegar al límite la grabación se detiene sola.
- El **propietario** puede desactivar la grabación (y la configuración `recording.enabled: false` la desactiva siempre). Los oyentes no pueden grabar.
- Se graba solo el audio recibido, nunca el micrófono. Avisa a tus operadores de que el audio puede guardarse.

## Atajos de teclado

Se pueden desactivar en *Ajustes*. Se ignoran al escribir en un campo de texto y con Ctrl/Alt/Meta. **Ningún atajo puede transmitir**: el único que toca el PTT es la barra espaciadora, con las reglas de turno y mantener pulsado.

| Tecla | Acción |
|---|---|
| Espacio | PTT (mantener, solo con turno) |
| 1 / 2 / 3 / 4 | Modo SSB / CW / FT8 / FT4 |
| , y . | Sintonizar -1 / +1 paso |
| < y > | Sintonizar -10 / +10 pasos |
| [ y ] | RIT -10 / +10 Hz |
| { y } | XIT -10 / +10 Hz |
| 0 | Borrar RIT y XIT |
| l | Bloquear/desbloquear TX a RX |
| f | Siguiente ancho de filtro |
| a | Siguiente modo de AGC |
| s | Siguiente nivel de squelch |
| n | Reducción de ruido sí/no |
| p | Retención de picos sí/no |
| v | Siguiente promedio del espectro |
| z / x | Zoom + / - |
| w | Siguiente paleta de cascada |
| r | Empezar/parar escucha |
| o | Empezar/parar grabación |
| m | Guardar frecuencia como memoria |
| ? | Mostrar la lista |

Las acciones que cambian la radio solo funcionan si eres operador o propietario.

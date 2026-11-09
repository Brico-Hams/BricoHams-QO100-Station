# Funciones avanzadas

*English: see [ARCHITECTURE.md](../ARCHITECTURE.md) and ADRs 0011-0015, 0022 (UDP audio, beacon engines).*

Estas herramientas aparecen en tarjetas de la vista de radio. Los **oyentes** pueden ver el estado; solo **operadores** y el **propietario** pueden cambiar la radio. Nada de lo descrito aquí transmite: el PTT sigue las reglas de turno y mantener pulsado ([operar-ssb.md](operar-ssb.md)).

> **Estado honesto:** se ha probado con simulaciones y contra la definición oficial de la API de SDRangel, no con una estación real: confirma los ajustes de AGC y squelch con tu versión (ver [CHECKLIST](../testing/CHECKLIST.md)). Qué puedes comprobar sin hardware: [comprobar-sin-hardware.md](comprobar-sin-hardware.md).

## Memorias de frecuencia

- **Guardar:** pon nombre (1-32 caracteres), modo y frecuencia actual; opcionalmente el ancho de filtro. Máximo 200 por usuario. No se repite nombre (sin distinguir mayúsculas).
- **Recuperar:** elige la memoria y pulsa *Recuperar*. Cambia modo, sintoniza y aplica el filtro. Si estás transmitiendo no se puede cambiar de modo (`tx_active`).
- **Compartidas:** el propietario puede marcar una memoria como compartida: la ven todos, solo él la edita.
- **Presets QO-100** integrados: baliza BPSK, segmento CW, FT8, FT4 y SSB.
- Las memorias son privadas: nadie ve las tuyas salvo que sean compartidas.

## Puertos UDP de audio

*Solo el propietario, editando `config.json`. Nada de esto se cambia desde el navegador.*

BricoHams intercambia audio con SDRangel por UDP, dentro de tu propia máquina:

| Clave | Por defecto | Sentido |
|---|---|---|
| `audio.rxUdp` (`host`, `port`) | `127.0.0.1`, `9998` | **Recepción.** Un canal *UDPSink* de SDRangel envía el audio USB (48 kHz, mono) a esta dirección; BricoHams escucha ahí |
| `audio.txUdp` (`host`, `port`) | `127.0.0.1`, `9999` | **Transmisión.** BricoHams envía el audio del micrófono (48 kHz, mono) a esta dirección, donde escucha un canal *UDPSource* de SDRangel |
| `audio.spectrumUrl` | `ws://127.0.0.1:8887` | Servidor de espectro de SDRangel (baliza y cascada) |
| `audio.enabled` | `false` en el programa; `true` en `config.example.json` | Sin esto no hay audio, espectro ni baliza por espectro |

Ejemplo, si el 9998 ya lo usa otro programa:

```json
"audio": { "enabled": true, "rxUdp": { "host": "127.0.0.1", "port": 9988 }, "txUdp": { "host": "127.0.0.1", "port": 9989 } }
```

- BricoHams **crea y configura** los canales UDPSink y UDPSource en SDRangel al arrancar (y de nuevo al cambiar de modo si hizo falta), con los puertos de `config.json`. Si cambias un puerto, reinicia BricoHams y no lo cambies a mano en SDRangel.
- Los puertos deben estar entre 1 y 65535 (y ser distintos entre sí, o el audio de TX y RX se mezclaría). Mantenlos en `127.0.0.1`: UDP no tiene autenticación ni cifrado. Para `spectrumUrl`, una dirección que no sea local debe usar `wss:`.
- El modulador SSB de SDRangel **no** recibe audio por UDP: por eso se usa UDPSource. El SSB solo se añade en CW (manipulador de CW). Por la misma razón no hay reducción de ruido ni notch de SDRangel.
- El audio de TX solo se envía mientras el PTT está en `TX_ON`.

## Motor de baliza

La baliza BPSK de QO-100 sirve para medir la deriva del LNB y corregir la frecuencia de recepción. Hay dos motores; se elige en `config.json`:

```json
"beacon": { "engine": "bricohams" }
```

| Valor | Qué hace | Cuándo elegirlo |
|---|---|---|
| `"bricohams"` (por defecto) | Mide la baliza en el espectro de SDRangel (necesita `audio.enabled` y `audio.spectrumUrl`), filtra con mediana y media exponencial y corrige | Lo normal. Sigue derivas de varios kHz y localiza la baliza dentro de ±10 kHz |
| `"sdrangel-freqtracker"` | Crea en SDRangel un canal *FreqTracker* sobre la baliza y lee su error de seguimiento; BricoHams aplica el mismo filtro y la corrección | Si no quieres depender del espectro. El FreqTracker solo ve unos ±250 Hz: el receptor debe estar ya casi en la frecuencia correcta y la deriva ser suave |

En ambos casos, sin enganche no se cambia nada: se conserva la última corrección y el panel muestra «no-lock». Es un ajuste de arranque: reinicia tras cambiarlo. Con otro valor el programa se niega a arrancar y nombra la clave.

### Corregir también la transmisión: `station.applyCorrectionToTx`

Por defecto es `false`, y conviene dejarlo así:

- La baliza se **recibe** a través de tu LNB, así que mide la deriva del oscilador de **recepción**. Eso no dice nada del oscilador de tu transmisor.
- Solo si el SDR de TX comparte referencia con el de RX (por ejemplo, un GPSDO o una señal de 10 MHz común) la deriva medida también vale para la subida. Entonces puedes poner `"station": { "applyCorrectionToTx": true }`.
- Si lo activas sin referencia común, **moverías tu subida sin motivo** y podrías salir de tu frecuencia. Pruébalo siempre con carga ficticia y un receptor auxiliar ([CHECKLIST, sección G](../testing/CHECKLIST.md)). Las correcciones de TX nunca se aplican con el PTT activo.

## Plan de bandas

El espectro muestra los segmentos del transpondedor de banda estrecha (baliza, CW, digital, SSB…), tomados de `/api/bandplan`. Es una ayuda visual, no una autorización de transmitir.

## RIT, XIT y bloqueo TX/RX

- **RIT** desplaza solo la recepción (±9999 Hz). **XIT** desplaza solo la transmisión.
- **Bloquear TX a RX** (por defecto): tu TX sigue a la frecuencia de recepción. Desbloquéalo y fija una frecuencia de TX para trabajar en **split**.
- **Mi señal:** indica la diferencia entre tu TX en el downlink y tu RX, para saber dónde escucharte.
- Los cambios de XIT/split se aplican **después de soltar el PTT**, nunca con la portadora activa.
- Las frecuencias deben quedar dentro del transpondedor de banda estrecha (10 489,505-10 489,990 MHz).

## Filtros, AGC, squelch y reducción de ruido

- **Ancho de filtro** por modo: SSB y CW (estrecho/normal/ancho), FT8 y FT4 (normal/ancho). *Normal* es el valor por defecto de siempre y se restablece al cambiar de modo. Solo cambia el ancho de banda de RF del canal de audio de SDRangel.
- **AGC:** apagado, lento, medio, rápido. **Squelch:** -100 a 0 dB, o desactivado. Se conservan al cambiar de modo.
- **Reducción de ruido:** hoy **no está disponible**: SDRangel solo la ofrece en el demodulador SSB, que BricoHams no usa para el audio (ver [Puertos UDP de audio](#puertos-udp-de-audio)); si la pides, el servidor responde `dnr_unavailable`.
- Afectan solo al receptor. Con las versiones de SDRangel probadas los nombres de ajustes coinciden con su definición de API; si usas una versión muy distinta, el cambio puede ignorarse.

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

## Notch y auto-notch

- El **notch** elimina una portadora o un silbido dentro de la banda: indica el desplazamiento (Hz) y el ancho, o **haz clic en la portadora del espectro** para colocarlo. El **auto-notch** busca y elimina tonos estables solo (filtro adaptativo LMS).
- Se aplica siempre en tu navegador y solo afecta a tu audio: SDRangel no tiene notch en su API, así que no se envía al servidor.
- Teclas: `k` notch, `u` auto-notch. Solo operadores y propietario.

## Grabación y reproducción I/Q

- Desactivada por defecto (`iq.enabled`). La hace SDRangel en su equipo: las muestras no pasan por BricoHams. Operadores y propietario pueden iniciar/parar, listar, borrar y **reproducir** (el RX pasa a un dispositivo de archivo; *Volver a directo* restablece la radio).
- Límites: espacio por usuario y duración máxima; el propietario puede desactivarla. Nunca toca el transmisor.

## Clúster DX y calendario de actividad

- Desactivados por defecto; el propietario configura el clúster (`cluster`) y la URL del calendario `.ics` (`calendar`). Solo se muestran spots del downlink de banda estrecha (10489,5–10490,0 MHz); los dados en el uplink 2400,x se convierten.
- Los spots aparecen como marcas en el espectro y en una lista; **un clic sintoniza el RX**, nunca transmite. «Spot this» (operador) publica en el clúster solo si `cluster.postSpots` está activo.
- El calendario lista las próximas actividades (el propietario puede actualizarlo o subir un `.ics`; las reglas de repetición RRULE no se expanden).

## Importar y exportar memorias

- Exporta tus memorias en JSON (con versión de esquema) o CSV. Importa JSON o CSV (también columnas tipo CHIRP: nombre, frecuencia en MHz, modo). Usa primero la **vista previa**: muestra filas válidas, duplicadas e inválidas. Solo operadores y propietario importan; lo importado es personal.

## Plugins

- El propietario puede instalar plugins de cliente en `plugins/` y activarlos en `plugins.enabled`. Solo ven datos (frecuencia, modo, baliza, spots, decodificaciones), añaden paneles, piden sintonizar el RX o rellenan el formulario del diario; no pueden transmitir ni usar el micrófono. Instala solo código en el que confíes. Ver `docs/DEVELOPER.md`.

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
| k | Notch sí/no |
| u | Auto-notch sí/no |
| ? | Mostrar la lista |

Las acciones que cambian la radio solo funcionan si eres operador o propietario.

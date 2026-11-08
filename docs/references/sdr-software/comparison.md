# Comparación de BricoHams QO-100 Station con software SDR establecido

Documento de referencia (no normativo). Está escrito de memoria, sin acceso a Internet durante su redacción: toda afirmación dudosa lleva la marca **(verificar)**. Las versiones y características cambian; compruébalas en la web de cada proyecto antes de citarlas.

## Reglas de licencia

- **SDRuno, HDSDR, SDR#, SDR Console** son software propietario/freeware: solo se toman **ideas** de funcionalidad. No se copia código, interfaz, iconos, paletas con nombre propio ni textos.
- **GPL/BSD/LGPL** (SDRangel, GQRX, CubicSDR, GNU Radio, gr-air-modes, dump1090, rtl_433): se pueden reutilizar ideas. Si algún día se reutilizara código, habría que atribuirlo y mantener una licencia compatible con GPL-3.0-or-later (ADR 0002). **En este cambio no se ha copiado código de ninguno.**
- Alcance: ADS-B (dump1090, gr-air-modes) y sensores ISM 433 MHz (rtl_433) están **fuera de alcance** de una estación QO-100 (no objetivos del diseño); solo aparecen aquí como comparación.

## Programas

### SDRuno (SDRplay)
- **Qué es:** receptor SDR de alto rendimiento para los equipos SDRplay RSP.
- **Plataformas:** Windows. **Licencia:** propietaria/freeware (verificar estado actual del soporte).
- **Puntos fuertes para QO-100:** DSP de calidad (filtros, notch, reducción de ruido, AGC configurable), RIT/XIT, memorias, varias ventanas de espectro y cascada, grabación I/Q y audio, compatibilidad con convertidores (offset de LO) y plugins.
- **Referencia:** https://www.sdrplay.com

### HDSDR
- **Qué es:** receptor de HF/VHF para Windows, sucesor de WinRad.
- **Plataformas:** Windows. **Licencia:** freeware, cerrado.
- **Puntos fuertes:** interfaz sencilla, offset de LO (útil con convertidores/LNB), RIT/XIT, filtros ajustables, grabación I/Q y audio, control CAT por CAT/OmniRig (verificar), extensiones de terceros.
- **Referencia:** https://www.hdsdr.de

### SDR# (SDRSharp)
- **Qué es:** receptor SDR muy extendido, sobre todo con RTL-SDR.
- **Plataformas:** Windows (.NET); builds para Linux/macOS vía Mono/.NET (verificar).
- **Licencia:** freeware, cerrado.
- **Puntos fuertes:** ligero, plugins comunitarios (zoom FFT, frequency manager, grabación programada), cascada con paletas ajustables, corrección PPM, desplazamiento del convertidor.
- **Referencia:** https://sdrsharp.com

### SDR Console (SDR-Radio.com)
- **Qué es:** suite de recepción y transmisión con servidor remoto.
- **Plataformas:** Windows. **Licencia:** freeware con versión de pago (verificar).
- **Puntos fuertes:** varios receptores simultáneos, modo servidor/cliente, soporte de transmisión con equipos compatibles (verificar), memorias y listas de frecuencias, grabación, clústeres DX integrados (verificar).
- **Referencia:** https://www.sdr-radio.com

### SDRangel
- **Qué es:** plataforma SDR modular con decenas de dispositivos y canales (SSB, FT8, DATV, etc.). **Es el motor de BricoHams** (ADR 0001).
- **Plataformas:** Linux, Windows, macOS. **Licencia:** GPL-3.0.
- **Puntos fuertes para QO-100:** API REST completa, varios device sets (RX y TX simultáneos), demodulador y modulador SSB, DATV DVB-S/S2, offset de transverter, plugin FT8/FT4 y beacon-lock con algunas versiones (verificar), grabación I/Q (verificar).
- **Referencia:** https://www.sdrangel.org y https://github.com/f4exb/sdrangel

### GQRX
- **Qué es:** receptor SDR en Qt/GNU Radio.
- **Plataformas:** Linux, macOS (Windows no oficial, verificar). **Licencia:** GPL-3.0 (verificar en cada versión).
- **Puntos fuertes:** simple y estable, marcadores/bookmarks, AGC y squelch, reducción de ruido y notch (verificar), remote control por TCP (rigctl), grabación de audio e I/Q, tutoriales de instalación abundantes.
- **Referencia:** https://gqrx.dk

### CubicSDR
- **Qué es:** receptor SDR multiplataforma con varios demoduladores simultáneos.
- **Plataformas:** Windows, macOS, Linux. **Licencia:** GPL-3.0.
- **Puntos fuertes:** varias señales a la vez, memorias/bookmarks, uso de SoapySDR, interfaz simple.
- **Referencia:** https://cubicsdr.com

### GNU Radio
- **Qué es:** framework de DSP por bloques para construir flujos SDR.
- **Plataformas:** Linux (principal), Windows, macOS. **Licencia:** GPL-3.0-or-later.
- **Puntos fuertes:** construir demoduladores a medida, prototipado, bloques para QO-100 (por ejemplo, receptores de baliza) en la comunidad.
- **Referencia:** https://www.gnuradio.org

### gr-air-modes (fuera de alcance)
- **Qué es:** decodificador ADS-B/Mode-S sobre GNU Radio. **Plataformas:** Linux. **Licencia:** GPL (verificar).
- **Relevancia QO-100:** ninguna. Solo comparación.
- **Referencia:** https://github.com/bistromath/gr-air-modes

### dump1090 (fuera de alcance)
- **Qué es:** decodificador ADS-B autónomo para RTL-SDR. **Plataformas:** Linux/macOS. **Licencia:** BSD de 3 cláusulas (verificar).
- **Relevancia QO-100:** ninguna. Solo comparación.
- **Referencia:** https://github.com/antirez/dump1090

### rtl_433 (fuera de alcance)
- **Qué es:** decodificador de sensores ISM 433 MHz y otros. **Plataformas:** Linux, macOS, Windows. **Licencia:** GPL-2.0 (verificar).
- **Relevancia QO-100:** ninguna. Solo comparación.
- **Referencia:** https://github.com/merbanan/rtl_433

### Tutoriales de instalación (fuente de ideas de empaquetado)
- nobru54.blogspot.fr (2014, analizador de espectro con GQRX), superkuh.com/rtlsdr.html, gqrx.dk/doc/practical-tricks-and-tips, instructables «RTL-SDR en Ubuntu».
- **Ideas aplicadas:** lista negra del módulo DVB del kernel, reglas udev, `rtl_test` para comprobar el dongle, calibración de PPM, aviso de Zadig/WinUSB en Windows (ADR 0016).

## Matriz de características

Leyenda: ✔ sí · ◐ parcial/depende de plugin o versión · ✘ no · ? no estoy seguro (verificar). Las celdas de programas ajenos reflejan mi conocimiento general, **todas están sujetas a (verificar)**. «BH» = BricoHams tras este cambio.

| Característica | SDRuno | HDSDR | SDR# | SDR Console | SDRangel | GQRX | CubicSDR | GNU Radio | BH |
|---|---|---|---|---|---|---|---|---|---|
| Offset de convertidor/LNB QO-100 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | ◐ | ✔ |
| Bloqueo con baliza (corrección de deriva) | ✘ | ✘ | ◐ | ✘ | ◐ | ✘ | ✘ | ◐ | ✔ |
| Dúplex TX/RX simultáneo | ✘ | ✘ | ✘ | ◐ | ✔ | ✘ | ✘ | ◐ | ✔ |
| Escuchar el propio downlink | ✘ | ✘ | ✘ | ◐ | ✔ | ✘ | ✘ | ◐ | ✔ |
| TX sigue a RX / bloqueo TX-RX | ✘ | ✘ | ✘ | ◐ | ◐ | ✘ | ✘ | ✘ | ✔ |
| Memorias/marcadores de frecuencia | ✔ | ✔ | ✔ (plugin) | ✔ | ✔ | ✔ | ✔ | ✘ | ✔ |
| Plan de bandas superpuesto | ◐ | ◐ | ◐ (plugin) | ✔ | ◐ | ◐ | ✘ | ✘ | ✔ |
| Modos de AGC | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | ✔ | ✔ (off/lento/medio/rápido) |
| Squelch | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Reducción de ruido | ✔ | ✔ | ✔ | ✔ | ◐ | ✔ | ✘ | ✔ | ◐ (la del SDRangel, verificar) |
| Notch / auto-notch | ✔ | ✔ | ✔ | ✔ | ◐ | ✔ | ✘ | ✔ | ✘ |
| RIT/XIT | ✔ | ✔ | ◐ | ✔ | ◐ | ✘ | ✘ | ✘ | ✔ |
| Presets de ancho de filtro | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | ✘ | ✔ |
| Promedio / retención de picos | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | ✔ | ✔ |
| Zoom del espectro | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (1-16x) |
| Paletas y contraste de cascada | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (4 paletas) |
| Atajos de teclado | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ | ✔ |
| Grabación I/Q | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ | ✔ | ✘ |
| Grabación de audio | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (WAV en servidor) |
| Clúster DX / spots | ◐ | ✘ | ◐ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Acceso remoto/web | ◐ | ✘ | ◐ | ✔ | ✔ | ◐ (rigctl) | ✘ | ◐ | ✔ (PWA + WSS) |
| Multiusuario con roles | ✘ | ✘ | ✘ | ◐ | ✘ | ✘ | ✘ | ✘ | ✔ (listener/operator/owner) |
| Diario de QSO + LoTW/QRZ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ |
| Decodificadores digitales | ◐ | ◐ | ◐ | ◐ | ✔ | ✘ | ✘ | ◐ | ✔ (FT8/FT4) |
| Plugins | ✔ | ✔ (extIO) | ✔ | ◐ | ✔ | ✘ | ✘ | ✔ | ◐ (plugin OpenWebRX+, ADR 0010) |
| Plataformas | Win | Win | Win (+) | Win | Win/Lin/Mac | Lin/Mac | Win/Lin/Mac | Lin/Win/Mac | Linux .deb, Windows, Raspberry Pi |

Fuera de alcance (no aparecen en la matriz): ADS-B (dump1090, gr-air-modes) y sensores 433 MHz (rtl_433).

## Análisis de carencias

### Lo que le faltaba a BricoHams, por valor para el operador de QO-100

1. **Memorias/marcadores por usuario y presets QO-100** — implementado (ADR 0011). Es lo más usado en el día a día y estaba ausente.
2. **RIT/XIT y TX sigue a RX con control del propio downlink** — implementado (ADR 0012). Imprescindible para el split típico en QO-100 y para oírse a uno mismo.
3. **Superposición del plan de bandas** — implementado. Evita transmitir fuera del segmento correcto.
4. **Presets de filtro por modo** — implementado (ADR 0013).
5. **AGC, squelch y reducción de ruido de RX** — implementado (ADR 0013). Las rutas de ajustes de SDRangel están marcadas «verificar contra el swagger».
6. **Herramientas de espectro: promedio, retención de picos, zoom, paletas y contraste** — implementado en el cliente (ADR 0015).
7. **Atajos de teclado** — implementado; Espacio queda reservado solo para PTT y ningún atajo puede transmitir (ADR 0015).
8. **Grabación de audio RX en WAV** — implementado en el servidor, con límites y control del propietario (ADR 0014).

Pendiente (candidatos futuros, por valor):
- Notch y auto-notch (depende de qué ofrezca SDRangel; verificar).
- Grabación/reproducción I/Q (mucho disco; mejor dejarlo a SDRangel).
- Clúster DX/spots y calendario de actividad en QO-100.
- Memorias con importación/exportación.
- API de plugins propia.

### Lo que BricoHams hace y los demás (en general) no

- **Máquina de estados PTT a prueba de fallos** con turno único, latido, TOT y bloqueo (ADR 0005).
- **Estación remota multiusuario** con inicio de sesión de Google, lista de permitidos y roles.
- **Corrección de deriva con la baliza** y su integración con RX/TX (ADR 0008).
- **Diario de QSO integrado** con ADIF, LoTW y QRZ.
- **Instalación como servicio** (.deb, Raspberry Pi, escritorio Windows).
- **Complemento OpenWebRX+ solo de recepción** que no es camino hacia el transmisor.

## Pendiente de verificar

Todas las celdas de la matriz de programas ajenos, las versiones, las licencias marcadas y las funciones de plugins. Comprobar contra la documentación oficial antes de usar este documento como cita.

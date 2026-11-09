# Primera puesta en marcha

*English: [ARCHITECTURE.md](../ARCHITECTURE.md).*

## 1. SDRangel

BricoHams controla SDRangel por su API REST. Debes tener SDRangel funcionando con la API en `http://127.0.0.1:8091` (valor por defecto de `sdrangel.baseUrl`).

1. Abre SDRangel (o `sdrangelsrv` en servidores) y comprueba que la API REST está activa.
2. **Conjunto de dispositivos 0 (RX):** tu SDR de recepción (por ejemplo RTL-SDR, SDRplay, Airspy). Frecuencia central cerca de la FI de la baliza (ver paso 2).
3. **Conjunto de dispositivos 1 (TX):** tu SDR de transmisión (por ejemplo ADALM-Pluto, USRP B200mini, Hermes Lite 2 con transversor), a unos 2400 MHz. Los índices se cambian con `station.rxDeviceSet` y `station.txDeviceSet` (deben ser distintos).
4. El canal de recepción (un **UDPSink**) envía el audio a `127.0.0.1:9998` (`audio.rxUdp`) a 48 kHz.
5. El canal de transmisión (un **UDPSource**) recibe el audio de tu micrófono en `127.0.0.1:9999` (`audio.txUdp`). Ambos canales los **crea BricoHams solo** al arrancar y al cambiar de modo (si SDRangel aún no estaba listo, se reintenta); no hace falta configurarlos a mano. Solo debes evitar que otro programa use esos puertos. Detalle y cambio de puertos: [funciones-avanzadas.md](funciones-avanzadas.md#puertos-udp-de-audio). Aún no se ha probado con una instancia real: si falla, ver [solucion-de-problemas.md](solucion-de-problemas.md).
6. BricoHams pide a SDRangel que active el servidor de espectro; debe quedar en `ws://127.0.0.1:8887` (`audio.spectrumUrl`). Si no lo consigue, actívalo tú en SDRangel.
7. En `config.json`: `"audio": { "enabled": true }`. Sin esto no hay audio, espectro ni corrección de baliza.

Mantén los puertos de SDRangel **solo en local**; no tienen autenticación.

## 2. LO del LNB

La FI es `frecuencia de bajada − LO`. Con un LNB estándar de 9750 MHz la baliza (10489,750 MHz) queda en 739,75 MHz. Pon tu LO real en `station.lnbLoHz` (en Hz; por defecto `9750000000`). Si tu LNB es de otro tipo (por ejemplo 9750 MHz con reloj externo, o modificado) ajústalo.

## 3. Enganche de la baliza

Con audio y espectro activos, BricoHams mide la baliza BPSK de banda estrecha, filtra la deriva y corrige el centro de recepción.

- El indicador **Beacon** del panel pasa a «locked» cuando hay 3 medidas válidas seguidas (relación señal/ruido ≥ 10 dB dentro de ±10 kHz de lo esperado).
- Si pierde la señal conserva la última corrección y muestra «no-lock».
- Corrección en transmisión: `station.applyCorrectionToTx` está en `false`. Actívalo **solo** si tu oscilador de TX comparte referencia con el de RX (GPSDO). Si no, la baliza no dice nada sobre la deriva de TX.
- Estado `no_source` = falta el espectro (`audio.enabled` o URL).

## 4. Primero, solo recepción

1. Arranca BricoHams, abre la dirección (`publicUrl`) e inicia sesión con Google.
2. Pulsa **Listen**; deberías oír ruido y ver el espectro y la cascada.
3. Comprueba que ves la baliza y que se engancha. Pasa a la lista de comprobación, secciones C a E.

## 5. Activar la transmisión (solo en local)

La transmisión **está desactivada** (`tx.enabled: false`). Solo el titular de la máquina debe activarla:

1. Prueba con **carga ficticia** y medidor de potencia, nunca con antena. Ver [CHECKLIST sección G](../testing/CHECKLIST.md).
2. Edita la configuración local: `"tx": { "enabled": true }` (o `BRICOHAMS_TX_ENABLED=true` en el entorno) y reinicia.
3. Parámetros de seguridad: `tx.totSeconds` (600 s por defecto), `tx.heartbeatTimeoutMs` (máx. 2000), `tx.armedTimeoutSeconds` (120 s).
4. Mantén un **corte físico** del amplificador independiente del software.
5. Irradia solo tras tu decisión, con licencia válida y respetando el plan de banda ([CHECKLIST sección H](../testing/CHECKLIST.md)).

Los decodificadores de FT8, FT4 y CW están integrados (JavaScript puro) y muestran el texto en la lista **Decoded**. Se han probado solo con señales sintéticas ([comprobar-sin-hardware.md](comprobar-sin-hardware.md)); los valores de SNR y de desviación de tiempo son estimaciones hasta probarlos con señales reales.

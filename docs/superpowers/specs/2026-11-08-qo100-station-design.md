# BricoHams QO-100 Station: diseño

Fecha: 2026-11-08. Estado: aprobado para construir (el usuario pidió construir sin más rondas de preguntas).
Antecedentes: `../../../Estudio estacion QO100 BricoHams/` (arquitectura.md, BOM.csv, docs/digital_nativo_ft8_ft4_cw.md) y `../../../BricoHams-QO100-Remote-Listen/`.

## 1. Propósito

Un único programa para operar una estación QO-100 (Es'hail-2), tanto en transmisión como en recepción, desde el navegador y desde cualquier sitio. Mejora lo que ya existe en lugar de reescribirlo: el motor de radio es SDRangel y BricoHams añade la capa que falta (acceso remoto seguro, turnos, log con LoTW y QRZ, corrección de frecuencia automática e instaladores). Referencias funcionales: SDR Console V3 (solo como idea, porque es propietario), SDRangel, SDR++ y el WebSDR QO-100 de DJ0ABR.

## 2. Objetivos de la versión 1 (todos obligatorios)

1. **Motor SDR dúplex**: recepción por la FI del LNB (unos 740 MHz) y transmisión en 2400.000–2400.500 MHz, con el hardware del BOM: RTL-SDR, SDRplay, Airspy, ADALM-Pluto, USRP B200mini y Hermes Lite 2 con transverter.
2. **Corrección de frecuencia**: enganche a la baliza de banda estrecha de QO-100 (baliza BPSK central de 10489.750 MHz; las de CW en 10489.500 y 10490.000 MHz como alternativa), medida de la deriva del LNB y corrección continua de la recepción y la transmisión. También se puede introducir el offset del LNB a mano.
3. **Modos**: SSB (USB), CW y digitales FT8, FT4 y CW decodificado. El audio de los digitales se procesa dentro del programa, sin cables de audio virtuales.
4. **Log**: contactos SSB, CW y digitales guardados en local. Exportación ADIF 3.1 compatible con LoTW (`PROP_MODE=SAT`, `SAT_NAME=QO-100`, `BAND=13CM`, `BAND_RX=3CM`, `FREQ` y `FREQ_RX`), subida a LoTW mediante TQSL y subida a QRZ Logbook mediante su API.
5. **Acceso web remoto**: interfaz HTML5 instalable como PWA ("web install"), con espectro, cascada, audio de recepción y micrófono del navegador para transmitir.
6. **Multiusuario con un solo operador a la vez**: inicio de sesión con Google (OpenID Connect) y lista de cuentas autorizadas que mantiene el titular de la estación, cada una asociada a un indicativo y a un rol. El turno de transmisión es exclusivo y lo gestiona la máquina de PTT.
7. **Cifrado**: HTTPS/TLS para la web y la API, WSS para el control y DTLS-SRTP (WebRTC) para el audio. Las claves de terceros (QRZ) se guardan cifradas en reposo.
8. **Escucha pública**: un plugin para OpenWebRX+ que solo escucha y no tiene ninguna ruta hacia la transmisión.
9. **Instaladores**: Windows x64 (NSIS), Linux x64 y Raspberry Pi arm64 (.deb con servicio systemd y AppImage). Los genera GitHub Actions.
10. **Calidad**: pruebas unitarias por módulo, pruebas funcionales de extremo a extremo con un SDRangel simulado, checklist manual para quien lo pruebe con hardware, ayuda de usuario, ADR que justifican la arquitectura y documentación para desarrolladores lo bastante completa como para que cualquiera entienda y corrija el código.

## 3. No objetivos y anti-objetivos

- No objetivos: DATV, otros satélites, control de rotor y app nativa para móvil (basta con la PWA).
- Anti-objetivos (aunque "funcione", sería un fracaso):
  - Transmitir sin un operador autenticado y autorizado, o con dos operadores a la vez.
  - Que la portadora siga en el aire tras perder la conexión: el watchdog debe cortar en menos de 2 s.
  - Copiar código de SDR Console o de cualquier software propietario.
  - Mostrar, registrar o subir al repo secretos (secreto del cliente OAuth, claves de API de QRZ, certificados de TQSL).
  - Dar acceso a la transmisión desde el plugin de escucha.

## 4. Restricciones

- Licencia: **GPL-3.0-or-later**, porque se integra SDRangel (GPL-3.0). Se citan todos los componentes en `NOTICE.md` y en "Acerca de".
- Node.js 24 o superior, ES modules y JavaScript sin paso de compilación (la misma convención que BricoHams-QO100-Remote-Listen).
- Dependencias mínimas. Base de datos: `node:sqlite` integrado. Tests: `node:test`.
- SDRangel se instala aparte (es un requisito previo documentado). Lo detecta el instalador y lo comprueba un asistente de arranque.
- El micrófono y el WebRTC solo funcionan en un contexto seguro (HTTPS o localhost).
- La transmisión está desactivada por defecto en la configuración y requiere una confirmación local del titular la primera vez.

## 5. Arquitectura

```
Navegador (PWA) ──HTTPS/WSS/WebRTC──► Servidor BricoHams (Node) ──REST/WS──► SDRangel (sdrangelsrv)
                                        │                                       │
                                        ├─ auth (Google OIDC + lista blanca)    └─ SDR RX / SDR TX
                                        ├─ ptt (turno único + watchdog + TOT)
                                        ├─ beacon (medida de baliza → corrección)
                                        ├─ modes (SSB/CW/FT8/FT4)
                                        ├─ log (sqlite → ADIF → TQSL / QRZ)
                                        └─ webrtc (audio RX ↓, micro TX ↑)
OpenWebRX+ ── plugin BricoHams (solo RX, sin ruta al servidor de TX)
```

Módulos (cada uno en `src/<módulo>/`, con su propio README, pruebas unitarias e interfaz pública documentada con JSDoc):

| Módulo | Responsabilidad |
|---|---|
| `server` | HTTP(S) y WSS; carga y valida la configuración; cabeceras de seguridad (CSP, HSTS); sirve la PWA. |
| `auth` | Google OIDC (flujo de código con PKCE y `state`/`nonce`), sesión en cookie `HttpOnly; Secure; SameSite=Strict`, lista blanca `email → {indicativo, rol}` con los roles `listener`, `operator` y `owner`, y protección CSRF. |
| `ptt` | Máquina de estados de §4 del estudio: `TX_OFF → ARMED → TX_ON`, más `LOCKOUT`. Turno exclusivo, latido cada 500 ms, corte a los 2 s sin latido, TOT configurable (por defecto 10 min) y registro de auditoría de cada transmisión. |
| `sdrangel` | Cliente de la API REST de SDRangel: dispositivos, frecuencias, canales SSB/CW en RX y TX, espectro y audio. Las rutas exactas de la API se verifican con el swagger de SDRangel y se anotan en el README del módulo. Va acompañado de un servidor simulado para las pruebas. |
| `beacon` | Localiza el pico de la baliza en el espectro, calcula la deriva en Hz, la filtra (mediana + EMA) y aplica la corrección en RX y TX. Sin baliza, la corrección no se aplica y se avisa. |
| `modes` | Cambio de modo, filtros y frecuencia de trabajo según el plan de banda NB de QO-100. Decodificación FT8/FT4 (el decodificador de SDRangel si lo trae, si no `ft8_lib`) y CW (`ggmorse` o el de SDRangel). |
| `log` | CRUD de contactos, validación, deduplicado, exportación e importación ADIF, subida a LoTW con `tqsl` (el certificado lo gestiona el usuario en TQSL; BricoHams solo invoca el CLI) y a QRZ Logbook (clave cifrada con AES-256-GCM). |
| `webrtc` | Audio RX del servidor al navegador y audio del micrófono del navegador al servidor y a SDRangel TX (Opus, DTLS-SRTP). El micrófono solo se abre con el turno PTT concedido. |
| `web` | PWA: espectro y cascada, sintonía con clic, botón PTT (mantener pulsado y barra espaciadora), formulario de log, estado de la baliza y del turno, ayuda integrada. Accesible (teclado y ARIA). |
| `plugins/openwebrx` | Plugin para OpenWebRX+: marcadores QO-100, ayuda de offset y enlace a la PWA. Solo recepción. |

## 6. Decisiones ya tomadas

- Proyecto único, sin repartirlo en varios (decisión del usuario).
- Usar un motor existente con licencia utilizable y mejorarlo, no reescribirlo: SDRangel (decisión del usuario).
- Google como único proveedor de identidad, multiusuario y un solo operador a la vez (decisión del usuario).
- La escucha pública es un plugin para OpenWebRX (decisión del usuario).
- La versión 1 debe cumplir todos los objetivos (decisión del usuario).
- Node, `node:sqlite`, `node:test` y PWA (decisión de Claude, por coherencia con el repo anterior y por tener pocas dependencias).
- `werift` (MIT) como pila WebRTC en Node, salvo que el ADR correspondiente justifique otra (decisión de Claude).

## 7. Riesgos que hay que verificar (se registran en los ADR)

- **Entrada de audio TX en SDRangel desde la red**: hay que verificar si el modulador SSB acepta audio por UDP o por la API. Si no, la alternativa documentada es un dispositivo de audio de bucle (null-sink de PulseAudio/PipeWire en Linux; en Windows, un dispositivo virtual instalado aparte), aun con la contrapartida de depender de un cable virtual.
- Qué modelos de SDR soporta SDRangel en arm64 (Raspberry Pi).
- Carga de CPU en la Raspberry Pi 4/5 con RX, TX y el decodificador funcionando a la vez.
- Formato exacto de la API de QRZ Logbook (`ACTION=INSERT`) y opciones de línea de comandos de `tqsl` por versión.

## 8. Pruebas

- **Unitarias** (`test/unit/`): una suite por módulo. Como mínimo: todas las transiciones de la máquina PTT, incluidas las del watchdog; auth con un IdP simulado (token válido, caducado, `nonce` incorrecto, email fuera de la lista); estimador de la baliza con espectros sintéticos; ADIF ida y vuelta con los campos SAT; cifrado de claves; cliente de SDRangel contra el simulado.
- **Funcionales** (`test/functional/`): servidor completo con SDRangel e IdP simulados. Casos: inicio de sesión, petición de turno, PTT, pérdida de latido que corta la transmisión, segundo operador rechazado, registro y exportación de un contacto, y corrección de la baliza aplicada.
- **Checklist manual** (`docs/testing/CHECKLIST.md`): pasos con hardware real. Primero solo recepción; después transmisión en carga artificial con medidor de potencia; y solo entonces, con la decisión del titular, radiar.
- CI: `npm test` en Windows, Linux x64 y arm64.

## 9. Documentación obligatoria

- `README.md` (qué es, cómo instalar y cómo contribuir), `NOTICE.md` (licencias de terceros) y `SECURITY.md`.
- `docs/help/` (español): instalación en cada sistema, configuración de Google OAuth (el usuario crea su propio cliente; nunca se incluye ninguno), primera puesta en marcha, operación de SSB/CW/digitales, log y LoTW/QRZ, y resolución de problemas.
- `docs/ARCHITECTURE.md`: módulos, flujos y diagramas Mermaid.
- `docs/adr/NNNN-*.md`: un ADR por decisión (motor SDRangel, GPL, Node, auth Google, máquina PTT, WebRTC, sqlite, método de la baliza, empaquetado y audio TX).
- `docs/DEVELOPER.md`: cómo está organizado el código, cómo añadir un modo o un SDR, cómo depurar y cómo ejecutar las pruebas.
- Comentarios en el código: JSDoc en cada función pública y un comentario que explique el porqué en cada decisión que no sea obvia (sin comentar lo evidente).

## 10. Lo que queda a criterio de quien lo construya

La estructura interna de cada módulo, el diseño visual dentro del estilo BricoHams, los nombres de los endpoints internos, los parámetros del filtro de la baliza (con su justificación en el ADR) y el formato del registro de auditoría.

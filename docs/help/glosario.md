# Glosario

| Término | Significado |
|---|---|
| **QO-100 / Es'hail-2** | Satélite geoestacionario con transpondedores de radioaficionados. |
| **NB (banda estrecha)** | Transpondedor de 500 kHz: subida 2400,000–2400,500 MHz, bajada 10489,500–10490,000 MHz. |
| **Baliza** | Señal BPSK de referencia en 10489,750 MHz, usada para medir la deriva. |
| **LNB / LO** | Conversor de bajada y su oscilador local (típico 9750 MHz). |
| **FI** | Frecuencia intermedia: bajada − LO (la baliza queda en 739,75 MHz con LO 9750 MHz). |
| **Deriva** | Cambio de frecuencia del LNB con la temperatura. |
| **Corrección** | Desplazamiento calculado a partir de la baliza y aplicado al receptor. |
| **SDRangel** | Programa SDR que hace el trabajo de radio. BricoHams lo controla. |
| **SDR** | Radio definida por software. |
| **PTT** | Pulsar para hablar (Push-To-Talk). |
| **Turno** | Derecho exclusivo de transmitir; solo una persona a la vez. |
| **Armed (ARMED)** | Tienes el turno pero aún no transmites. |
| **TX_ON / TX_OFF** | Transmitiendo / sin transmitir. |
| **Heartbeat** | Latido: mensaje cada 500 ms que demuestra que sigues conectado; si falta, se corta la portadora. |
| **Watchdog** | Vigilante que corta la transmisión si falta el latido. |
| **TOT** | Temporizador de transmisión máxima (600 s por defecto). |
| **LOCKOUT** | Bloqueo de seguridad tras un fallo; solo un `owner` local lo quita. |
| **Carga ficticia** | Resistencia 50 Ω que disipa la potencia sin radiar. |
| **Allowlist** | Lista de correos permitidos con indicativo y rol. |
| **Rol** | `listener`, `operator` o `owner`. |
| **OIDC / OAuth** | Sistema de inicio de sesión de Google. |
| **CSRF** | Ataque que fuerza acciones desde otra web; se evita con un token. |
| **TLS / HTTPS / WSS** | Cifrado de las conexiones web. |
| **PWA** | Aplicación web instalable desde el navegador. |
| **ADIF** | Formato estándar de intercambio de libros de guardia. |
| **LoTW / TQSL** | Logbook of The World y su programa de firma y subida. |
| **QRZ** | Servicio de libro de guardia en línea con clave de API. |
| **FT8 / FT4** | Modos digitales de WSJT-X (ranuras de 15 s y 7,5 s). |
| **CW** | Telegrafía (Morse). |
| **SSB / USB** | Banda lateral única / lateral superior. |
| **UTC** | Hora universal; las ranuras digitales se alinean con ella. |
| **OpenWebRX+** | Receptor web SDR público; hay un plugin solo de recepción. |

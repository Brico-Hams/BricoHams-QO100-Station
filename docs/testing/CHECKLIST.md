# Lista de comprobación para probadores

*English: contributors, see [DEVELOPER.md](../DEVELOPER.md).*

Rellena una copia de esta lista y envía el informe con la [plantilla](REPORT-TEMPLATE.md). Marca cada casilla al terminar; en «Resultado / notas» escribe OK, FALLO o N/A y los detalles (versión, mensajes). **No incluyas secretos** (secreto de Google, clave de QRZ, cookies, `config.json` sin limpiar).

Datos del probador: nombre/indicativo ______  Versión ______  Fecha ______  Equipo y SO ______

---

## A. Instalación por sistema operativo

### A1. Windows 10/11 x64

| ✔ | Acción | Resultado esperado | Resultado / notas |
|---|---|---|---|
| [ ] | Descargar el `.exe` y comprobar el SHA-256 con `Get-FileHash` | Coincide con el `.sha256` | |
| [ ] | Ejecutar el instalador | Aviso de SmartScreen (no firmado); se instala y crea acceso directo | |
| [ ] | Abrir la aplicación por primera vez | Se crea `%APPDATA%\BricoHams QO-100 Station\config.json` y se abre la ayuda | |
| [ ] | Crear `secrets.env` con los secretos y reiniciar | La aplicación arranca sin error de configuración | |
| [ ] | Cerrar la ventana y usar *Salir* del icono de bandeja | Cerrar oculta; *Salir* detiene el servidor | |
| [ ] | Abrir una segunda instancia | No se abre otra (bloqueo de instancia única) | |
| [ ] | Comprobar el icono de bandeja | Icono visible (conocido: puede estar vacío) | |
| [ ] | Desinstalar | Se elimina el programa | |

### A2. Linux x86-64

| ✔ | Acción | Resultado esperado | Resultado / notas |
|---|---|---|---|
| [ ] | Ejecutar el AppImage (`chmod +x`) | La ventana se abre | |
| [ ] | Instalar el `.deb` con `apt install ./...` | Instala sin errores; crea usuario `bricohams` | |
| [ ] | Comprobar permisos: `ls -l /etc/bricohams-qo100` | `config.json` 0640 root:bricohams, `env` 0600 | |
| [ ] | `systemctl status bricohams-qo100` tras instalar | Habilitado pero **no** iniciado; TX no activado | |
| [ ] | Rellenar `env` y `config.json`; `systemctl start` | Servicio activo; `curl http://127.0.0.1:PUERTO/api/health` responde `{"ok":true}` | |
| [ ] | Desinstalar con `apt remove` | Se elimina sin dejar el servicio activo | |

### A3. Raspberry Pi 4 (arm64)

| ✔ | Acción | Resultado esperado | Resultado / notas |
|---|---|---|---|
| [ ] | Instalar con la línea de `install.sh` | Descarga, verifica SHA-256 e instala | |
| [ ] | Arrancar el servicio y abrir la web desde otro equipo | Carga la interfaz | |
| [ ] | Con RX y audio activos medir la CPU (`top`) | Anotar % de CPU (a verificar) | |

### A4. Raspberry Pi 5 (arm64)

| ✔ | Acción | Resultado esperado | Resultado / notas |
|---|---|---|---|
| [ ] | Igual que A3 | Igual que A3 | |
| [ ] | Medir CPU con RX y audio | Anotar % de CPU | |

---

## B. Inicio de sesión y roles

| ✔ | Acción | Resultado esperado | Resultado / notas |
|---|---|---|---|
| [ ] | Abrir la URL y pulsar iniciar sesión con un correo de la lista | Entra; el panel muestra indicativo y rol | |
| [ ] | Entrar con un correo que **no** está en la lista | Rechazado (no permitido) | |
| [ ] | Rol `listener`: intentar Arm TX, sintonizar, abrir el Log | No puede; Log y QRZ no aparecen | |
| [ ] | Rol `operator`: sintonizar, abrir el Log | Puede | |
| [ ] | Rol `owner`: lo anterior | Puede | |
| [ ] | Cerrar sesión | Vuelve al inicio; la sesión no sirve | |
| [ ] | Reiniciar el servidor | Se pide volver a entrar | |
| [ ] | Acceder por una dirección distinta de `publicUrl` | Error 421 | |
| [ ] | Con HTTPS válido comprobar el candado y la cabecera HSTS | Conexión segura | |

---

## C. Solo recepción con hardware real (cada SDR de la lista)

Antes de conectar un LNB alimentado por coaxial, completa las [comprobaciones de entrada, FI y bloqueo de DC](../../hardware/antennas/lnb-y-referencias.md#comprobaciones-antes-de-conectar-el-sdr).

Repite por cada SDR disponible (RTL-SDR, SDRplay, Airspy, ADALM-Pluto, USRP B200mini, Hermes Lite 2, otros): modelo ______

| ✔ | Acción | Resultado esperado | Resultado / notas |
|---|---|---|---|
| [ ] | Configurar el conjunto de dispositivos 0 en SDRangel con ese SDR | Recibe | |
| [ ] | Con `tx.enabled: false` pulsar **Listen** | Se oye ruido/señales; sin errores | |
| [ ] | Ver espectro y cascada | Se actualizan (≤10 fps) | |
| [ ] | Sintonizar con clic y teclado | La frecuencia y el audio cambian | |
| [ ] | Comprobar la FI con el LO configurado | La baliza aparece donde se espera | |
| [ ] | Verificar que las rutas REST de SDRangel funcionan (sin `sdrangel_unavailable`) | Sin error | |

---

## D. Enganche de baliza y corrección de deriva

| ✔ | Acción | Resultado esperado | Resultado / notas |
|---|---|---|---|
| [ ] | Esperar con la baliza visible | Estado «locked» en pocos segundos | |
| [ ] | Anotar el desplazamiento mostrado (Hz) | Valor razonable (<±10 kHz) | |
| [ ] | Tapar o desconectar la antena un momento | Pasa a «no-lock» y conserva la última corrección | |
| [ ] | Restaurar la antena | Vuelve a «locked» | |
| [ ] | Calentar o enfriar el LNB (si es posible) | La corrección sigue la deriva | |
| [ ] | Con `audio.enabled: false` | Baliza «no-lock» por falta de fuente | |
| [ ] | Una señal conocida mantiene su frecuencia al variar la deriva | La señal no se mueve en el espectro | |
| [ ] | Referencia externa: abrir en otra pestaña el receptor de EA5EN (`http://ea5urm.dns2go.com:8073`, perfil QO100, FI centrada en 739,800 MHz; HTTP, puede no estar disponible) y comparar la separación entre las balizas de CW (baja/alta) y la BPSK central con la tuya | Misma separación (≈ 250 kHz entre balizas) y la BPSK entre ambas; anota la FI de la baliza en cada receptor. Una diferencia constante de FI es el LO distinto de cada LNB; la diferencia no debe cambiar si cambia la deriva | |
| [ ] | Con la baliza «locked», sintonizar la baliza en ambos receptores | Tras la corrección, tu pantalla muestra 10489,750 MHz; la desviación frente a EA5EN queda dentro de tu margen del LNB (anótala) | |

---

## E. Modos SSB, CW, FT8 y FT4 en recepción

| ✔ | Acción | Resultado esperado | Resultado / notas |
|---|---|---|---|
| [ ] | Modo USB: sintonizar una QSO en SSB | Voz inteligible | |
| [ ] | Modo CW: sintonizar una señal de CW | Tono audible y texto en la lista Decoded (anota la velocidad y los errores) | |
| [ ] | Modo FT8 | Cambia de modo y frecuencia; tras un intervalo de 15 s aparecen decodificaciones (anota SNR y dt frente a otro programa) | |
| [ ] | Modo FT4 | Igual, con intervalos de 7,5 s | |
| [ ] | Comprobar el plan de banda contra el actual de AMSAT-DL/IARU | Anotar diferencias (segmentos y frecuencias por defecto) | |
| [ ] | Comprobar la inversión de banda del transpondedor | Anotar si USB es correcto en subida y bajada | |

---

## F. Registro, ADIF, LoTW y QRZ

| ✔ | Acción | Resultado esperado | Resultado / notas |
|---|---|---|---|
| [ ] | Añadir un contacto SSB | Aparece en la tabla | |
| [ ] | Añadir el mismo (indicativo + modo) en 10 min | Aviso de duplicado | |
| [ ] | Añadir contactos CW, FT8 y FT4 | Informes 599 / dB correctos | |
| [ ] | Frecuencia fuera de rango | Rechazada con mensaje | |
| [ ] | Editar y borrar un contacto propio | Funciona | |
| [ ] | Como otro operador editar un contacto ajeno | Rechazado | |
| [ ] | **Export ADIF** y abrir en otro programa | Campos `BAND=13CM`, `BAND_RX=3CM`, `PROP_MODE=SAT`, `SAT_NAME=QO-100`; FT4 como `MFSK/FT4` | |
| [ ] | Guardar la clave de QRZ en Settings | Estado «A key is stored»; no se puede volver a ver | |
| [ ] | **Upload QRZ** de un contacto | Aparece en el libro de QRZ (prueba con datos reales) | |
| [ ] | Probar con clave incorrecta | Error de autenticación | |
| [ ] | Configurar `logbook.lotw` y subir un contacto con TQSL | Código de salida correcto; se firma y sube | |
| [ ] | Certificado con contraseña | Falla con «cancelled» | |
| [ ] | Sin `BRICOHAMS_SECRETS_KEY` | Guardar la clave de QRZ da 503 | |

---

## ⚠️ AVISO DE SEGURIDAD: SECCIÓN G

> **TRANSMITIR SOLO CON CARGA FICTICIA (50 Ω) Y MEDIDOR DE POTENCIA.**
> **Sin antena conectada. Sin amplificador de potencia, o con el amplificador desconectado de la antena.**
> Ten un corte físico (interruptor o fuente) al alcance de la mano. No sigas si algo no se comporta como se espera.
> Una portadora no deseada en QO-100 interfiere a otros radioaficionados.

Confirma antes de empezar:
- [ ] Carga ficticia conectada a la salida del SDR/transversor.
- [ ] Medidor de potencia conectado y visible.
- [ ] Antena y amplificador desconectados.
- [ ] `tx.enabled` activado solo en la configuración local.

---

## G. TX SOLO CON CARGA FICTICIA

| ✔ | Acción | Resultado esperado | Resultado / notas |
|---|---|---|---|
| [ ] | Con `tx.enabled: false` pulsar Arm TX | Rechazado («tx_disabled»); el medidor no marca | |
| [ ] | Activar `tx.enabled` y reiniciar; Arm TX | Estado ARMED; el medidor sigue en cero | |
| [ ] | Mantener PTT con voz | El medidor marca potencia; el temporizador TOT cuenta | |
| [ ] | Soltar PTT | La potencia cae a cero de inmediato | |
| [ ] | Mantener PTT y **desenchufar la red** (cable/Wi-Fi) del cliente | La portadora se corta en **menos de 2 s** (anota el tiempo) | |
| [ ] | Mantener PTT y cerrar la pestaña | Corte inmediato | |
| [ ] | Mantener PTT y matar el proceso del navegador | Corte en menos de 2 s | |
| [ ] | Dejar PTT pulsado hasta el TOT | Corte automático al llegar a 0 (acorta `totSeconds` para probar) | |
| [ ] | Armar y no transmitir 120 s | El turno se libera | |
| [ ] | Segundo operador pide turno mientras el primero lo tiene | Rechazado («busy») | |
| [ ] | Un `listener` intenta transmitir | Rechazado («forbidden») | |
| [ ] | Cambiar de modo mientras transmite | Rechazado («tx_active») | |
| [ ] | Hablar muy fuerte o gritar al micrófono | El limitador evita saturar; la potencia no supera lo esperado | |
| [ ] | Sin permiso de micrófono | Mensaje claro; no transmite audio | |
| [ ] | Comprobar `audit.log` | Eventos `turn_granted`, `tx_on`, `tx_off` con motivo y duración | |
| [ ] | Detener SDRangel mientras transmites | El sistema pasa a LOCKOUT o corta; anotar | |
| [ ] | En LOCKOUT, un `owner` remoto intenta reset | Rechazado; solo funciona desde la máquina local | |
| [ ] | Parar el TX device: ¿desaparece la portadora en el medidor? | Sí (a verificar) | |
| [ ] | Probar el audio de TX por el canal UDPSource de SDRangel (`audio.txUdp`) | El audio sale limpio (punto de mayor riesgo, a verificar) | |
| [ ] | Probar CW con la carga ficticia | Manipulación correcta (a verificar) | |
| [ ] | Comprobar la frecuencia de subida con el analizador/receptor auxiliar | Coincide con el valor mostrado | |
| [ ] | `applyCorrectionToTx`: probar con y sin referencia compartida | Anotar comportamiento | |

---

## H. Radiar solo tras decisión del titular

Solo el titular de la estación decide pasar a esta sección, con licencia válida y tras completar A–G sin fallos.

| ✔ | Acción | Resultado esperado | Resultado / notas |
|---|---|---|---|
| [ ] | Decisión escrita del titular de radiar (fecha, firma/indicativo) | Registrada | |
| [ ] | Conectar el amplificador y la antena | Potencia mínima | |
| [ ] | Comprobar en el transpondedor que la señal en bajada es inferior a la baliza | Cumple | |
| [ ] | Primer QSO real con un colaborador | Se oye y se registra | |
| [ ] | Probar el corte por pérdida de red de nuevo, ya con antena | Corte en <2 s | |
| [ ] | Mantener un corte físico accesible durante toda la prueba | Sí | |

---

## I. Plugin de OpenWebRX+

| ✔ | Acción | Resultado esperado | Resultado / notas |
|---|---|---|---|
| [ ] | Instalar el plugin (anota las rutas reales de tu versión) | Se carga sin errores en la consola | |
| [ ] | Ver los 9 marcadores | Aparecen | |
| [ ] | Conversor bajada/subida | Valores correctos | |
| [ ] | Enlace a la PWA con `BRICOHAMS_PWA_URL` | Abre la PWA | |
| [ ] | Confirmar que no hay ningún control de TX | Ninguno | |

---

## J. Accesibilidad y PWA móvil

| ✔ | Acción | Resultado esperado | Resultado / notas |
|---|---|---|---|
| [ ] | Navegar solo con teclado | Todo es alcanzable; foco visible | |
| [ ] | Sintonizar con las flechas (y Mayúsculas) | Funciona | |
| [ ] | Lector de pantalla en estado y PTT | Anuncia el estado | |
| [ ] | Tema claro, oscuro y automático | Contraste legible | |
| [ ] | Ampliar el texto al 200 % | No se rompe la disposición | |
| [ ] | Instalar la PWA en Android (Chrome) | Se instala con icono | |
| [ ] | Instalar la PWA en iOS (Safari, Añadir a pantalla de inicio) | Se instala | |
| [ ] | PTT con el dedo en el móvil | Mantener y soltar funcionan (con carga ficticia) | |
| [ ] | Rotar la pantalla y apagar la pantalla durante TX | El PTT se suelta y corta | |
| [ ] | Sin conexión, abrir la PWA | Se muestran los recursos estáticos; no hay control posible | |

---

## K. Funciones avanzadas ([guía](../help/funciones-avanzadas.md))

| ✔ | Acción | Resultado esperado | Resultado / notas |
|---|---|---|---|
| [ ] | Guardar, recuperar y borrar una memoria; probar un nombre repetido | Funciona; el duplicado se rechaza | |
| [ ] | Con otro usuario, comprobar que no ve las memorias privadas; el propietario crea una compartida | Aislamiento correcto; la compartida la ven todos | |
| [ ] | Recuperar una memoria de otro modo con el PTT activo | Error `tx_active`; no cambia nada | |
| [ ] | Ver el plan de bandas sobre el espectro | Segmentos y baliza en su sitio | |
| [ ] | RIT ±: oír que solo cambia la recepción; ver que el TX no se mueve | Correcto | |
| [ ] | XIT y split con carga ficticia: medir la frecuencia de TX | Coincide con la calculada; no cambia durante TX | |
| [ ] | «Mi señal»: comprobar que el desplazamiento mostrado permite oírse | Coincide | |
| [ ] | Cambiar el ancho de filtro en SSB, CW y FT8 | El ancho cambia en SDRangel; se restablece al cambiar de modo | |
| [ ] | AGC y squelch; pedir reducción de ruido | SDRangel refleja AGC y squelch; la reducción de ruido responde `dnr_unavailable` (no disponible) | |
| [ ] | Zoom, promedio, retención de picos, paletas y contraste | Se ven bien; se recuerdan al recargar | |
| [ ] | Probar cada atajo de la tabla; escribir en un campo de texto | No dispara atajos en campos; Espacio sigue siendo solo PTT | |
| [ ] | Intentar transmitir con cualquier tecla que no sea Espacio | No es posible | |
| [ ] | Desactivar los atajos en Ajustes | Dejan de funcionar | |
| [ ] | Grabar audio RX, parar, descargar y abrir el WAV | Se reproduce; cabecera correcta | |
| [ ] | Grabar hasta el límite configurado | Se detiene sola; la descarga es válida | |
| [ ] | El propietario desactiva la grabación; un operador intenta grabar | Error `recording_disabled` | |
| [ ] | Comprobar que otro operador no puede descargar mi grabación | 404 | |
| [ ] | Notch manual sobre una portadora (clic en el espectro) y auto-notch (`k`, `u`) | La portadora baja claramente; el audio a ±1 kHz no se altera (el notch es solo del navegador) | |
| [ ] | Con `iq.enabled`, grabar I/Q, parar, reproducir y volver a directo | Archivo en SDRangel; RX vuelve a sintonizar (verificar claves swagger) | |
| [ ] | Sin `iq.enabled`, intentar grabar I/Q | Error `iq_disabled` | |
| [ ] | Con `cluster.enabled` y un nodo real, esperar spots | Solo aparecen los del NB; un clic sintoniza el RX | |
| [ ] | Calendario `.ics` con URL configurada y subida manual | Próximas actividades listadas; oyente no puede actualizar | |
| [ ] | Exportar memorias (JSON y CSV), importar con vista previa y borrar duplicados | Informe de válidas/duplicadas/inválidas; un oyente no puede importar | |
| [ ] | Activar el plugin de ejemplo `hello-panel` | Panel visible; sin acceso a PTT ni micrófono | |
| [ ] | Webhook a un receptor de prueba | Firma HMAC válida; sin secretos en el contenido | |
| [ ] | Linux: tras instalar el .deb, `rtl_test -t` con el dongle reconectado | Detecta el dongle sin `-6` ni `Permission denied` | |
| [ ] | Linux: `apt purge` | Se eliminan las reglas udev y la lista negra | |
| [ ] | Comprobar los IDs USB de tus SDR (`lsusb`) contra `99-bricohams-sdr.rules` | Coinciden | |
| [ ] | Windows: instalar WinUSB con Zadig en un RTL-SDR | SDRangel lo detecta | |

---

## L. Simulaciones, diagrama y enlaces (no necesitan hardware)

Guía: [comprobar-sin-hardware.md](../help/comprobar-sin-hardware.md). Si el ordenador está ocupado, cierra otros programas antes de las simulaciones.

| ✔ | Acción | Resultado esperado | Resultado / notas |
|---|---|---|---|
| [ ] | `npm test` | Termina con `fail 0` | |
| [ ] | `npm run sim` en un equipo tranquilo (5-10 min). Anota el SO y la CPU | Todos los escenarios pasan; se actualiza `docs/testing/sim-report.md` | |
| [ ] | Si algún caso falla, repetir solo su fichero (`node --test test/sim/<escenario>.sim.test.js`) | Si pasa al repetir, anota que fue intermitente y la carga del equipo; si falla siempre, adjunta la fila ❌ del informe | |
| [ ] | Abrir `docs/testing/sim-report.md` | La tabla *Resumen* tiene ✅ en todas las filas; baliza: error máx. < 50 Hz, enganche < 60 s y reenganche < 30 s; FT8 ≥ 90 % a −15 dB y FT4 ≥ 90 % a −12 dB; CW con CER < 5 % a 20 WPM y 6 dB | |
| [ ] | Comparar con tu hardware real: baliza (sección D) y decodificación (sección E) | Anota si el enganche, el error y el SNR reales son peores que los simulados (las simulaciones no sustituyen a las pruebas reales) | |
| [ ] | `npm run diagram` y abrir `docs/architecture/neural-diagram.svg` | Se regenera sin errores; muestra todos los módulos; sin cambios en el repositorio si el código no cambió (`git status`) | |
| [ ] | Comprobar el diagrama en modo claro y oscuro del sistema | Legible en ambos | |
| [ ] | Revisar que los enlaces de `README.md`, la ayuda y los scripts de instalación apuntan a `https://github.com/Brico-Hams/BricoHams-QO100-Station` (organización **Brico-Hams**, con guion) y `.../BricoHams-QO100-Remote-Listen` | Todos abren sin depender de una redirección; no queda el nombre antiguo `bricohams` | |
| [ ] | `curl -fsSL https://raw.githubusercontent.com/Brico-Hams/BricoHams-QO100-Station/main/packaging/linux/install.sh` (solo leer, sin ejecutar) | Se descarga el script | |

---

Resumen final: ¿se puede considerar la versión lista para su uso? ______ . Envía el [informe](REPORT-TEMPLATE.md).

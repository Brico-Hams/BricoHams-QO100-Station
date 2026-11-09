# Solución de problemas

*English: [DEVELOPER.md](../DEVELOPER.md#debugging-common-failures).*

| Síntoma | Causa probable y qué hacer |
|---|---|
| El programa no arranca y habla de configuración | Falta `GOOGLE_CLIENT_SECRET`, hay `clientSecret` dentro de `config.json` (prohibido), `host` no local sin TLS, o `publicUrl` no coincide con el esquema. Lee el mensaje: nombra la clave. |
| Google: `redirect_uri_mismatch` | El URI autorizado en Google debe ser exactamente `publicUrl` + `/auth/callback`. |
| «not allowed» al entrar | Tu correo no está en `allowlist` o no está verificado en Google. |
| Error 421 | La dirección usada no coincide con `publicUrl` (o el proxy no pasa `Host`). |
| Sesión se cierra / error 403 en WebSocket | El `Origin` debe ser el de `publicUrl`; vuelve a iniciar sesión. |
| «sdrangel_unavailable» (502) | SDRangel apagado o URL incorrecta (`sdrangel.baseUrl`). Si el mensaje dice `http`, SDRangel respondió con error: revisa su versión frente a la definición de API copiada en el repositorio ([DEVELOPER.md](../DEVELOPER.md)). |
| No hay audio de recepción | Activa `audio.enabled`, comprueba que nada más usa el puerto `audio.rxUdp` (9998 por defecto) y pulsa **Listen** (el navegador exige un gesto). BricoHams crea solo el canal UDPSink de SDRangel; si SDRangel arrancó después, cambia de modo para que se cree de nuevo. |
| No hay espectro ni baliza («no_source») | `audio.enabled` falso o `audio.spectrumUrl` inalcanzable. BricoHams pide a SDRangel que active el servidor de espectro; si no lo consigue, actívalo a mano. Alternativa: `beacon.engine: "sdrangel-freqtracker"`, que no usa el espectro (ver [funciones-avanzadas.md](funciones-avanzadas.md#motor-de-baliza)). |
| La baliza no engancha («low_snr») | Mala puntería, LO incorrecto (`station.lnbLoHz`) o la baliza fuera de ±10 kHz. |
| Se oye pero no sale audio de TX | Comprueba que `audio.txUdp` (9999 por defecto) coincide con el puerto del canal UDPSource de SDRangel (lo crea BricoHams) y que nada más lo usa. Solo se envía audio con el PTT en `TX_ON`. Aún no se ha probado con una instancia real. |
| «tx_disabled» | `tx.enabled` es falso. Actívalo en local. |
| «busy» | Otro operador tiene el turno. |
| «forbidden» | Tu rol es `listener`. |
| «audit_failed» | No se puede escribir `auditLogPath`. Revisa permisos. |
| Estado LOCKOUT | Un fallo al apagar o confirmar la portadora. Revisa SDRangel y el amplificador, luego un `owner` desbloquea con el código de `ptt-reset-code` (ver [acceso-remoto.md](acceso-remoto.md)). |
| No puedo cambiar de modo | Mientras TX_ON el cambio se rechaza («tx_active»). |
| QRZ: no se puede guardar la clave (503) | Falta `BRICOHAMS_SECRETS_KEY`. |
| LoTW «cancelled» | TQSL pidió contraseña de certificado; usa uno sin contraseña. |
| LoTW «not configured» | Falta `logbook.lotw`. |
| El micrófono no funciona | Hace falta HTTPS o `localhost` y dar permiso al navegador. |
| Linux: el servicio no arranca | `journalctl -u bricohams-qo100 -e`. Comprueba permisos de `/etc/bricohams-qo100/` y que `env` tiene los secretos. |
| Windows: SmartScreen | El instalador no está firmado; verifica el SHA-256. |

Si sigue sin funcionar, rellena la [plantilla de informe](../testing/REPORT-TEMPLATE.md) **sin incluir secretos**.

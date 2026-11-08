# Acceso remoto

*English: [SECURITY.md](../../SECURITY.md).*

Para usar la estación desde internet necesitas **HTTPS**, un nombre de dominio y los usuarios en la lista de permitidos. Sin TLS el programa solo acepta escuchar en `127.0.0.1`.

## Opción A: TLS en BricoHams

```json
"host": "0.0.0.0",
"port": 8443,
"publicUrl": "https://qo100.ejemplo.org:8443",
"tls": { "certPath": "/etc/letsencrypt/live/qo100.ejemplo.org/fullchain.pem",
         "keyPath":  "/etc/letsencrypt/live/qo100.ejemplo.org/privkey.pem" }
```
El servicio debe poder leer esos ficheros. Se usa TLS 1.2 o superior. Reinicia tras renovar el certificado.

## Opción B: proxy inverso (Caddy, nginx)

BricoHams escucha en local y el proxy da el HTTPS. Reglas clave:

- `publicUrl` debe ser la dirección **externa** (`https://...`). Si BricoHams escucha sin TLS en `127.0.0.1`, `publicUrl` tendrá que ser `http://localhost:puerto`, así que para un proxy lo más sencillo es la opción A, o activar TLS interno también.
- El proxy debe pasar el encabezado `Host` original y permitir WebSocket (`/ws/control`).
- Desbloquear un LOCKOUT necesita sesión `owner` **y** un código de un solo uso que el servidor escribe en un fichero local (ver abajo), así que un proxy en la misma máquina no lo debilita; no hace falta bloquear `POST /api/ptt/reset`.

## Dominio y puertos

Crea un registro DNS hacia tu IP (o un DNS dinámico), abre en el router solo el puerto HTTPS elegido y **nunca** expongas 8091, 8887, 9998 ni 9999 (SDRangel).

## Usuarios y roles

`allowlist` en `config.json` (reinicia para aplicar cambios):

| Rol | Puede |
|---|---|
| `listener` | escuchar, ver espectro |
| `operator` | además sintonizar, cambiar de modo, tomar el turno de TX, usar el registro |
| `owner` | todo, y desbloquear (LOCKOUT) con el código local de un solo uso |

## Desbloquear un LOCKOUT

Al entrar en LOCKOUT el servidor escribe un código de 8 cifras en `ptt-reset-code` (junto al `audit.log`, o en `resetCodePath`). Léelo en la máquina (`node src/server/cli.js reset-lockout --show`), inicia sesión como `owner` e introdúcelo en la aplicación (o `POST /api/ptt/reset` con `{"code":"12345678"}`). Sirve una vez y cambia en cada LOCKOUT.

## Turnos

Solo una persona transmite a la vez: quien pulsa **Arm TX** y obtiene el turno. Los demás ven quién lo tiene («busy»). Se libera al pulsar **Disarm**, al cerrar la pestaña, al perder conexión (corte en menos de 2 s) o por inactividad (120 s armado, 600 s de TOT transmitiendo).

## Recomendaciones

- Verificación en dos pasos en las cuentas de Google.
- Revisa el `audit.log` (JSON, una línea por evento).
- Reinicia el servicio tras cambiar la lista; cerrará todas las sesiones.
- Mantén TX desactivado (`tx.enabled: false`) cuando no estés presente.

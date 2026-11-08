# Configurar el acceso con Google

*English: [ADR 0004](../adr/0004-google-oidc-allowlist-roles.md).*

BricoHams no guarda contraseñas: los usuarios entran con su cuenta de Google. Necesitas crear **tu propio cliente OAuth** (es gratis). Ningún cliente viene incluido.

## 1. Crear el cliente en Google Cloud

1. Entra en <https://console.cloud.google.com/> con tu cuenta de Google.
2. Crea un proyecto (menú superior → *Proyecto nuevo*), por ejemplo «BricoHams QO-100».
3. Ve a **APIs y servicios → Pantalla de consentimiento de OAuth**. Tipo de usuario: *Externo*. Pon el nombre de la aplicación y tu correo. Alcances: `openid` y `email` bastan. En modo *Pruebas* añade como **usuarios de prueba** a los correos que vayan a entrar (o publica la aplicación).
4. Ve a **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**.
5. Tipo de aplicación: **Aplicación web**.
6. En **URI de redireccionamiento autorizados** añade exactamente:
   ```
   <publicUrl>/auth/callback
   ```
   Ejemplos: `https://qo100.ejemplo.org/auth/callback` o, para pruebas locales, `http://localhost:8443/auth/callback`. Debe coincidir carácter a carácter con `publicUrl` de tu configuración.
7. Pulsa *Crear*. Copia el **ID de cliente** y el **secreto de cliente**.

## 2. Poner los datos en BricoHams

En `config.json` (no es secreto):
```json
"publicUrl": "https://qo100.ejemplo.org",
"google": { "clientId": "1234-abc.apps.googleusercontent.com" },
"allowlist": [
  { "email": "tu@gmail.com", "callsign": "EA4XYZ", "role": "owner" },
  { "email": "amigo@gmail.com", "callsign": "EA4ABC", "role": "operator" }
]
```
Roles: `listener` (solo escucha), `operator` (sintoniza, transmite, registra), `owner` (todo, y desbloquea el sistema desde la máquina local). Debe haber al menos un `owner`.

El **secreto** va solo en el archivo de entorno, nunca en `config.json` (el programa se negará a arrancar si lo pones ahí):

| Instalación | Dónde |
|---|---|
| Windows / AppImage | `secrets.env` en la carpeta de datos |
| .deb | `/etc/bricohams-qo100/env` |
| Desde código | variable de entorno `GOOGLE_CLIENT_SECRET` |

```
GOOGLE_CLIENT_SECRET=el-secreto-copiado
```

## 3. Reglas de oro

- **Nunca compartas el secreto**: ni en capturas, ni en chats, ni en GitHub, ni en informes de errores.
- Si se filtra, en la consola de Google genera uno nuevo y borra el antiguo.
- Pide a tus usuarios activar la verificación en dos pasos en Google.
- Los cambios en la lista de permitidos se aplican al reiniciar el servicio.
- Solo entran correos **verificados** por Google y presentes en la lista.

Si ves `redirect_uri_mismatch`, revisa el punto 6. Más en [solucion-de-problemas.md](solucion-de-problemas.md).

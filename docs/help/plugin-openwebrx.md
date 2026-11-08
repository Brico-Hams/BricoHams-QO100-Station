# Plugin de OpenWebRX+ (solo recepción)

*English: [ADR 0010](../adr/0010-openwebrx-plugin-rx-only.md), [plugins/openwebrx/README.md](../../plugins/openwebrx/README.md).*

Si ya tienes un receptor público OpenWebRX+, este plugin añade:

- 9 marcadores de QO-100 (baliza, segmentos y frecuencias típicas),
- un conversor bajada ↔ subida,
- el plan de banda,
- un enlace opcional a tu PWA de BricoHams (para operar hay que iniciar sesión allí).

**No puede transmitir**: no hace llamadas de red, no accede al micrófono y no contiene código de PTT ni de registro.

## Instalación

Los nombres de ruta exactos dependen de tu versión de OpenWebRX+ (sin verificar). En general:

1. Copia `plugins/openwebrx/bricohams.js` a la carpeta de plugins del receptor de tu OpenWebRX+.
2. Añade el contenido de `plugins/openwebrx/init.js` al `init.js` de plugins del receptor (una línea tipo `Plugins.load('bricohams');`).
3. Para el enlace a la PWA, define antes `window.BRICOHAMS_PWA_URL = "https://qo100.ejemplo.org";`.
4. Recarga la página del receptor.

## Licencia

El plugin es GPL-3.0-or-later; OpenWebRX+ es AGPL-3.0. El conjunto queda sujeto a la cláusula de red de la AGPL (ofrecer el código a los usuarios).

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

## Receptor público conocido: EA5EN (Churra-Murcia)

Mateo EA5EN mantiene un receptor OpenWebRX+ de **solo escucha** con perfil QO100:

| Dato | Valor |
|---|---|
| Nombre | EA5EN Churra-Murcia (OpenWebRX+) |
| Origen | `http://ea5urm.dns2go.com:8073` |
| Centro de FI | 739,800 MHz (1 MS/s) |

Es **HTTP sin TLS**: si lo incrustas en una página HTTPS el navegador lo bloquea (contenido mixto), así que ábrelo siempre en una **pestaña nueva**. Úsalo como referencia independiente para comparar la baliza (ver [checklist](../testing/CHECKLIST.md), sección D). Más información en [docs/references/ea5en](../references/ea5en/README.md). Agradecimiento a Mateo EA5EN.

## Licencia

El plugin es GPL-3.0-or-later; OpenWebRX+ es AGPL-3.0. El conjunto queda sujeto a la cláusula de red de la AGPL (ofrecer el código a los usuarios).

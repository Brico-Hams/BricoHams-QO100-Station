# Referencias de EA5EN (Mateo): curso QO-100 y receptor OpenWebRX+

## Quién es EA5EN

Mateo, radioaficionado con indicativo **EA5EN**, es el autor del *Curso Iniciación QO-100* (presentación de 50 diapositivas, preparada para el Radioclub Región de Murcia, EA5RCZ) y quien mantiene un receptor público OpenWebRX+ de QO-100 en la zona de Churra (Murcia). No se publica ningún dato de contacto ni coordenadas exactas.

## Qué se ha integrado y dónde

| Qué | Dónde |
|---|---|
| Resumen propio de los contenidos técnicos del curso (datos del satélite, cálculo del oscilador local del LNB, apuntado, cadenas RX/TX, GPSDO) | [docs/help/qo100-fundamentos.md](../../help/qo100-fundamentos.md) |
| Equipos y programas citados en el curso y su equivalencia en BricoHams | [docs/help/equipos-y-programas.md](../../help/equipos-y-programas.md) |
| Receptor de EA5EN como receptor público de solo escucha | [docs/help/plugin-openwebrx.md](../../help/plugin-openwebrx.md) y [plugins/openwebrx/README.md](../../../plugins/openwebrx/README.md) |
| Comprobación externa de FI y baliza contra ese receptor | [docs/testing/CHECKLIST.md](../../testing/CHECKLIST.md), sección D |
| Agradecimientos | [NOTICE.md](../../../NOTICE.md) y [README.md](../../../README.md) |

Los ficheros de esta carpeta son material de trabajo interno:

- `qo100-course-extract.txt`: texto extraído del curso.
- `image-pages.md`: descripción de las diapositivas que son solo imágenes.
- `receiver-status.json`: estado público del receptor.

## Qué NO está en el repositorio

El PDF original del curso es obra de un tercero con derechos de autor y **no se distribuye** aquí. Los documentos de BricoHams lo **resumen con palabras propias** y citan, como mucho, fragmentos breves. Si necesitas el original, pídeselo a su autor o al radioclub.

## El receptor público

| Dato | Valor |
|---|---|
| Nombre | EA5EN Churra-Murcia (OpenWebRX+) |
| Dirección | `http://ea5urm.dns2go.com:8073` (HTTP, sin TLS) |
| Receptor | SDRplay, versión de OpenWebRX+ v1.2.117, hasta 9 clientes |
| Perfil QO100 | centro **739,800 MHz** (FI), 1 MS/s, es decir unos 739,3 a 740,3 MHz |
| Enlace de ejemplo | `http://ea5urm.dns2go.com:8073/#freq=740100000,mod=usb,sql=-150` |

Es un recurso de **solo recepción** y ajeno a BricoHams: el servicio es voluntario de su propietario, puede no estar disponible y no se debe sobrecargar. Al ser HTTP, el navegador **bloquea** su contenido si se incrusta en una página HTTPS (contenido mixto); por eso solo se enlaza para abrirlo en una pestaña nueva, nunca en un `iframe`. Ten en cuenta que la FI que muestra depende del LNB y del oscilador de su estación (ver [discrepancias](../../help/qo100-fundamentos.md#frecuencias-de-referencia-y-discrepancias-con-el-curso)).

## Agradecimiento

**Agradecimiento a Mateo EA5EN** por compartir su curso de iniciación a QO-100 y por mantener abierto su receptor OpenWebRX+, que sirve a la comunidad como referencia independiente de frecuencia y de recepción.

El propio curso agradece a su vez al Radioclub Región de Murcia (EA5RCZ), a Simon Brown (G4ELI, SDR Console) y a AMSAT-DL, AMSAT-EA y QARS.

## Cómo citar

Usa siempre esta fórmula, con la diapositiva cuando sea posible:

> Fuente: Curso Iniciación QO-100, EA5EN Mateo (diapositiva N).

- Resume con tus palabras; cita como mucho frases muy cortas.
- No copies tablas ni diapositivas completas ni las imágenes.
- No añadas correos, teléfonos ni coordenadas exactas de nadie.
- Si una cifra del curso difiere del código o del diseño, anótalo en la sección de discrepancias de [qo100-fundamentos.md](../../help/qo100-fundamentos.md) en lugar de cambiar el código sin más.

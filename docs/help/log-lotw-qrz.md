# Registro (log), LoTW y QRZ

*English: [src/log/README.md](../../src/log/README.md).*

Disponible para `operator` y `owner`. Pestaña **Log**.

## Registrar un contacto

Rellena indicativo, modo (SSB, CW, FT8, FT4), frecuencias, informes y, si quieres, locator y nombre. Reglas:

- Frecuencia de subida entre 2400,000 y 2400,500 MHz; de bajada entre 10489,500 y 10490,000 MHz.
- Informe por defecto: 59 en SSB y 599 en CW; en FT8/FT4 un valor en dB.
- Si repites el mismo indicativo y modo en menos de 10 minutos te avisa de duplicado y puedes confirmar.
- Cada contacto lleva automáticamente `BAND=13CM`, `BAND_RX=3CM`, `PROP_MODE=SAT`, `SAT_NAME=QO-100`, y tu indicativo según la lista de permitidos.
- Puedes editar o borrar tus propios contactos (el `owner` cualquiera).

## Exportar

**Export ADIF** descarga todo el registro en formato ADIF 3.1.4, importable en otros programas.

## LoTW

1. Instala **TQSL** y configura en él tu certificado y una **ubicación de estación** (*Station Location*) para QO-100. Usa un certificado **sin contraseña** si quieres subir sin intervención (con contraseña TQSL pide la clave y la subida falla con «cancelled»).
2. En `config.json`:
   ```json
   "logbook": { "lotw": { "tqslPath": "C:\\Program Files (x86)\\TrustedQSL\\tqsl.exe", "stationLocation": "QO-100 EA4XYZ" } }
   ```
   (en Linux: `/usr/bin/tqsl`). El nombre de la ubicación no puede empezar por `-`.
3. Marca los contactos y pulsa **Upload LoTW** (hasta 100 a la vez). BricoHams nunca toca tus certificados.

Si no está configurado, la subida responde «not configured».

## QRZ

1. En QRZ.com obtén la **clave de API** de tu libro de guardia (necesita suscripción XML/Logbook).
2. Para guardarla, el servidor debe tener `BRICOHAMS_SECRETS_KEY` definida. Entra en **Settings**, pega la clave y guarda. Se cifra (AES-256-GCM), es por usuario y **nunca se vuelve a mostrar**.
3. Marca los contactos y pulsa **Upload QRZ**. Verás cuántos se insertaron, duplicados o fallos.
4. Si pierdes `BRICOHAMS_SECRETS_KEY`, las claves guardadas no se recuperan: vuelve a introducirlas.

Los formatos exactos de la API de QRZ y las opciones de TQSL dependen de versiones: están sin verificar.

## Copia de seguridad

Copia el archivo del registro (`logbook.path`, por defecto `./data/logbook.db`, en `.deb` `/var/lib/bricohams-qo100/`).

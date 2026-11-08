# Instalación en Windows

*English: [README](../../README.md#quick-start).*

Requisitos: Windows 10/11 de 64 bits, [SDRangel](https://github.com/f4exb/sdrangel) instalado, un SDR compatible y una cuenta de Google.

## Pasos

1. Descarga desde la [última versión](https://github.com/BricoHams/BricoHams-QO100-Station/releases/latest) el instalador `.exe` y su archivo `.sha256`.
2. Comprueba la huella. En PowerShell:
   ```powershell
   Get-FileHash .\BricoHams-QO100-Station-Setup.exe -Algorithm SHA256
   ```
   El resultado debe coincidir con el contenido del `.sha256` (el nombre real del archivo puede variar).
3. Ejecuta el instalador. **Windows SmartScreen avisará** porque el instalador no está firmado: elige *Más información* y *Ejecutar de todas formas* solo si la huella coincide.
4. Se crea un acceso directo en el escritorio. Al abrir el programa por primera vez se copia una configuración de ejemplo y se abre esta ayuda.
5. Edita la configuración en `%APPDATA%\BricoHams QO-100 Station\config.json` (ver [configurar-google.md](configurar-google.md) y [primera-puesta-en-marcha.md](primera-puesta-en-marcha.md)).
6. Crea junto a ella el archivo `secrets.env` con tus secretos (una línea `CLAVE=valor` cada una):
   ```
   GOOGLE_CLIENT_SECRET=tu-secreto
   BRICOHAMS_SECRETS_KEY=clave-de-32-bytes-en-base64
   ```
   No compartas este archivo. Para generar la clave: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (necesita Node) o cualquier generador de 32 bytes aleatorios en base64.
7. Cierra del todo (icono de la bandeja, *Salir*) y vuelve a abrir.

## Controladores del SDR

- **RTL-SDR:** el controlador de Windows hay que cambiarlo a **WinUSB** con [Zadig](https://zadig.akeo.ie): conecta el dongle, abre Zadig, *Options → List All Devices*, elige **Bulk-In, Interface (Interface 0)** (no la interfaz 1 de la antena TV), selecciona **WinUSB** y pulsa *Replace Driver*. Haz esto solo con el dongle correcto, o romperás otros dispositivos USB.
- **SDRplay:** instala antes el **SDRplay API** del fabricante (https://www.sdrplay.com/api/) y reinicia; SDRangel lo necesita para detectar los RSP (verificar la versión compatible con tu SDRangel).
- **Airspy, HackRF, Pluto:** usa los controladores indicados por el fabricante o por SDRangel.

## Notas

- La ventana al cerrarse queda en la bandeja. *Salir* detiene el servidor y corta cualquier transmisión.
- En modo escritorio el programa escucha solo en `localhost`. Para acceso desde internet usa el modo servidor ([acceso-remoto.md](acceso-remoto.md)).
- Puedes definir los secretos también como variables de entorno de usuario.
- Para desinstalar usa *Aplicaciones y características*. Tus datos (registro, auditoría) quedan en la carpeta de datos del usuario.
- El icono de la bandeja puede aparecer vacío en esta versión (pendiente de verificar).

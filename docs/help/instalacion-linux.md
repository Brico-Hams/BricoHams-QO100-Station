# Instalación en Linux

*English: [README](../../README.md#quick-start).*

Hay dos formas: **AppImage** (escritorio) o **paquete .deb** (servidor/headless, Debian, Ubuntu, Raspberry Pi OS). Arquitecturas: x86-64 y arm64.

## AppImage (escritorio)

```bash
chmod +x BricoHams-QO100-Station-*.AppImage
./BricoHams-QO100-Station-*.AppImage
```
Comprueba antes la huella: `sha256sum -c archivo.sha256`. La configuración está en la carpeta de datos del usuario (normalmente `~/.config/BricoHams QO-100 Station/`, a verificar), con `config.json` y `secrets.env`.

## Paquete .deb (servicio)

```bash
sha256sum -c bricohams-qo100_*_amd64.deb.sha256
sudo apt install ./bricohams-qo100_*_amd64.deb
```
El paquete trae su propio Node.js. Se instala en `/opt/bricohams-qo100`, crea el usuario del sistema `bricohams` y activa el servicio **sin arrancarlo** y **sin activar la transmisión**.

Archivos importantes:

| Ruta | Contenido |
|---|---|
| `/etc/bricohams-qo100/config.json` | configuración (sin secretos) |
| `/etc/bricohams-qo100/env` | secretos, permisos 0600 |
| `/var/lib/bricohams-qo100/` | registro y auditoría |

Pasos:

1. Edita la configuración: `sudo nano /etc/bricohams-qo100/config.json`.
2. Pon los secretos: `sudo nano /etc/bricohams-qo100/env`:
   ```
   GOOGLE_CLIENT_SECRET=tu-secreto
   BRICOHAMS_SECRETS_KEY=clave-base64-de-32-bytes
   ```
3. Arranca: `sudo systemctl start bricohams-qo100` y mira el estado: `systemctl status bricohams-qo100`; registros: `journalctl -u bricohams-qo100 -f`.

Instala también SDRangel (`sdrangelsrv` si no hay pantalla) y, opcionalmente, `tqsl` para LoTW.

## Acceso al SDR por USB (udev y módulos del kernel)

El paquete .deb instala dos archivos, que se **eliminan al purgar** (`sudo apt purge bricohams-qo100`):

| Archivo | Para qué |
|---|---|
| `/lib/udev/rules.d/99-bricohams-sdr.rules` | da al grupo `bricohams` acceso a RTL-SDR (0bda:2838 y 0bda:2832), Airspy, SDRplay, HackRF y ADALM-Pluto |
| `/etc/modprobe.d/blacklist-bricohams-rtl.conf` | impide que el kernel cargue `dvb_usb_rtl28xxu`, `rtl2832` y `rtl2830`, que ocupan el RTL-SDR |

El `postinst` añade al usuario `bricohams` a los grupos `plugdev` y `dialout` si existen y recarga udev. **Desconecta y vuelve a conectar el dongle** (o reinicia una vez) para que surtan efecto. La lista negra afecta a todo el equipo: si usas el mismo dongle para TDT, borra ese archivo.

Comprueba el dispositivo (paquete `rtl-sdr`):

```bash
lsusb | grep -i -E "0bda:28(38|32)"
rtl_test -t
```
Si `rtl_test` dice `usb_claim_interface error -6`, el módulo DVB sigue cargado: `lsmod | grep rtl28xxu`, descárgalo con `sudo modprobe -r dvb_usb_rtl28xxu` o reinicia. Si dice `Permission denied`, revisa los grupos (`id bricohams`).

**Consejo de calibración (PPM):** los dongles RTL-SDR baratos tienen un error típico de decenas de ppm. Mide el error con `rtl_test -p` (déjalo varios minutos) y úsalo como corrección, o deja que la **baliza** corrija la deriva (la estación ya lo hace en QO-100, ver [primera-puesta-en-marcha.md](primera-puesta-en-marcha.md)). Los identificadores USB de SDRplay y otros modelos deben comprobarse con `lsusb` (verificar).

Para acceso por internet con HTTPS ve a [acceso-remoto.md](acceso-remoto.md). Siguiente paso: [configurar-google.md](configurar-google.md).

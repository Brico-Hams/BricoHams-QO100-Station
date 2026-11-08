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

Para acceso por internet con HTTPS ve a [acceso-remoto.md](acceso-remoto.md). Siguiente paso: [configurar-google.md](configurar-google.md).

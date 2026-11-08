# Instalación en Raspberry Pi

*English: [README](../../README.md#quick-start).*

Funciona en Raspberry Pi 4 y 5 con **sistema operativo de 64 bits** (arm64), Raspberry Pi OS o Debian/Ubuntu. El rendimiento (CPU con SDRangel y audio) y la compatibilidad de cada SDR en arm64 **deben comprobarse** en tu equipo.

## Instalación con una línea

```bash
curl -fsSL https://raw.githubusercontent.com/BricoHams/BricoHams-QO100-Station/main/packaging/linux/install.sh | sudo bash
```

El script detecta la arquitectura, descarga el último `.deb`, verifica su SHA-256 e instala con `apt`. Si prefieres revisarlo antes, descárgalo y léelo (`less install.sh`). Si usas un fork, define `BRICOHAMS_REPO=propietario/repositorio`.

Después sigue los pasos de [instalacion-linux.md](instalacion-linux.md#paquete-deb-servicio): edita `/etc/bricohams-qo100/config.json` y `/etc/bricohams-qo100/env`, y arranca con `sudo systemctl start bricohams-qo100`.

## Consejos

- Instala SDRangel para arm64 (o ejecútalo en otro PC y apunta `sdrangel.baseUrl` a él **solo dentro de una red de confianza**; su API no tiene autenticación).
- Usa una fuente de alimentación buena y refrigeración: SDRangel y el audio cargan la CPU.
- Con un SDR por USB comprueba que el usuario del servicio puede acceder al dispositivo (reglas udev).
- Escucha primero solo en recepción ([primera-puesta-en-marcha.md](primera-puesta-en-marcha.md)).

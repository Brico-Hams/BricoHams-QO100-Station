# Plantilla de informe de pruebas

*Copia este archivo, rellénalo y envíalo como incidencia de GitHub o a los mantenedores. **No incluyas secretos** (secreto de Google, `BRICOHAMS_SECRETS_KEY`, claves de QRZ, cookies, `secrets.env`, `config.json` sin limpiar).*

## 1. Datos generales

| Campo | Valor |
|---|---|
| Probador (nombre / indicativo) | |
| Fecha y hora (UTC) | |
| Versión de BricoHams (`package.json` o nombre del instalador) | |
| Tipo de instalación (Windows .exe / AppImage / .deb / Pi / desde código) | |
| Sistema operativo y versión | |
| Equipo (CPU, RAM; Pi 4 / Pi 5) | |
| Versión de SDRangel | |
| Versión de Node.js (solo desde código) | |
| Navegador y versión | |

## 2. Hardware

| Elemento | Modelo / notas |
|---|---|
| SDR de recepción | |
| SDR de transmisión | |
| LNB y LO configurado (`station.lnbLoHz`) | |
| Antena / parábola | |
| Amplificador | |
| Carga ficticia y medidor de potencia (para sección G) | |
| Referencia de reloj compartida (sí/no) | |

## 3. Secciones realizadas

| Sección | Hecha (sí/no) | Resultado (OK / FALLO / parcial) | Notas |
|---|---|---|---|
| A Instalación | | | |
| B Sesión y roles | | | |
| C Recepción | | | |
| D Baliza | | | |
| E Modos | | | |
| F Registro / LoTW / QRZ | | | |
| G TX con carga ficticia | | | |
| H Radiación (solo titular) | | | |
| I Plugin OpenWebRX+ | | | |
| J Accesibilidad / PWA | | | |

## 4. Medidas importantes

| Medida | Valor |
|---|---|
| Tiempo de corte de portadora al perder la red (s) | |
| Desplazamiento de baliza (Hz) | |
| Tiempo hasta «locked» (s) | |
| Uso de CPU en Pi con RX + audio (%) | |
| Latencia de audio percibida (ms aprox.) | |

## 5. Fallos encontrados

Un bloque por fallo:

- **Título:**
- **Elemento de la lista (por ejemplo G-5):**
- **Pasos para reproducir:**
- **Resultado esperado:**
- **Resultado obtenido:**
- **Gravedad:** crítica (portadora no controlada, fuga de secretos) / alta / media / baja
- **Registros relevantes** (sin secretos; pega las líneas de `journalctl` o de `audit.log`):
- **Capturas:**

## 6. Puntos «sin verificar» confirmados o corregidos

| Punto | Confirmado / diferente | Detalle (ruta real, formato real, versión) |
|---|---|---|
| Rutas REST y claves de ajustes de SDRangel | | |
| Entrada de audio UDP del modulador SSB | | |
| Formato del WebSocket de espectro | | |
| Plan de banda y frecuencias por defecto FT8/FT4 | | |
| Opciones de línea de comandos de TQSL | | |
| Respuesta de la API de QRZ | | |
| Rutas de instalación del plugin de OpenWebRX+ | | |
| `node:sqlite` en Electron 45 | | |

## 7. Conclusión

- ¿Hubo alguna transmisión no deseada? **sí / no**
- Recomendación (apto / no apto / apto con reservas):
- Comentarios:

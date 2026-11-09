<p align="center"><a href="https://bricohams.org"><img src="../../branding/bricohams_horizontal.png" alt="BricoHams" width="280"></a></p>

# Ayuda de BricoHams QO-100 Station

**BricoHams** · Radioafición · Hazlo tú mismo · <https://bricohams.org> · Anatol EA5KAO, Diego EA5JEF, Pedro Roca Molina

*English: see the [README](../../README.md). Manual de SDR: [docs/manual/es](../manual/es/README.md).*

BricoHams te permite operar tu estación del satélite QO-100 (transpondedor de banda estrecha) desde un navegador, de forma segura, usando SDRangel como motor de radio.

> **Estado honesto:** el control de SDRangel, el audio y los decodificadores (FT8, FT4 y CW, integrados en JavaScript) se han probado con simulaciones y contra la definición oficial de la API de SDRangel, pero **no con una estación real**. Puedes comprobar mucho sin hardware: [comprobar-sin-hardware.md](comprobar-sin-hardware.md). Ayúdanos a probar con la [lista de comprobación](../testing/CHECKLIST.md).

## Por dónde empezar

0. Si empiezas de cero con QO-100: [fundamentos](qo100-fundamentos.md) (satélite, LNB, apuntado, cadenas RX/TX) y [equipos y programas](equipos-y-programas.md). ¿Quieres construir tu estación (piezas 3D, antenas, lista de compra)? [construir-tu-estacion.md](construir-tu-estacion.md).
1. Instala el programa: [Windows](instalacion-windows.md), [Linux](instalacion-linux.md) o [Raspberry Pi](instalacion-raspberry-pi.md).
2. Crea tu cliente de acceso con Google: [configurar-google.md](configurar-google.md).
3. Configura SDRangel y la estación: [primera-puesta-en-marcha.md](primera-puesta-en-marcha.md).
4. Opera: [SSB](operar-ssb.md), [CW](operar-cw.md), [modos digitales](operar-digitales.md). Herramientas extra (memorias, RIT/XIT, filtros, grabación, atajos) y ajustes de audio UDP y motor de baliza: [funciones-avanzadas.md](funciones-avanzadas.md).
5. Libro de guardia: [log, LoTW y QRZ](log-lotw-qrz.md).
6. Acceso desde internet: [acceso-remoto.md](acceso-remoto.md).
7. Escucha pública: [plugin-openwebrx.md](plugin-openwebrx.md).
8. Si algo falla: [solucion-de-problemas.md](solucion-de-problemas.md). Términos: [glosario.md](glosario.md).

## Seguridad en una frase

La transmisión está **desactivada por defecto**. Pruébala siempre primero con una **carga ficticia** y asegúrate de tener un corte físico del amplificador. Eres el responsable de la estación y de tu licencia.

## Para pruebas y desarrollo

[Comprobar sin hardware](comprobar-sin-hardware.md) · [Lista de pruebas](../testing/CHECKLIST.md) · [Informe de simulaciones](../testing/sim-report.md) · [Plantilla de informe](../testing/REPORT-TEMPLATE.md) · [Seguridad](../../SECURITY.md) (en inglés)

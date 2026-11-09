<p align="center"><a href="https://bricohams.org"><img src="../../branding/bricohams_horizontal.png" alt="BricoHams" width="280"></a></p>

# Comprobar la estación sin hardware

**BricoHams** · Radioafición · Hazlo tú mismo · <https://bricohams.org> · Anatol EA5KAO, Diego EA5JEF, Pedro Roca Molina

*English: see [test/sim/README.md](../../test/sim/README.md) and [ADR 0023](../adr/0023-simulation-framework.md).*

¿Quieres saber si el programa funciona antes de montar la parabólica, el LNB y el SDR? Puedes comprobar buena parte de la lógica **solo con tu ordenador**: sin antena, sin transmisor y sin SDRangel real. Sirve para detectar errores del software; **no sustituye** a probar con tu equipo (la [lista de comprobación](../testing/CHECKLIST.md) sigue siendo la prueba final).

Necesitas el código fuente y Node.js 24 o superior (ver [README](../../README.md#from-source)): `git clone https://github.com/Brico-Hams/BricoHams-QO100-Station.git`, entrar en la carpeta y ejecutar `npm ci` una vez.

## 1. Pruebas rápidas: `npm test`

```bash
npm test
```

Tarda unos minutos. Comprueba el inicio de sesión, el PTT, el registro, la API de SDRangel y una simulación rápida. Al final debe decir que **todas las pruebas pasan** y mostrar `fail 0`. Si algo falla, copia el mensaje en la [plantilla de informe](../testing/REPORT-TEMPLATE.md) (sin secretos).

Estas pruebas usan un **SDRangel simulado** (un «doble» que vive dentro del programa). Es estricto: rechaza cualquier ajuste que el SDRangel real no tenga, de modo que un error de nombre o de tipo se descubre sin radio. No transmite nada y solo escucha en tu propio equipo.

## 2. Simulaciones completas: `npm run sim`

```bash
npm run sim
```

Ejecuta escenarios con señales sintéticas y **repetibles** (siempre salen igual con la misma semilla). Tardan entre 5 y 10 minutos; usa un ordenador que no esté ocupado con otras cosas. Qué comprueban, en lenguaje llano:

| Escenario | Qué se simula | Qué debe cumplirse |
|---|---|---|
| Baliza y deriva del LNB | El LNB se calienta y la frecuencia se mueve unos kHz durante 2 horas; la baliza desaparece 10 s | Se engancha en menos de 60 s, el error de corrección queda por debajo de 50 Hz y se reengancha en menos de 30 s |
| FT8 / FT4 | Señales con ruido cada vez más fuerte | FT8 se decodifica al menos el 90 % de las veces con −15 dB y FT4 con −12 dB |
| CW | Señal con desvanecimientos (QSB) y ruido | Menos del 5 % de letras erróneas a 20 WPM con 6 dB de señal/ruido |
| PTT | 1000 sesiones aleatorias con pérdida de paquetes y desconexiones | La portadora nunca sigue activa más de 0,1 s después del tiempo máximo sin señal de vida (*heartbeat*) |
| Turnos | 5 operadores pidiendo a la vez el turno | Nunca transmiten dos a la vez |
| Clúster DX y QSO completo | Un clúster falso y un contacto de principio a fin con SDRangel estricto | Sin errores de validación y sin audio de TX fuera de la transmisión |

Mientras corre verás líneas `ok` o `not ok` por cada caso.

## 3. Leer el informe

Al terminar se escribe (o se actualiza) **`docs/testing/sim-report.md`**. Ábrelo en GitHub o en cualquier editor:

- La tabla **Resumen** indica ✅ pasa o ❌ falla por escenario, con el número de casos y la duración.
- Después hay una tabla por escenario: errores de la baliza en Hz, tasa de decodificación según el SNR, errores de CW según la velocidad, tiempos de corte del PTT…
- Si no tienes tiempo para todo, `node test/sim/report.js` vuelve a generar el informe con los últimos resultados (solo si son de hace menos de 6 horas).

No edites el informe a mano: se genera solo.

## Si falla algún caso

1. Las simulaciones son sensibles al **tiempo**: si el ordenador estaba muy cargado (compilando, vídeo, otros programas) un caso lento puede agotar su tiempo límite aunque el programa esté bien. Se observó así el 2026-11-09: tres fallos que desaparecieron al repetir.
2. Cierra otros programas y repite solo el fichero que falló, por ejemplo: `node --test test/sim/beacon.sim.test.js`.
3. Para una comprobación más corta de la baliza: PowerShell `$env:SIM_BEACON_SECONDS=1800; npm run sim` (Linux: `SIM_BEACON_SECONDS=1800 npm run sim`).
4. Si el fallo se repite con el ordenador tranquilo, es un error real: abre una incidencia en <https://github.com/Brico-Hams/BricoHams-QO100-Station/issues> con el texto de la fila ❌ del informe.

## Qué no demuestran

Las simulaciones usan ruido blanco, un único LNB ideal y señales perfectas. No conocen tu antena, tu LNB, tus interferencias ni la carga de tu Raspberry Pi. Tampoco prueban el SDRangel real ni el audio de verdad. Tras comprobar todo esto aquí, pasa a la [primera puesta en marcha](primera-puesta-en-marcha.md) y a la [lista de comprobación](../testing/CHECKLIST.md) (siempre con **carga ficticia** antes de transmitir).

---
bricohams.org · Anatol EA5KAO, Diego EA5JEF, Pedro Roca Molina

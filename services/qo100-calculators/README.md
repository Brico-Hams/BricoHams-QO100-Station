# BricoHams QO-100 Calculators

Plugin de WordPress (GPL-3.0-or-later) con calculadoras para QO-100 (Es'hail-2, 25,8° E). Es independiente del servidor de la estación: no importa nada de `src/`, no hace llamadas de red y funciona sin conexión. No tiene opciones de administración ni usa la base de datos; al desinstalarlo no deja nada.

## Instalación

1. Genera el zip (`bricohams-qo100-calculators.zip`, lo crea el workflow de release) o comprime la carpeta `qo100-calculators`.
2. WordPress: Plugins > Añadir nuevo > Subir plugin > elige el zip > Activar.
3. Pon un shortcode en una página. Los scripts y estilos solo se cargan en las páginas que lo usan.

## Shortcodes

| Shortcode | Calculadora |
|---|---|
| `[qo100_dish]` | Ganancia y ancho de haz de la parabólica |
| `[qo100_pointing]` | Azimut, elevación, skew, azimut magnético |
| `[qo100_lnb]` | Línea LNB y balance de enlace |
| `[qo100_helix]` | Hélice RHCP de 2,4 GHz |
| `[qo100_ifcalc]` | LO / IF del LNB y deriva |
| `[qo100_calculators]` | Todas |

Prueba local: sirve esta carpeta por HTTP y abre `demo.html` (los módulos ES no funcionan desde `file://`). Las matemáticas están en `assets/qo100-math.js` (funciones puras, con JSDoc); la interfaz en `assets/qo100-calc.js`. Textos en español, traducibles con `__()` mediante el atributo `data-i18n`.

## Fórmulas

Constantes: c = 299 792 458 m/s, radio terrestre Re = 6378,137 km, radio de la órbita geoestacionaria Rs = 42 164 km, k = -228,6 dBW/K/Hz.

1. **Parabólica.** λ = c/f; G = η·(πD/λ)²; en dBi 10·log10(G). Ancho de haz a -3 dB ≈ 70·λ/D grados. Ejemplos: 60 cm a 10,49 GHz y η = 0,55 → 33,8 dBi; a 2,4 GHz → 21,0 dBi.
2. **Apuntado.** Con Δλ = lon_sat - lon_estación y la latitud φ (Tierra esférica): cos γ = cos φ · cos Δλ; elevación = atan((cos γ - Re/Rs)/sin γ); azimut verdadero = atan2(sin Δλ, -sin φ · cos Δλ) normalizado a 0-360°; skew = atan(sin Δλ / tan φ); azimut magnético = verdadero - declinación (E positiva). Para un plato offset, inclinación a ajustar = elevación - ángulo de offset. Distancia = √(Re² + Rs² - 2·Re·Rs·cos γ).
3. **Línea LNB (Friis).** F = F1 + (F2-1)/G1 + (F3-1)/(G1·G2) + …; una pérdida pasiva L dB es una etapa con NF = L y ganancia = -L. Te = 290·(F-1); Tsys = Tantena + Te; G/T = G_plato - 10·log10(Tsys); C/N0 = EIRP - FSPL - L_atm + G/T + 228,6; SNR = C/N0 - 10·log10(B); FSPL = 20·log10(4πd/λ). El EIRP por defecto es un valor orientativo: **verifica el EIRP vigente**.
4. **Hélice (Kraus, modo axial).** C = λ, paso S = 0,25·λ, G = 15·(C/λ)²·n·S/λ, HPBW = 52/((C/λ)·√(n·S/λ)), Z ≈ 140·C/λ Ω (≈ 140 Ω), relación axial ≈ (2n+1)/2n, plano de masa de 0,75 λ como mínimo (≈ 1 λ recomendado). Adaptación a 50 Ω con una tira λ/4 de √(140·50) ≈ 84 Ω. A 2,4 GHz la circunferencia es 124,9 mm.
5. **LO / IF.** IF = RF - LO. LO típicos: 9750 MHz, 9739 MHz, PLL (referencia de 25 MHz × 390 = 9750 MHz) o personalizado. Subida = bajada - 8089,5 MHz. Deriva: LO real = RF_baliza - IF_medida; deriva = LO real - LO nominal (Hz y ppm). Baliza central 10489,750 MHz (IF 739,750 MHz con LO 9750).

## Referencias

Solo se han tomado las fórmulas; el código es propio y no copia texto ni interfaz de las webs.

- rftools.io, calculadora de antena parabólica: <https://rftools.io/es/calculators/antenna/parabolic-dish-antenna/>
- eshail.batc.org.uk/point: <https://eshail.batc.org.uk/point/>
- dishpointer.com: <https://www.dishpointer.com/es/>
- pabr.org, LNB lineup: <https://www.pabr.org/radio/lnblineup/lnblineup.en.html>
- eshail.batc.org.uk/nb (plan de banda NB): <https://eshail.batc.org.uk/nb/>
- J. D. Kraus, *Antennas* (hélice de modo axial).
- Curso Iniciación QO-100, EA5EN Mateo.

## Limitaciones

- Tierra esférica y órbita circular ideal; errores de décimas de grado.
- La geolocalización del navegador solo se pide al pulsar el botón y requiere HTTPS. La declinación magnética la introduce el usuario.
- El signo del skew depende de la convención (dirección de giro vista desde detrás del plato); comprueba con el dibujo de tu LNB.
- El balance de enlace usa un EIRP editable que hay que contrastar con el valor vigente; no incluye pérdidas por puntería, lluvia ni ruido solar.
- Las estimaciones de la hélice son aproximadas (6-12 vueltas); ajusta con medidas de ROE.

## Pruebas

`npm test` en la raíz del repositorio ejecuta `test/unit/qo100-calculators.test.js` (matemáticas, coherencia de cadenas, escaneo estático del PHP).

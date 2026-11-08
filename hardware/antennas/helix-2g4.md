# Helix de 2,4 GHz (RHCP) para el uplink de QO-100

Antena helicoidal de modo axial (Kraus) para transmitir a 2400,25 MHz. Es el feed TX más fácil de construir en casa con las piezas de `../3d/` ([helix_former.scad](../3d/scad/helix_former.scad) y [helix_reflector_cup.scad](../3d/scad/helix_reflector_cup.scad)). Las fórmulas son las de `services/qo100-calculators/assets/qo100-math.js` (`helix()`), así que coinciden con la calculadora de BricoHams.

## Fórmulas (derivación)

- λ = c / f = 299 792 458 / 2 400 250 000 = **124,9 mm**.
- Circunferencia de la hélice (hilo, eje del hilo): C = λ, es decir diámetro D = C/π = **39,8 mm**.
- Paso: S = 0,25 λ = **31,2 mm** (ángulo de paso ≈ 14°).
- Longitud axial: L = n·S. Hilo por vuelta: √(C² + S²) = 128,7 mm.
- Ganancia: G = 15·(C/λ)²·n·S/λ = 3,75·n (lineal) → 10·log₁₀(3,75·n) dBi.
- Ancho de haz a −3 dB: HPBW = 52 / ((C/λ)·√(n·S/λ)) grados.
- Impedancia aproximada en la base: Z ≈ 140·C/λ = 140 Ω; relación axial ≈ (2n+1)/2n.
- Plano de masa: mínimo 0,75 λ (93,7 mm), recomendado ≈ 1 λ (124,9 mm).

## Dimensiones para 4, 5 y 6 vueltas

| Vueltas | Longitud activa | Hilo total (sin colas) | Ganancia teórica | HPBW | Relación axial |
|---|---|---|---|---|---|
| 4 | 124,9 mm | ≈ 515 mm | 11,8 dBi | ≈ 52° | 1,125 |
| **5** (por defecto) | 156,1 mm | ≈ 644 mm | 12,7 dBi | ≈ 46° | 1,10 |
| 6 | 187,4 mm | ≈ 772 mm | 13,5 dBi | ≈ 43° | 1,083 |

Son valores teóricos de la fórmula de Kraus; la ganancia real depende de la construcción (mide con el medidor de potencia y la baliza). Más vueltas dan más ganancia pero un haz más estrecho, que en un plato ilumina peor sus bordes: con un plato offset, 5 vueltas suelen ser un buen compromiso (**verificar** en tu plato).

## Hilo y soporte

- Hilo de cobre desnudo o esmaltado de **2,0-2,5 mm** (el modelo usa 2,2 mm y una ranura con 0,2 mm de holgura). La ranura deja el eje del hilo en el diámetro calculado de 39,8 mm.
- El tubo se imprime en PETG/ASA, nunca con fibra de carbono ni carga metálica (ver cabecera de los `.scad`).
- Plano de masa: la copa impresa debe forrarse con cinta de cobre o aluminio continua y unirse eléctricamente al cuerpo del conector N.

## Adaptación a 50 Ω (tira de adaptación)

Con Z ≈ 140 Ω y un coaxial de 50 Ω se adapta con una tira de cobre que actúa de transformador de impedancia de √(140·50) ≈ **84 Ω** sobre la primera vuelta (cinta de cobre pegada al tubo junto al plano de masa). Su anchura y su separación del plano de masa dependen del dieléctrico y no se fijan aquí: empieza con una tira corta, ajusta con un analizador de antenas/NanoVNA hasta ROE < 1,5 en 2400,0-2400,5 MHz y apunta las medidas. **Verificar** con tu montaje.

## Comprobación del sentido (RHCP)

- Visto desde la base mirando hacia el extremo libre (en el sentido en que radia), un helix **de arrollamiento a derechas** (el hilo avanza como un tornillo normal) radia RHCP.
- Un reflector (el plato) **invierte** el sentido de giro. El uplink de QO-100 es RHCP en el satélite, así que un helix usado como feed de plato debe ser de arrollamiento **a izquierdas** (valor por defecto `hand = -1` en `helix_former.scad`). Confirma con la bibliografía de la lista de referencias y, si puedes, con una medida de polarización cruzada (los feeds de sentido opuesto se atenúan 15-25 dB). **Esto debe verificarse antes de radiar.**

## Posición en el plato offset

- El feed va en el foco del plato, apuntando al centro del reflector (en un offset, inclinado hacia arriba respecto del eje geométrico). La distancia focal sale de los datos del fabricante (f/D típica 0,5-0,7); si no la tienes, mídela con una regla desde el centro del plato hasta donde se cruzan los rayos (ver [dish.md](dish.md)).
- Hay que colocar el centro de fase de la helix (aproximadamente hacia el centro de su longitud) en el foco, y el LNB de 10 GHz a su lado en la misma región (ver arrangement `lnb_mode = 1` en la copa).
- Ajusta la posición axial con la baliza y comprobando que ambos feeds ven el plato.

## Ganancia total esperada

Ganancia del plato a 2,4 GHz con η = 0,55: 21,0 dBi (60 cm), 23,5 dBi (80 cm), 24,5 dBi (90 cm), 27,0 dBi (120 cm). El helix ilumina el plato pero la eficiencia real de iluminación con helix suele ser menor; **verifica con una medida**. Detalles en [dish.md](dish.md).

## Referencias

- Curso Iniciación QO-100, EA5EN Mateo: diapositivas 29 (PA/EDUP) y 45-47 (sistemas completos y cajas), resumidas en [docs/references/ea5en/](../../docs/references/ea5en/README.md).
- Kraus, J. D., *Antennas* (fórmulas del helix de modo axial).
- Wiki del BATC sobre QO-100 y documentación de AMSAT-DL sobre los feeds de 2,4 GHz: consulta los enlaces de `docs/references/ea5en/urls.txt` (p. ej. `eshail.batc.org.uk`).

# Platos offset para QO-100

Ganancia por la fórmula G = η·(π·D/λ)² con η = 0,55 (como en el BOM de estudio y en `dishGain()` de `qo100-math.js`) y ancho de haz ≈ 70·λ/D. λ(10,489 GHz) = 28,6 mm; λ(2,4 GHz) = 124,9 mm.

| Diámetro | G a 10,489 GHz | HPBW 10,489 GHz | G a 2,4 GHz | HPBW 2,4 GHz |
|---|---|---|---|---|
| 60 cm | 33,8 dBi | 3,3° | 21,0 dBi | 14,6° |
| 80 cm | 36,3 dBi | 2,5° | 23,5 dBi | 10,9° |
| 90 cm | 37,3 dBi | 2,2° | 24,5 dBi | 9,7° |
| 120 cm | 39,8 dBi | 1,7° | 27,0 dBi | 7,3° |

El curso EA5EN recomienda como mínimo 80 cm y más de 1 m para señales débiles (diapositiva 40). La eficiencia real varía con el plato y el feed: trata estas cifras como teóricas.

## Foco y ubicación del feed

- Un plato offset es un trozo de paraboloide: el foco no está en el centro de la superficie. El brazo lo sitúa en el foco; el feed apunta al centro del reflector.
- Con el feed del LNB, el borde frontal del plato mira casi vertical: ángulo del montaje = elevación − ángulo offset (típico 26,6°; **comprueba el dato de tu plato**). Usa el [plugin de calculadoras](../../services/qo100-calculators/README.md) para elevación, acimut y skew.
- Para el feed de 2,4 GHz y el LNB de 10 GHz en el mismo brazo, usa la copa con `lnb_mode = 1` ([helix_reflector_cup.scad](../3d/scad/helix_reflector_cup.scad)): ambos deben quedar en el foco; desplaza uno unos centímetros compensando con el skew y mide con la baliza.
- Calibres de apuntado: [dish_angle_gauge.scad](../3d/scad/dish_angle_gauge.scad) y [lnb_clamp_40mm.scad](../3d/scad/lnb_clamp_40mm.scad).
- Distancia focal: toma f/D del fabricante; en un offset normalmente 0,5-0,7.

## Referencias

- Curso EA5EN, diapositivas 10 (calculadora de plato, ver URL en `docs/references/ea5en/urls.txt`) y 40.
- Pointing de la comunidad: `eshail.batc.org.uk/point` y DishPointer (`urls.txt`).

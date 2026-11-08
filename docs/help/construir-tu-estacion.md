# Construye tu propia estación QO-100

Guía paso a paso, desde cero hasta estar en el aire. Todo lo técnico está en [hardware/](../../hardware/): piezas 3D ([README](../../hardware/3d/README.md)), antenas ([helix](../../hardware/antennas/helix-2g4.md), [POTY](../../hardware/antennas/poty-patch.md), [LNB](../../hardware/antennas/lnb-y-referencias.md), [plato](../../hardware/antennas/dish.md)) y la comparativa de precios ([comparison.md](../../hardware/bom/comparison.md), tabla en [components.csv](../../hardware/bom/components.csv)).

## Seguridad primero

- A 2,4 GHz hay exposición a radiofrecuencia cerca del feed: **nunca te sitúes delante del feed mientras se transmite** y mantén las personas y los animales fuera del haz.
- Prueba siempre el TX en **carga artificial** y con un medidor de potencia antes de conectar la antena. Fusible en la alimentación del PA.
- Eres responsable de tu licencia y de la potencia emitida.

## 1. Elige un escalón

| Escalón | Para quién | Kit |
|---|---|---|
| Económico | Empezar escuchando con poco gasto | RTL-SDR + LNB Bullseye + plato 80 cm |
| Equilibrado | Estación estable con TX | SDRplay/Airspy + Pluto original + PA lineal |
| Alt. HL2 | Ya tienes HF y quieres QO-100 | Hermes Lite 2 + transverter SQ5NRY |
| Avanzado | Máxima estabilidad y full-duplex | USRP B200mini + GPSDO + plato 120 cm |

Detalle y totales en [comparison.md](../../hardware/bom/comparison.md). Los precios son orientativos: **verifícalos antes de comprar**.

## 2. Lista de compra

Consulta [components.csv](../../hardware/bom/components.csv) por categoría y escalón. Avisos: usa un Pluto original, evita PA chinos no lineales, comprueba que tu LNB cubre 10,489 GHz y **nunca conectes la FI del LNB a la entrada de HF de un SDR**.

## 3. Imprime las piezas

Imprime en PETG o ASA, nunca con fibra de carbono ni filamento metálico cerca del feed. Parámetros y orden en [hardware/3d/README.md](../../hardware/3d/README.md). Los STL se generan con OpenSCAD.

## 4. Construye el helix y el feed

Sigue [helix-2g4.md](../../hardware/antennas/helix-2g4.md): hilo de cobre en la ranura, copa forrada de cinta de cobre, adaptación a 50 Ω y comprobación del sentido de giro (RHCP). Si prefieres un feed dual-band: [poty-patch.md](../../hardware/antennas/poty-patch.md).

## 5. Monta el plato y el LNB

Usa el plugin de calculadoras ([README](../../services/qo100-calculators/README.md)) para elevación, acimut y skew, con tu latitud/longitud. Ajusta con el calibre `dish_angle_gauge` y la abrazadera `lnb_clamp_40mm`. Más teoría en [fundamentos](qo100-fundamentos.md).

## 6. Primero, recepción

Conecta LNB → inyector de 13/18 V → SDR. Localiza la baliza de 10 489,750 MHz (FI ≈ 739,75 MHz con LO 9750) y deja que BricoHams corrija la deriva. Configura el programa con [primera-puesta-en-marcha.md](primera-puesta-en-marcha.md).

## 7. TX en carga artificial

Con la transmisión desactivada por defecto: conecta Pluto → atenuador → filtro → PA → **carga artificial** y mide la potencia con un medidor. Ajusta la excitación para que el PA trabaje lineal. Consulta la [lista de comprobación](../testing/CHECKLIST.md).

## 8. En el aire

Con la decisión del titular y la zona del feed despejada, conecta el feed, comprueba tu señal en el receptor y opera ([SSB](operar-ssb.md), [CW](operar-cw.md), [digitales](operar-digitales.md)).

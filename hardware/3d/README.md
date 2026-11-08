# Piezas imprimibles en 3D

Modelos paramétricos en OpenSCAD (2021.01 o posterior, sin bibliotecas). Todas las medidas están en milímetros y, donde procede, se derivan de la frecuencia (λ a 2400,25 MHz = 124,9 mm). Licencia: GPL-3.0-or-later.

> **Regla de oro de RF:** nunca imprimas piezas cercanas al feed o al PA con filamento de fibra de carbono ni con carga metálica: son conductores o con pérdidas a 2,4 y 10 GHz. Usa PETG o ASA (ASA/PETG para exterior por los rayos UV). Mide tu equipo antes de imprimir: las cotas por defecto son nominales.

## Piezas

| Archivo (`scad/`) | Para qué sirve | Material y ajustes | Parámetros que conviene cambiar |
|---|---|---|---|
| `helix_former.scad` | Tubo con ranura helicoidal a derechas para el hilo de cobre del helix RHCP de 2,4 GHz | PETG/ASA, 4 perímetros, 25 % relleno, sin soportes, en vertical | `turns` (4/5/6), `wire_d`, `part` (segmento) |
| `helix_reflector_cup.scad` | Copa/plano de masa del helix con agujero para conector N hembra (D de 16 mm) y 4 taladros M4 | PETG/ASA, 4 perímetros, 30 %, sin soportes; **forrar de cinta de cobre/aluminio** | `cup_d_lambda` (0,8-1,1), `n_flat`, `lnb_mode` |
| `lnb_clamp_40mm.scad` | Abrazadera del cuello de 40 mm del LNB con escala de skew ±45° cada 5° y placa índice | PETG/ASA, 4 perímetros, 40 %, sin soportes, brida abajo | `lnb_d`, `clr`, `part` |
| `patch_feed_spacers.scad` | Separadores M3 para un feed dual-band tipo POTY (3,0 y 5,0 mm) | PETG/ASA, 100 % relleno, capas de 0,1-0,2 mm | `heights`, `qty_each`, `od` |
| `dish_angle_gauge.scad` | Transportador con plomada: elevación (con offset del plato, 26,6° por defecto) y skew | PETG/ASA, 3 perímetros, 30 %, plano | `offset_deg`, `target_elev_deg`, `part` |
| `pluto_bracket.scad` | Soporte del ADALM-Pluto (≈117×79×24 mm, **mide tu unidad**) para caja estanca, con alivio de tensión | PETG/ASA, 4 perímetros, 30 %, sin soportes | `case_l`, `case_w`, `case_h`, `mount_d` |
| `pa_fan_duct.scad` | Conducto de ventilador de 80 mm (taladros a 71,5 mm) hacia el disipador del PA | ASA preferible (PA caliente), 3 perímetros, 20 % | `hs_w`, `hs_h`, `duct_len` |
| `sma_biast_enclosure.scad` | Cajita para bias-T/DC-block casero con dos SMA/F y entrada de DC | PETG/ASA, 4 perímetros, 30 % | `board_l`, `board_w`, `conn_d` |

Fotos del montaje: _(marcador: añade aquí tus fotos en `hardware/3d/photos/` cuando las tengas)_.

## Orden de montaje

1. `dish_angle_gauge` y `lnb_clamp_40mm`: se imprimen primero porque sirven para apuntar el plato.
2. `helix_reflector_cup` y `helix_former`: fija el tubo a la copa con 3 tornillos M3 (circunferencia de 26,5 mm), enrolla el hilo de cobre en la ranura, suelda al conector N (ver `../antennas/helix-2g4.md`).
3. `patch_feed_spacers` si construyes un feed POTY.
4. Caja exterior: `pluto_bracket`, `pa_fan_duct` y `sma_biast_enclosure`.

## Cómo regenerar los STL

Los STL de `stl/` se generan a partir de los `.scad` (no se editan a mano). Desde `hardware/3d/`:

```
openscad -o stl/helix_former.stl scad/helix_former.scad
```

Para elegir parámetros sin editar el fichero: `openscad -D "turns=6" -D "part=1" -o stl/helix_6t_seg1.stl scad/helix_former.scad`.

Si el helix necesita varios segmentos (`seg_max`), usa `part=1`, `part=2`… para imprimirlos por separado.

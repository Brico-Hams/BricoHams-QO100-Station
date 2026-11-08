# Marca BricoHams en PCB y piezas impresas

## Identidad documental y visual

Marca publica: **BricoHams**; sitio: <https://bricohams.org>.
Autores: Anatol EA5KAO, Diego EA5JEF y Pedro Roca Molina.
El logo original se conserva sin alterar en
[bricohams_horizontal.png](../branding/bricohams_horizontal.png).
No sustituir marcas de fabricantes ni presentar el producto como
respaldado por Raspberry Pi, Lime u otros proveedores.

Las [guias de montaje](assembly/README.md) conservan sus vistas CAD/PCB.
El [catalogo de componentes](assembly/components/README.md) usa azul
`#12263f`, naranja `#e8871e`, gris `#5b6b7b` y fondo claro, siguiendo la
paleta existente de figuras. Cada SVG contiene titulo accesible,
procedencia BOM/fila, cantidad, especificacion, autores y aviso de
prototipo. El pictograma no es una representacion geometrica del producto.
El logo se enlaza al PNG original para evitar cientos de copias binarias;
el nombre BricoHams tambien aparece como texto, incluso si el visor no
admite imagenes enlazadas dentro de SVG.

Regeneracion: `node scripts/component-catalog.cjs`; comprobacion exacta:
`node scripts/component-catalog.cjs --check`.
No editar las fichas generadas: corregir la BOM y regenerar.
No tapar polaridad, warnings, escala, medidas ni licencias con la marca.
No anadir relieves en engranajes, asientos o superficies funcionales.

## Marca fisica existente

Fuente: `branding/bricohams_horizontal.png` (logo BH + "bricohams"). Se vectoriza con
`scripts/make_logo_assets.py` a polígonos monocolor (`branding/bricohams_polys.json`) y al
módulo OpenSCAD `cad/bricohams_logo.scad` (generado; no editar a mano). El eslogan y los
puntos se omiten (detalles < 0,3 mm).

## PCB (serigrafía superior, `F.SilkS`)
`scripts/add_logo_pcb.py` rasteriza los Gerber, busca el hueco más despejado (lejos de pads/aperturas
de máscara, taladros, serigrafía existente y borde) y añade el logo como regiones Gerber
(G36/G37, LPD/LPC) **y** como triángulos `gr_poly` en el `.kicad_pcb` para que un nuevo trazado de KiCad lo conserve.

| Placa | Posición (mm, coords. Gerber) | Tamaño | Holgura al elemento más cercano |
| --- | --- | --- | --- |
| PortableSatCarrier (ESP32) | X 102,5 / Y −126,2 | 40 × 12,2 | 8,3 mm |
| cm5-guard-A | X 243,5 / Y −239,7 | 50 × 15,3 | 21,9 mm |

Se actualizaron los SHA-256 (`fabrication/release-status.json`, `hardware/cm5/reports/manifest-sha256.json`)
y el ZIP de Gerbers del carrier. **Límites:** KiCad no estaba disponible, por lo que **no se repitieron ERC/DRC ni se
regeneraron los Gerbers desde KiCad**; los Gerbers se parchearon directamente y se comprobaron releyéndolos con
gerbonara. La serigrafía no altera cobre, pero el fabricante debe revisar la vista previa. Las placas
siguen sin autorización de fabricación (ver VALIDATION.md).

## Piezas impresas (relieve de 0,6 mm)
Tapas `enclosure_lid`, `diplexor_lid`, cuna `radio_cradle` (pared trasera, cara exterior) y tapa del `carrier`.
Solapamiento de 0,05 mm para que ninguna isla quede flotando; mallas estancas verificadas con trimesh.
No se tocaron los engranajes ni piezas estructurales.

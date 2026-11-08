# hardware

Build-your-own-station package: parametric OpenSCAD parts, antenna notes and an equipment catalogue with prices and quality comparison. No runtime code; it is covered by `test/unit/hardware.test.js`.

## Contents

| Path | What |
|---|---|
| `3d/scad/*.scad` | Eight parametric parts (GPL-3.0-or-later). `3d/stl/` is generated with `openscad -o stl/<name>.stl scad/<name>.scad`. |
| `3d/README.md` | Part table, print settings, assembly order (Spanish). |
| `antennas/` | Helix 2.4 GHz, POTY patch, LNB and reference, dish notes (Spanish). |
| `bom/components.csv` | One row per component option; `bom/comparison.md` compares them (Spanish). |

## Invariants

- Every `.scad` starts with a header holding `Purpose:`, `Print settings:`, `RF note:` and `Licence:` (GPL-3.0-or-later), uses no external libraries and works with OpenSCAD 2021.01+.
- No carbon-fibre or metal-filled filament near the feed (RF note in every header).
- `components.csv`: fixed columns, `price_min_eur <= price_max_eur`, and any row with a price has `price_date` and `price_source`. Prices come only from dated sources; USD is converted at the stated rate and marked *convertido*; otherwise leave empty and `verified=no`.

## Testing

`node --test test/unit/hardware.test.js` (or `npm test`). Rendering the SCAD files needs OpenSCAD and is not part of the tests.

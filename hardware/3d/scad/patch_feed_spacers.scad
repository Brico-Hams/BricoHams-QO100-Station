// =============================================================================
// patch_feed_spacers.scad  -  Standoffs for a dual-band patch (POTY-style) feed
// Purpose:        Set of round spacers with M3 holes to stack the boards/plates of
//                 a dual-band patch feed (2.4 GHz TX + 10 GHz RX) with exact air
//                 gaps. Default heights 3.0 and 5.0 mm, 4 pieces of each.
//                 Take the real gaps from the design you build (see
//                 hardware/antennas/poty-patch.md); the defaults are placeholders.
// Print settings: PETG or ASA (outdoor / UV). 3 perimeters, 100 % infill,
//                 0.1-0.2 mm layers, NO supports. Print flat, as laid out.
//                 Printed height tolerance is about +-0.1 mm: measure and sand.
// RF note:        The spacers sit in the patch near field. NEVER use carbon-fibre
//                 or metal-filled filament (conductive/lossy at 2.4 / 10 GHz).
//                 Plastic adds a little dielectric loading: re-tune on the
//                 antenna analyser or against the beacon if possible.
//                 Prefer nylon screws over steel inside the patch area.
// Licence:        GPL-3.0-or-later (CERN-OHL-S-2.0 optional for the hardware design).
// Units:          millimetres.
// =============================================================================

heights  = [3.0, 5.0];  // spacer heights, one row per entry
qty_each = 4;           // pieces per height
od       = 7;           // outer diameter
hole_d   = 3.2;         // M3 clearance
chamfer  = 0.4;         // first-layer elephant-foot relief
gap      = 3;           // layout gap

$fn = 64;

module spacer(h) {
    difference() {
        union() {
            translate([0, 0, chamfer]) cylinder(d = od, h = h - chamfer);
            cylinder(d1 = od - 2 * chamfer, d2 = od, h = chamfer);
        }
        translate([0, 0, -1]) cylinder(d = hole_d, h = h + 2, $fn = 32);
    }
}

for (i = [0 : len(heights) - 1])
    for (j = [0 : qty_each - 1])
        translate([j * (od + gap), i * (od + gap), 0]) spacer(heights[i]);

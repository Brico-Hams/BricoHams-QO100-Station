// =============================================================================
// lnb_clamp_40mm.scad  -  40 mm LNB collar clamp with skew scale
// Purpose:        Split ring that clamps the 40 mm neck of an LNB on the arm of an
//                 offset dish. The front flange carries a skew scale engraved every
//                 5 degrees (+-45, labels every 15) and a separate index plate gives
//                 the fixed index mark. Skew is the rotation of the LNB about the
//                 boresight (see pointing().skewDeg in qo100-math.js).
//                 Scale sign: seen from the engraved face, positive = clockwise.
// Print settings: PETG or ASA (outdoor / UV). 4 perimeters, 40 % infill,
//                 0.2 mm layers, NO supports. Print flange down, scale face up.
//                 part = 0 clamp, part = 1 index plate, part = 2 both.
// RF note:        The clamp sits right behind the horn: NEVER use carbon-fibre or
//                 metal-filled filament (lossy at 10.489 GHz and 2.4 GHz). Keep the
//                 plastic out of the LNB aperture.
// Licence:        GPL-3.0-or-later (CERN-OHL-S-2.0 optional for the hardware design).
// Units:          millimetres.
// =============================================================================

lnb_d      = 40;     // LNB neck diameter
clr        = 0.3;    // bore clearance
wall       = 5;
ring_h     = 25;
flange_d   = 84;
flange_t   = 3;
tick_depth = 0.6;
gap        = 2;      // clamp slit
ear_t      = 6;
ear_ext    = 9;
ear_angle  = -90;    // slit/ears at the bottom so the scale zero is at the top
bolt_d     = 4.3;    // M4
nut_d      = 8.4;    // M4 hex nut pocket
part       = 2;

$fn = 96;

ring_r = lnb_d / 2 + wall;

module tick(a, r1, r2) {
    rotate([0, 0, -a]) translate([-0.35, r1, flange_t - tick_depth]) cube([0.7, r2 - r1, tick_depth + 0.1]);
}

module scale() {
    for (a = [-45 : 5 : 45]) {
        major = (a % 15 == 0);
        tick(a, 30, major ? 35.5 : 33.5);
        if (major)
            rotate([0, 0, -a]) translate([0, 39, flange_t - tick_depth])
                linear_extrude(height = tick_depth + 0.1)
                    rotate([0, 0, a]) text(str(a), size = 3, halign = "center", valign = "center");
    }
}

module clamp() {
    xe = ring_r + ear_ext;
    difference() {
        union() {
            cylinder(r = flange_d / 2, h = flange_t);
            cylinder(r = ring_r, h = ring_h);
            rotate([0, 0, ear_angle]) translate([0, -(gap / 2 + ear_t), 0]) cube([xe, gap + 2 * ear_t, ring_h]);
        }
        translate([0, 0, -1]) cylinder(d = lnb_d + clr, h = ring_h + 2);
        rotate([0, 0, ear_angle]) {
            translate([0, -gap / 2, -1]) cube([xe + 1, gap, ring_h + 2]);
            translate([ring_r + ear_ext / 2, 0, ring_h / 2]) rotate([90, 0, 0]) cylinder(d = bolt_d, h = 40, center = true, $fn = 24);
            translate([ring_r + ear_ext / 2, gap / 2 + ear_t - 3.2, ring_h / 2]) rotate([-90, 0, 0]) cylinder(d = nut_d, h = 4, $fn = 6);
        }
        scale();
    }
}

module index_plate() {
    // Fixed pointer: fix it to the arm so the tip lies over the flange scale.
    difference() {
        union() {
            translate([0, 0, 0]) cube([60, 16, 3]);
            translate([60, 8, 0]) linear_extrude(height = 3) polygon([[0, -6], [10, 0], [0, 6]]);
        }
        for (x = [10, 35]) translate([x, 8, -1]) hull() {
            cylinder(d = bolt_d, h = 5, $fn = 24);
            translate([8, 0, 0]) cylinder(d = bolt_d, h = 5, $fn = 24);
        }
    }
}

if (part == 0 || part == 2) clamp();
if (part == 1) index_plate();
if (part == 2) translate([flange_d / 2 + 10, -8, 0]) index_plate();

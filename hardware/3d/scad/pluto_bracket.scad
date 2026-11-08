// =============================================================================
// pluto_bracket.scad  -  Mounting bracket for an ADALM-Pluto in a weatherproof box
// Purpose:        Tray with side rails, two cable-tie straps over the case and a
//                 cable-relief bar at the USB/SMA end, with 4 x M4 holes to screw it
//                 into a weatherproof enclosure (as in the EA5EN outdoor-box photos).
//                 The ADALM-Pluto outer case is about 117 x 79 x 24 mm:
//                 MEASURE YOUR UNIT (clones and cases vary) and edit case_l/w/h.
// Print settings: PETG or ASA (outdoor / UV). 4 perimeters, 30 % infill,
//                 0.2 mm layers, NO supports. Print base down.
// RF note:        Keep the bracket away from the PA and the antenna output: NEVER
//                 print it in carbon-fibre or metal-filled filament (conductive,
//                 can detune or short RF parts). The Pluto case is plastic: heat is
//                 dissipated through the air, leave free space around it.
// Licence:        GPL-3.0-or-later (CERN-OHL-S-2.0 optional for the hardware design).
// Units:          millimetres.
// =============================================================================

case_l   = 117;   // MEASURE YOUR UNIT
case_w   = 79;    // MEASURE YOUR UNIT
case_h   = 24;    // MEASURE YOUR UNIT
clr      = 1.0;   // clearance round the case
wall     = 3;
base_t   = 4;
rail_h   = 12;    // rail height (must be < case_h)
relief_l = 28;    // free length at the cable end
strap_w  = 4.2;   // slot for 3.6 mm cable ties (increase for wider)
strap_l  = 12;
mount_d  = 4.3;   // M4
strap_out = 8;    // plate margin outside the rails for the strap slots

echo("MEASURE YOUR UNIT: case_l/case_w/case_h are nominal values");

in_l    = case_l + 2 * clr;
in_w    = case_w + 2 * clr;
plate_l = in_l + wall + relief_l;
plate_w = in_w + 2 * wall + 2 * (strap_l + strap_out);
x0      = -plate_l / 2;                 // plate starts here, rail wall at the -x end
cx      = x0 + wall + in_l / 2;         // centre of the case seat

module strap_slot() { cube([strap_w, strap_l, base_t + 2], center = false); }

difference() {
    union() {
        translate([x0, -plate_w / 2, 0]) cube([plate_l, plate_w, base_t]);
        // end wall (-x) and side rails
        translate([x0, -in_w / 2 - wall, 0]) cube([wall, in_w + 2 * wall, base_t + rail_h]);
        for (s = [-1, 1])
            translate([x0, s > 0 ? in_w / 2 : -in_w / 2 - wall, 0]) cube([wall + in_l, wall, base_t + rail_h]);
        // cable-relief bar with two tie holes
        translate([x0 + plate_l - 10, -in_w / 2, 0]) cube([6, in_w, base_t + 10]);
    }
    // straps over the case: slots just outside the rails, two positions along x
    for (px = [cx - in_l / 4, cx + in_l / 4], s = [-1, 1])
        translate([px - strap_w / 2, s > 0 ? in_w / 2 + wall + 2 : -in_w / 2 - wall - 2 - strap_l, -1]) strap_slot();
    // tie holes through the relief bar
    for (y = [-in_w / 4, in_w / 4])
        translate([x0 + plate_l - 11, y, base_t + 4]) rotate([0, 90, 0]) cylinder(d = strap_w, h = 8, $fn = 24);
    for (y = [-in_w / 4, in_w / 4])
        translate([x0 + plate_l - 18 - strap_w / 2, y - strap_l / 2, -1]) cube([strap_w, strap_l, base_t + 2]);
    // M4 holes to the enclosure
    for (px = [x0 + 8, x0 + plate_l - 8], py = [-plate_w / 2 + 6, plate_w / 2 - 6])
        translate([px, py, -1]) cylinder(d = mount_d, h = base_t + 2, $fn = 24);
}

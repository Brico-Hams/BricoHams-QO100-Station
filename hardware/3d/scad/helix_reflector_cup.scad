// =============================================================================
// helix_reflector_cup.scad  -  Cup / ground-plane former for the 2.4 GHz helix
// Purpose:        Printed former for the helix ground plane (cup): disc + rim,
//                 N-female panel connector hole (16 mm D-flat), 3 x M3 bolt circle
//                 for helix_former.scad, 4 x M4 mounting holes. Optional second
//                 position for a 40 mm LNB collar next to the helix (dual-band
//                 feed arrangement as in the EA5EN course photos).
//                 Diameter = cup_d_lambda * lambda (0.8-1.1 lambda; lambda = 124.9 mm).
// Print settings: PETG or ASA (outdoor / UV). 4 perimeters, 30 % infill,
//                 0.2 mm layers, NO supports. Print disc side down.
// RF note:        A printed cup is NOT a reflector: cover the inside of the disc
//                 and the rim with adhesive copper or aluminium tape (continuous,
//                 overlap the joints, solder copper tape to the N connector body).
//                 NEVER print it in carbon-fibre or metal-filled filament near
//                 the feed: conductive/lossy at 2.4 / 10 GHz.
//                 With lnb_mode = 1 the LNB metal body disturbs the helix pattern:
//                 verify the squint and RHCP axial ratio on your own dish.
// Licence:        GPL-3.0-or-later (CERN-OHL-S-2.0 optional for the hardware design).
// Units:          millimetres.
// =============================================================================

freq_mhz      = 2400.25;
cup_d_lambda  = 1.0;     // 0.8-1.1; >= 0.75 lambda is the minimum for a helix
base_t        = 3;       // disc thickness
rim_h         = 20;      // rim height (about 0.16 lambda)
rim_t         = 2.4;     // rim wall
n_hole_d      = 16;      // N-female panel connector hole
n_flat        = 15;      // distance across the D-flat (check your connector)
helix_bolt_r  = 26.5;    // M3 circle for the helix foot (matches helix_former.scad)
helix_bolt_d  = 3.4;
mount_d       = 4.3;     // M4 clearance
mount_count   = 4;
lnb_mode      = 0;       // 0 = helix only, 1 = add a 40 mm LNB collar position
lnb_d         = 40;      // LNB neck diameter
lnb_clr       = 0.3;
lnb_ring_r    = 26;      // outer radius of the LNB collar boss
lnb_ring_h    = 14;
lnb_dx        = 78;      // distance helix axis -> LNB axis (mode 1)

$fn = 96;

lambda = 299792.458 / freq_mhz;
cup_r  = cup_d_lambda * lambda / 2;
mount_r = cup_r - rim_t - 8;

echo(str("cup diameter=", 2 * cup_r, " mm (", cup_d_lambda, " lambda)"));

module outline() {
    hull() {
        circle(r = cup_r);
        if (lnb_mode == 1) translate([lnb_dx, 0]) circle(r = lnb_ring_r + 4);
    }
}

module n_hole() {
    // D-shaped hole: circle with one flat, n_flat across from the opposite side
    intersection() {
        circle(d = n_hole_d, $fn = 64);
        translate([-n_hole_d, -n_hole_d]) square([2 * n_hole_d, n_flat + n_hole_d / 2]);
    }
}

difference() {
    union() {
        linear_extrude(height = base_t) outline();
        linear_extrude(height = rim_h)
            difference() {
                outline();
                offset(delta = -rim_t) outline();
            }
        if (lnb_mode == 1)
            translate([lnb_dx, 0, 0]) cylinder(r = lnb_ring_r, h = base_t + lnb_ring_h);
    }
    translate([0, 0, -1]) linear_extrude(height = base_t + 2) n_hole();
    for (a = [0 : 120 : 359])
        rotate([0, 0, a + 90]) translate([helix_bolt_r, 0, -1]) cylinder(d = helix_bolt_d, h = base_t + 2, $fn = 24);
    for (i = [0 : mount_count - 1])
        rotate([0, 0, 45 + i * 360 / mount_count]) translate([mount_r, 0, -1]) cylinder(d = mount_d, h = base_t + 2, $fn = 24);
    if (lnb_mode == 1) {
        translate([lnb_dx, 0, -1]) cylinder(d = lnb_d + lnb_clr, h = base_t + lnb_ring_h + 2);
        // two M4 set screws at 90 degrees to hold the collar
        for (a = [0, 90])
            translate([lnb_dx, 0, base_t + lnb_ring_h / 2])
                rotate([0, 90, a]) cylinder(d = 3.3, h = lnb_ring_r + 2, $fn = 24);
    }
}

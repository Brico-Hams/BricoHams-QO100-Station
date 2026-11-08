// =============================================================================
// sma_biast_enclosure.scad  -  Small enclosure for a DIY bias-T / DC-block board
// Purpose:        Box + lid for a small PCB (default 40 x 25 mm) with two SMA (or
//                 F) bulkhead holes on the short ends and a DC entry hole on a long
//                 side (cable gland or feed-through). Four external ears carry the
//                 M3 lid screws and double as mounting holes. Use it for the
//                 13/18 V LNB bias-T (never feed the LNB DC into an HF SDR input!)
//                 or a DC block. part = 0 box, 1 lid, 2 both side by side.
// Print settings: PETG or ASA (outdoor / UV). 4 perimeters, 30 % infill,
//                 0.2 mm layers, NO supports. Box opening up, lid flat.
// RF note:        Plastic does not shield: line the inside with copper tape
//                 connected to the connector bodies if you need isolation, or use
//                 a metal box. NEVER use carbon-fibre or metal-filled filament.
//                 Seal outdoors with silicone and self-amalgamating tape.
// Licence:        GPL-3.0-or-later (CERN-OHL-S-2.0 optional for the hardware design).
// Units:          millimetres.
// =============================================================================

board_l   = 40;
board_w   = 25;
board_t   = 1.6;
board_inset = 3.5;   // board hole position from the corners
board_hole_d = 2.6;  // pilot for M3 self-tapping (M2.5 board holes: use 2.2)
standoff_h = 3;
clr       = 1.0;
wall      = 2.4;
inner_h   = 14;      // free height above the floor
conn_d    = 6.4;     // SMA bulkhead hole; use 9.6 for F panel connectors
dc_d      = 7;       // DC entry (cable gland M6 / feed-through)
conn_z    = 7;       // connector axis above the floor
ear_d     = 9;
ear_hole  = 2.8;     // pilot in the box (lid hole is 3.4)
lid_t     = 3;
part      = 2;

$fn = 64;

in_l = board_l + 2 * clr;
in_w = board_w + 2 * clr;
out_l = in_l + 2 * wall;
out_w = in_w + 2 * wall;
box_h = wall + inner_h;
ear_x = out_l / 2 - 8;
ear_y = out_w / 2 + 3;

module ears(h, d_hole) {
    for (sx = [-1, 1], sy = [-1, 1])
        translate([sx * ear_x, sy * ear_y, 0]) difference() {
            cylinder(d = ear_d, h = h);
            if (d_hole > 0) translate([0, 0, -1]) cylinder(d = d_hole, h = h + 2, $fn = 24);
        }
}

module box() {
    difference() {
        union() {
            translate([-out_l / 2, -out_w / 2, 0]) cube([out_l, out_w, box_h]);
            ears(box_h, 0);
            for (sx = [-1, 1], sy = [-1, 1])
                translate([sx * (board_l / 2 - board_inset), sy * (board_w / 2 - board_inset), wall - 0.01])
                    cylinder(d = 5.5, h = standoff_h + 0.01);
        }
        translate([-in_l / 2, -in_w / 2, wall]) cube([in_l, in_w, inner_h + 1]);
        for (sx = [-1, 1], sy = [-1, 1]) {
            translate([sx * ear_x, sy * ear_y, wall]) cylinder(d = ear_hole, h = box_h, $fn = 24);
            translate([sx * (board_l / 2 - board_inset), sy * (board_w / 2 - board_inset), wall]) cylinder(d = board_hole_d, h = standoff_h + 1, $fn = 24);
        }
        for (sx = [-1, 1])
            translate([sx * out_l / 2, 0, wall + conn_z]) rotate([0, 90, 0]) cylinder(d = conn_d, h = 2 * wall + 2, center = true);
        translate([0, -out_w / 2, wall + conn_z]) rotate([90, 0, 0]) cylinder(d = dc_d, h = 2 * wall + 2, center = true);
    }
}

module lid() {
    difference() {
        union() {
            translate([-out_l / 2, -out_w / 2, 0]) cube([out_l, out_w, lid_t]);
            ears(lid_t, 0);
        }
        for (sx = [-1, 1], sy = [-1, 1])
            translate([sx * ear_x, sy * ear_y, -1]) cylinder(d = 3.4, h = lid_t + 2, $fn = 24);
    }
}

if (part == 0 || part == 2) box();
if (part == 1) lid();
if (part == 2) translate([0, out_w + 20, 0]) lid();

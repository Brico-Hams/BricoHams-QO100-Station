// =============================================================================
// helix_former.scad  -  Support tube for a 2.4 GHz RHCP axial-mode helix
// Purpose:        Printed tube with a right-hand helical groove that holds
//                 2.0-2.5 mm copper wire at the exact geometry of a Kraus
//                 axial-mode helix: circumference C = lambda, pitch S = 0.25 lambda
//                 (same formulas as services/qo100-calculators/assets/qo100-math.js
//                 helix(): G = 15*(C/l)^2*n*S/l, HPBW = 52/((C/l)*sqrt(n*S/l))).
//                 Taller than seg_max -> split in segments with a plug/socket joint.
// Print settings: PETG or ASA (outdoor / UV). 4 perimeters, 25 % infill,
//                 0.2 mm layers, NO supports. Print upright (flange down).
//                 Segments: part = 0 lays all out, part = k prints segment k.
// RF note:        NEVER use carbon-fibre, metal-filled or "conductive" filament
//                 anywhere near the feed: it is conductive/lossy at 2.4 / 10 GHz
//                 and detunes the helix. Plain PETG/ASA is nearly transparent.
// Licence:        GPL-3.0-or-later (CERN-OHL-S-2.0 may be used for the hardware
//                 design if you prefer; keep this header).
// Units:          millimetres.
// =============================================================================

freq_mhz   = 2400.25;  // design frequency (QO-100 uplink centre)
turns      = 5;        // 4, 5 or 6 are typical
wire_d     = 2.2;      // copper wire diameter (2.0-2.5 mm)
groove_clr = 0.2;      // extra radial clearance of the groove
margin     = 12;       // empty tube above and below the active turns
wall       = 4;        // tube wall (outer half becomes the segment skirt)
seg_max    = 200;      // maximum printed segment height
part       = 0;        // 0 = all segments side by side, k = only segment k
hand       = -1;       // -1 = left-hand winding: the dish reflection flips it to the RHCP QO-100 uplink.
                       // 1 = right-hand, only for a helix radiating directly (no dish).
                       // See antennas/helix-2g4.md.
foot_r     = 31;       // base flange radius
foot_h     = 4;        // base flange thickness
bolt_r     = 26.5;     // 3 x M3 bolt circle (matches helix_reflector_cup.scad)
bolt_d     = 3.4;      // M3 clearance hole
plug_h     = 10;       // height of the joint between segments
fit        = 0.25;     // joint clearance for your printer

$fn = 96;

lambda  = 299792.458 / freq_mhz;      // 124.9 mm at 2400.25 MHz
circ    = lambda;                     // helix circumference (wire centre line)
pitch   = 0.25 * lambda;              // turn spacing
helix_d = circ / PI;                  // diameter at the wire centre line
depth   = 0.6 * wire_d;               // groove depth below the wire's outer side
tube_r  = helix_d / 2 - wire_d / 2 + depth;
bore_r  = tube_r - wall;
shell   = wall / 2;
total_h = turns * pitch + 2 * margin;
n_seg   = ceil(total_h / seg_max);
seg_h   = total_h / n_seg;

echo(str("lambda=", lambda, " mm; helix diameter=", helix_d, " mm; pitch=", pitch,
         " mm; wire per turn=", sqrt(circ * circ + pitch * pitch), " mm; segments=", n_seg));

// OpenSCAD twist follows the left-hand rule, so a NEGATIVE twist gives the
// right-hand helix (hand = 1). The phase is offset per segment so the
// groove continues seamlessly across joints.
module groove(h, z0) {
    rotate([0, 0, -hand * 360 * (z0 - 1) / pitch])
        translate([0, 0, -1])
            linear_extrude(height = h + 2, twist = -hand * 360 * (h + 2) / pitch,
                           slices = max(2, ceil((h + 2) / pitch * 72)), convexity = 10)
                translate([helix_d / 2, 0]) circle(r = wire_d / 2 + groove_clr, $fn = 24);
}

module segment(k) {
    z0 = k * seg_h;
    last = (k == n_seg - 1);
    difference() {
        union() {
            cylinder(r = tube_r, h = seg_h);
            if (k == 0) cylinder(r = foot_r, h = foot_h);
        }
        translate([0, 0, -1]) cylinder(r = bore_r, h = seg_h + 2);
        if (k > 0) translate([0, 0, -0.01]) cylinder(r = bore_r + shell + fit, h = plug_h + 0.01);
        groove(seg_h, z0);
        if (k == 0)
            for (a = [0 : 120 : 359])
                rotate([0, 0, a + 90]) translate([bolt_r, 0, -1]) cylinder(d = bolt_d, h = foot_h + 2, $fn = 24);
    }
    if (!last)
        difference() {
            translate([0, 0, seg_h - 0.01]) cylinder(r = bore_r + shell - fit, h = plug_h + 0.01);
            translate([0, 0, seg_h - 1]) cylinder(r = bore_r, h = plug_h + 2);
        }
}

if (part == 0) {
    for (k = [0 : n_seg - 1])
        translate([k * (2 * foot_r + 10), 0, 0]) segment(k);
} else {
    segment(part - 1);
}

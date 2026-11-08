// =============================================================================
// pa_fan_duct.scad  -  80 mm fan to PA heatsink duct
// Purpose:        Square-to-rectangle duct that blows an 80 mm fan (screw holes
//                 71.5 mm apart) onto the fins of a 2.4 GHz PA heatsink. The outlet
//                 is a sleeve that slides over the heatsink (width x height) and is
//                 clamped by two M3 self-tapping screws. Used in the outdoor box
//                 (EA5EN photos: heatsinked PA, air inlet/outlet fans).
// Print settings: PETG or ASA (hot PA: ASA preferred, PETG softens ~80 C).
//                 3 perimeters, 20 % infill, 0.2 mm layers, NO supports.
//                 Print flange down.
// RF note:        Keep the duct away from the 2.4 GHz connectors and feed.
//                 NEVER use carbon-fibre or metal-filled filament: conductive near
//                 the PA output, can detune or short RF parts. Do not run a fan or
//                 its wires at the feed: the TX chain should be in a separate box.
// Licence:        GPL-3.0-or-later (CERN-OHL-S-2.0 optional for the hardware design).
// Units:          millimetres.
// =============================================================================

fan        = 80;
fan_holes  = 71.5;   // hole spacing
fan_hole_d = 4.3;
flange_t   = 3;
wall       = 2;
hs_w       = 70;     // heatsink width (measure it)
hs_h       = 40;     // heatsink height (measure it)
hs_clr     = 0.5;
duct_len   = 35;     // transition length
sleeve_len = 15;     // sleeve over the heatsink
screw_d    = 2.8;    // M3 self-tapping pilot

fo = fan + 6;                       // flange outer size
so_w = hs_w + hs_clr + 2 * wall;
so_h = hs_h + hs_clr + 2 * wall;

module slab(w, h, z, t = 0.01) { translate([-w / 2, -h / 2, z]) cube([w, h, t]); }

difference() {
    union() {
        slab(fo, fo, 0, flange_t);
        hull() {
            slab(fan, fan, 0);
            slab(so_w, so_h, duct_len);
        }
        translate([-so_w / 2, -so_h / 2, duct_len]) cube([so_w, so_h, sleeve_len]);
    }
    hull() {
        slab(fan - 2 * wall, fan - 2 * wall, -1);
        slab(hs_w + hs_clr, hs_h + hs_clr, duct_len);
    }
    translate([-(hs_w + hs_clr) / 2, -(hs_h + hs_clr) / 2, duct_len - 0.01]) cube([hs_w + hs_clr, hs_h + hs_clr, sleeve_len + 1]);
    for (sx = [-1, 1], sy = [-1, 1])
        translate([sx * fan_holes / 2, sy * fan_holes / 2, -1]) cylinder(d = fan_hole_d, h = flange_t + 2, $fn = 24);
    for (z = [duct_len + sleeve_len / 2])
        translate([0, 0, z]) rotate([0, 90, 0]) cylinder(d = screw_d, h = so_w + 2, center = true, $fn = 20);
}

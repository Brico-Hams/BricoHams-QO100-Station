// =============================================================================
// dish_angle_gauge.scad  -  Elevation / skew gauge for an offset dish
// Purpose:        Two plumb-bob protractors. part = 0 "elevation": hold its straight
//                 edge (the 0 line) along the dish aperture plane; the string reads
//                 the TILT of the aperture plane from vertical. For an offset dish
//                 the true elevation = tilt + offset_deg (default 26.6 deg), the same
//                 relation as mountTiltDeg = elevation - offsetDeg in
//                 qo100-math.js pointing(). The outer scale is already labelled in
//                 elevation; a wide mark shows target_elev_deg (take it from the
//                 calculators plugin). part = 1 "skew": +-45 deg scale for the LNB
//                 rotation about the boresight (align the 0 line with the LNB axis).
// Print settings: PETG or ASA. 3 perimeters, 30 % infill, 0.2 mm layers, NO supports.
//                 Print flat, scale face up. Hang a thin string + small weight
//                 from the hub hole.
// RF note:        Not an RF part, but keep it out of the feed field while measuring
//                 with TX on, and NEVER use carbon-fibre or metal-filled filament
//                 if it stays near the feed.
// Licence:        GPL-3.0-or-later (CERN-OHL-S-2.0 optional for the hardware design).
// Units:          millimetres, degrees.
// =============================================================================

offset_deg      = 26.6;  // dish offset angle (check the manufacturer data)
target_elev_deg = 40;    // elevation to set (example; use your own)
radius          = 100;
thickness       = 3;
hub_r           = 8;
hole_d          = 1.6;   // string hole
tick_depth      = 0.6;
part            = 0;     // 0 elevation, 1 skew

$fn = 64;

function pt(a, r) = [r * sin(a), -r * cos(a)];   // a = 0 points down, positive toward +x

module sector2d(a0, a1) {
    polygon(concat([[0, 0]], [for (a = [a0 : 1 : a1]) pt(a, radius)]));
}

module tick(a, r1, r2, w = 0.7) {
    rotate([0, 0, a]) translate([-w / 2, -r2, thickness - tick_depth]) cube([w, r2 - r1, tick_depth + 0.1]);
}

module label(a, r, s, size = 3) {
    translate([pt(a, r)[0], pt(a, r)[1], thickness - tick_depth])
        linear_extrude(height = tick_depth + 0.1) text(str(s), size = size, halign = "center", valign = "center");
}

module body(a0, a1) {
    difference() {
        linear_extrude(height = thickness) union() { sector2d(a0, a1); circle(r = hub_r); }
        translate([0, 0, -1]) cylinder(d = hole_d, h = thickness + 2, $fn = 24);
        children();
    }
}

module elevation() {
    tgt = target_elev_deg - offset_deg;
    body(-3, 93) {
        for (a = [0 : 5 : 90]) {
            tick(a, 66, (a % 10 == 0) ? 76 : 72);
            if (a % 10 == 0) label(a, 58, a);
        }
        // elevation scale (tilt + offset_deg), every 5 degrees of elevation
        for (e = [ceil(offset_deg / 5) * 5 : 5 : 90 + floor(offset_deg)]) {
            a = e - offset_deg;
            if (a >= 0 && a <= 90) {
                tick(a, 80, 88);
                label(a, 93, e, 2.6);
            }
        }
        if (tgt >= 0 && tgt <= 90) tick(tgt, 40, 98, 1.6);
    }
}

module skew() {
    body(-48, 48) {
        for (a = [-45 : 5 : 45]) {
            tick(a, 70, (a % 15 == 0) ? 80 : 76);
            if (a % 15 == 0) label(a, 62, a);
        }
    }
}

if (part == 0) elevation(); else skew();

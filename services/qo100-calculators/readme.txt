=== BricoHams QO-100 Calculators ===
Contributors: bricohams
Tags: amateur radio, qo-100, satellite, calculator, antenna
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPL-3.0-or-later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Offline calculators for the QO-100 (Es'hail-2) amateur satellite: dish gain, pointing, LNB link budget, 2.4 GHz helix and LNB LO/IF.

== Description ==

Five calculators embedded with shortcodes. Everything runs in the visitor's browser: no remote requests, no database, no admin options. Browser geolocation is used only when the visitor clicks the button.

* `[qo100_dish]` parabolic dish gain and beamwidth (10.489 and 2.400 GHz).
* `[qo100_pointing]` azimuth, elevation, LNB skew and magnetic azimuth towards 25.8 E.
* `[qo100_lnb]` LNB line-up, system temperature, G/T, C/N0 and SNR.
* `[qo100_helix]` 2.4 GHz RHCP helix feed (Kraus).
* `[qo100_ifcalc]` LNB LO / IF and LO drift.
* `[qo100_calculators]` all of them.

Formula sources: rftools.io (parabolic dish), eshail.batc.org.uk/point and dishpointer.com (pointing), pabr.org lnblineup (line-up), J. D. Kraus (helix), "Curso Iniciación QO-100, EA5EN Mateo". Only formulas are used; the code is original. Results are estimates.

== Installation ==

1. Plugins > Add New > Upload Plugin and choose bricohams-qo100-calculators.zip.
2. Activate it.
3. Add a shortcode to a page.

== Changelog ==

= 1.0.0 =
* First release.

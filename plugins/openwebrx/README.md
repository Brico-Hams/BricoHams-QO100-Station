# BricoHams QO-100 plugin for OpenWebRX+

Receive-only plugin: NB transponder bookmarks (beacons, CW, digital and SSB segments), a
downlink <-> uplink converter (offset 8089.5 MHz), the band plan and a link to the station PWA.

It has no code path to the station: no network calls, no microphone access. The PWA link is a
plain anchor and the PWA does its own login.

## Install (verify against the installed OpenWebRX+ version)

The plugin mechanism of OpenWebRX+ loads `plugins/receiver/<name>/<name>.js` from `init.js`.
Paths differ between package installs and Docker images; check yours.

1. Copy `bricohams.js` to `<openwebrx htdocs>/plugins/receiver/bricohams/bricohams.js`
   (e.g. `/usr/lib/python3/dist-packages/htdocs/plugins/receiver/bricohams/`).
2. Append the contents of `init.js` to `<openwebrx htdocs>/plugins/receiver/init.js`.
3. Optional: define `window.BRICOHAMS_PWA_URL` (https URL) before `Plugins.load('bricohams')`.
4. Reload the receiver page. The bookmark API call (`bookmarks.replace_bookmarks`) is
   guarded; if your version lacks it, add the frequencies in `bookmarks.json` of the server instead.

## Known public receivers (RX-only, not bundled)

| Name | Origin | IF centre |
|---|---|---|
| EA5EN Churra-Murcia (OpenWebRX+) | `http://ea5urm.dns2go.com:8073` | 739.800 MHz |

It is plain HTTP (no TLS): browsers block it as mixed content when embedded in an HTTPS page, so
only link to it (new tab), never embed it. The plugin does not configure it; this is a reference
only. See `docs/references/ea5en/README.md`.

## License

The plugin is GPL-3.0-or-later. OpenWebRX+ is AGPL-3.0. GPL-3.0 section 13 allows combining
GPL-3.0 and AGPL-3.0 works; the combined work as served by OpenWebRX+ remains subject to the
AGPL-3.0 network clause (offer the source of the whole, including this plugin, to users).

## Test

`node --test test/unit/openwebrx-plugin.test.js` scans the source for forbidden TX/PTT/log
references and checks that every bookmark is inside 10489.500-10490.000 MHz.

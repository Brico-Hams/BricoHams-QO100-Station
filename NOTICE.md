# Third-party notices

BricoHams (Anatol EA5KAO, Diego EA5JEF, Pedro Roca Molina; <https://bricohams.org>; *Radioafición · Hazlo tú mismo*) QO-100 Station is GPL-3.0-or-later. The BricoHams name and logo (`branding/bricohams_horizontal.png`) identify the project; the GPL does not grant trademark rights over them. The manual in `docs/manual/` is licensed CC BY-SA 4.0. Third-party names below are used only to identify the components; none of their owners endorses BricoHams. The program uses or interoperates with:

| Component | License | Use |
|---|---|---|
| SDRangel | GPL-3.0 | SDR engine, driven over its REST/UDP interfaces (installed separately) |
| OpenWebRX+ | AGPL-3.0 | Host of the receive-only plugin in `plugins/openwebrx` |
| openid-client | MIT | Google OpenID Connect |
| ws | MIT | WebSocket server |
| Electron | MIT | Desktop shell (Windows, Linux) |
| Node.js | MIT and others | Runtime bundled in the .deb |
| ft8_lib (Karlis Goba) | MIT | The FT8/FT4 decoder and encoder in `src/modes/ft8-*.js` are a JavaScript port of its algorithms (message packing, CRC-14, LDPC(174,91) tables and belief propagation, Costas sync search, soft-decision LLRs, GFSK synthesis). Copyright (c) 2018 Karlis Goba. |
| FT8/FT4 protocol | - | The FT8 and FT4 protocols were designed by Joe Taylor (K1JT), Steve Franke (K9AN) and Bill Somerville (G4WJS) (WSJT-X). |
| TQSL | ARRL / open source | LoTW uploads; only its CLI is invoked, installed separately |
| SDR++ | GPL-3.0 | Functional reference |
| DJ0ABR QO-100 WebSDR | n/a | Functional reference |
| SDR Console | Proprietary | Idea only; no code or assets used |
| Curso Iniciación QO-100 and OpenWebRX+ receiver by Mateo EA5EN | Third-party copyright (course not distributed) | Acknowledged: the course is summarised in own words in `docs/help/` with citations; his public receiver is only linked as an external reference. See `docs/references/ea5en/README.md` |

Check each project's own license text for the authoritative terms.

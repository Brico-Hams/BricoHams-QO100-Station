# BricoHams QO-100 Station

> Español: la ayuda para usuarios está en [docs/help/index.md](docs/help/index.md) y la lista de pruebas manuales en [docs/testing/CHECKLIST.md](docs/testing/CHECKLIST.md).

One program to operate a QO-100 (Es'hail-2) narrow-band station, receiving and transmitting, from a web browser anywhere.
The radio engine is [SDRangel](https://github.com/f4exb/sdrangel); BricoHams adds what SDRangel lacks: secure remote access,
a single-operator turn with a fail-safe PTT, beacon-based frequency correction, a logbook with LoTW/QRZ upload, and installers.

![Screenshot placeholder: radio view with spectrum, waterfall, PTT and beacon lock](docs/screenshot-placeholder.png)

*(Screenshot to be added: `docs/screenshot-placeholder.png` does not exist yet.)*

## Features (mapped to the 10 goals of the design)

| # | Goal | What you get | Status |
|---|---|---|---|
| 1 | Duplex SDR engine | SDRangel device sets: RX through the LNB IF (about 740 MHz), TX on 2400.000-2400.500 MHz. Target hardware: RTL-SDR, SDRplay, Airspy, ADALM-Pluto, USRP B200mini, Hermes Lite 2 with transverter. | SDRangel API paths are **unverified** against a real server |
| 2 | Frequency correction | Locks on the NB BPSK beacon (10489.750 MHz), filters the drift (median + EMA) and corrects the RX centre. TX correction is opt-in (`station.applyCorrectionToTx`). | Tested with synthetic spectra only |
| 3 | Modes | USB, CW, FT8, FT4 channel setup and band plan. Built-in pure-JavaScript **CW, FT8 and FT4 decoders** (plus an FT8/FT4 encoder/synthesizer) fed from the RX audio path; decodes are broadcast over WebSocket and listed in the PWA, where a click prefills the log form. | Done |
| 4 | Log | SQLite logbook, ADIF 3.1.4 export/import with `PROP_MODE=SAT`, `SAT_NAME=QO-100`, `BAND=13CM`, `BAND_RX=3CM`, LoTW upload through TQSL, QRZ Logbook upload with an encrypted API key. | Tested with fakes |
| 5 | Remote web | HTML5 PWA: spectrum, waterfall, RX audio, browser microphone for TX, installable. | Tested statically |
| 6 | Multi-user, one operator | Google sign-in (OIDC + PKCE), allowlist `email -> callsign + role` (`listener`, `operator`, `owner`), exclusive TX turn. | Tested with a fake IdP |
| 7 | Encryption | HTTPS/TLS and WSS; QRZ keys encrypted at rest (AES-256-GCM). | Done |
| 8 | Public listening | Receive-only OpenWebRX+ plugin with no path to TX. | Done |
| 9 | Installers | Windows x64 (NSIS), Linux x64 / arm64 `.deb` with systemd service, AppImage. Built by GitHub Actions. | Not yet tried on real machines |
| 10 | Quality | Unit and functional tests (`npm test`), manual checklist, Spanish user help, ADRs, developer docs. | Done |

Safety by design: transmit is **off by default**; the carrier is cut in under 2 s if the operator's connection is lost; see [SECURITY.md](SECURITY.md).

## Quick start

### Windows (x64)
1. Download the `.exe` and its `.sha256` from the [latest release](https://github.com/BricoHams/BricoHams-QO100-Station/releases/latest) and check the hash.
2. Run the installer (Windows SmartScreen warns because the installer is not code-signed).
3. Start the app, edit `%APPDATA%\BricoHams QO-100 Station\config.json`, put secrets in `secrets.env` next to it, restart.
Details: [docs/help/instalacion-windows.md](docs/help/instalacion-windows.md).

### Linux x64 / arm64
- Desktop: download the `.AppImage`, `chmod +x`, run it.
- Server or headless: download the `.deb` (`sudo apt install ./bricohams-qo100_<ver>_<arch>.deb`), edit `/etc/bricohams-qo100/config.json` and `/etc/bricohams-qo100/env`, then `sudo systemctl start bricohams-qo100`.

### Raspberry Pi (arm64, 64-bit OS)
```bash
curl -fsSL https://raw.githubusercontent.com/BricoHams/BricoHams-QO100-Station/main/packaging/linux/install.sh | sudo bash
```
The script downloads the latest `.deb` for your architecture, verifies its SHA-256 and installs it. Read it first if you prefer.

### From source
```bash
git clone https://github.com/BricoHams/BricoHams-QO100-Station.git
cd BricoHams-QO100-Station
npm ci
cp config.example.json config.json      # edit it
export GOOGLE_CLIENT_SECRET=...         # never put it in config.json
npm start                               # node src/server/index.js
npm test                                # unit + functional tests, no hardware needed
```
Desktop shell: `npm run desktop`. Developer guide: [docs/DEVELOPER.md](docs/DEVELOPER.md).

## Requirements

- **SDRangel** (installed separately, `sdrangelsrv` or the GUI with its REST API on `127.0.0.1:8091`).
- **A Google OAuth client** that you create yourself (no client is shipped): [docs/help/configurar-google.md](docs/help/configurar-google.md).
- **Node.js 24+** only when running from source (installers bundle their own runtime).
- **TQSL** (optional) for LoTW uploads, with your certificate and a station location already set up in TQSL.
- A QO-100 ground station: dish, LNB, SDR hardware, 2.4 GHz PA. A valid amateur radio licence is required to transmit.

## Documentation map

| Audience | Document |
|---|---|
| Users (Spanish) | [docs/help/index.md](docs/help/index.md) |
| Testers (Spanish) | [docs/testing/CHECKLIST.md](docs/testing/CHECKLIST.md), [REPORT-TEMPLATE.md](docs/testing/REPORT-TEMPLATE.md) |
| Contributors | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DEVELOPER.md](docs/DEVELOPER.md), [docs/adr/](docs/adr/README.md), [CONTRIBUTING.md](CONTRIBUTING.md) |
| Security | [SECURITY.md](SECURITY.md) |
| Design (Spanish) | [docs/superpowers/specs/2026-11-08-qo100-station-design.md](docs/superpowers/specs/2026-11-08-qo100-station-design.md) |
| Per module | `src/<module>/README.md`, `electron/README.md`, `plugins/openwebrx/README.md`, `packaging/windows/README.md` |

## License

GPL-3.0-or-later (see [LICENSE](LICENSE)), because the program integrates SDRangel (GPL-3.0). Third-party components and their licences are listed in [NOTICE.md](NOTICE.md).

## Credits

- [SDRangel](https://github.com/f4exb/sdrangel) by Edouard Griffiths F4EXB and contributors: the radio engine.
- AMSAT-DL and the Es'hail-2 / QO-100 team; DJ0ABR's QO-100 WebSDR, SDR++ and OpenWebRX+ as functional references.
- SDR Console was used as an idea only; no code or assets from proprietary software are included.
- Curso Iniciación QO-100 y receptor OpenWebRX+ de Mateo EA5EN (see [docs/references/ea5en](docs/references/ea5en/README.md)).
- BricoHams community.

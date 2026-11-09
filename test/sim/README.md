# Simulations (phase 14c)

Deterministic (seeded) end-to-end simulations. No network, hardware or real SDRangel: everything runs in-process.

- `npm run sim` runs `test/sim/*.sim.test.js` (a few minutes) and writes `docs/testing/sim-report.md` (Spanish).
- `node test/sim/report.js` regenerates the report from the last results (`SIM_RESULTS_DIR`, default in the OS temp dir).
- `test/unit/sim-smoke.test.js` is the fast subset that runs in `npm test`.

| File | Purpose |
| --- | --- |
| `band-sim.js` | QO-100 NB complex baseband at 96 kS/s: beacon, CW beacon, voice, FT8/FT4, CW, AWGN, LNB drift, spurs; `fftFrame` (SDRangel spectrum format) and `usbDemod` (48/12 kHz) |
| `metrics.js` | `simTest`, `record`, `percentile`, per-scenario result persistence |
| `*-rig.js` | Shared trial/loop helpers (beacon, digital, CW) |
| `*.sim.test.js` | Scenarios: beacon, digital, cw, ptt, contention, cluster, qso |
| `report.js` | Spanish markdown report |

Env knobs: `SIM_BEACON_SECONDS`, `SIM_TRIALS`, `SIM_ASSERT_TRIALS`, `SIM_CW_TRIALS`, `SIM_PTT_SESSIONS`, `SIM_CONTENTION_ATTEMPTS`.

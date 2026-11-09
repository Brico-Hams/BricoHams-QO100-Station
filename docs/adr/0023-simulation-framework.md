# 0023. Deterministic simulation framework (`test/sim/`)

- **Status:** Accepted
- **Date:** 2026-11-09

## Context
Most of the station logic (beacon tracking, decoders, PTT fail-safe, turn contention, DX cluster, the SDRangel client) cannot be
exercised by the maintainers without a dish, an LNB, SDR hardware and a live transponder, and a transmitter must never be tested
by trial and error. Unit tests cover single functions; they do not show whether the whole chain (band signal -> spectrum frame ->
beacon filter -> station -> SDRangel REST) still meets its operating targets after a change. We needed repeatable, hardware-free
evidence that also tells a tester what to expect on real hardware.

## Decision
- **Deterministic and in-process.** Every scenario is driven by a seeded PRNG (`test/fixtures/dsp.js`, `band-sim.js` `hash32`) and, where time matters, by `FakeClock`. No network, hardware or real SDRangel: the SDRangel side is the strict mock of [ADR 0022](0022-sdrangel-api-alignment.md), which rejects any setting the real swagger does not define. The same seed gives the same result on every machine.
- **Scenarios** (`test/sim/*.sim.test.js`, run by `npm run sim`; the report is written to `docs/testing/sim-report.md`, Spanish, by `report.js`):

| Scenario | What it models | Asserted |
| --- | --- | --- |
| `beacon` | `band-sim.js`: 96 kS/s complex baseband of the NB transponder (BPSK beacon, CW beacon, spurs) with AWGN and an LNB drift common to all signals (ppm offset + thermal ramp + random walk, up to ~8 kHz over 2 h). A 10 s beacon outage at mid-run. Closed loop through `beacon-rig.js`: FFT frame in SDRangel format -> `parseSpectrumFrame` -> `bricohams` controller or `sdrangel-freqtracker` engine -> station -> strict mock | first lock <= 60 s; max \|correction error\| < 50 Hz after a 10 s settle; re-lock <= 30 s after the outage; no centre-frequency write while unlocked |
| `digital` | `digital-rig.js`: FT8/FT4 station at a given SNR (2500 Hz reference) in AWGN -> USB demodulation to 12 kHz -> `decodeSlot`. Noise-only slots | FT8 >= 90 % at -15 dB; FT4 >= 90 % at -12 dB; 100 % at 0 dB; at most one wrong decode; zero decodes in noise |
| `cw` | `cw-rig.js`: keyed tone with QSB (fade rate drawn from 0.1-0.5 Hz, depth 0.3) and AWGN -> USB demodulation -> CW decoder; 10-35 WPM at 0/6/12 dB | CER < 5 % at 20 WPM, 6 dB SNR |
| `ptt` | 1000 random sessions on `FakeClock`: heartbeat loss (up to 40 %), jitter and reordering, key presses, silent and graceful disconnects, TOT. Invariants checked every 50 ms of simulated time | carrier never keyed later than `heartbeatTimeoutMs` + 100 ms after the last valid heartbeat; TOT overshoot <= 100 ms; never two keyers; TX off after the session ends |
| `contention` | 5 operators competing for the single turn | never two holders at once; only `busy` denials; every operator wins all its turns; driver on/off strictly alternate; turn freed after the holder disconnects (fair share is reported with the Jain index, not asserted) |
| `cluster` | Simulated telnet DX cluster with malformed lines, out-of-band spots, forced disconnects | accepted spots = expected (in band only); login and one retry per disconnect; backoff 20, 40, 80, 160... capped at 200 ms in the simulation |
| `qso` | Full QSO against the strict SDRangel mock | zero swagger validation errors and no 5xx; UDP audio reaches the UDPSource only in `TX_ON` and stops on release; ADIF export contains the QSO |

- **Thresholds and why.**
  - Beacon \|err\| < 50 Hz: SSB is intelligible within about 50 Hz and FT8/FT4 tolerate several tens of Hz of drift inside a slot; the measured result is 21 Hz (`bricohams`) and 8.7 Hz (FreqTracker), so the limit leaves margin for the harder real spectrum. Lock < 60 s and re-lock < 30 s follow from the filter (median of 5, EMA 0.3, lock after 3 hits, [ADR 0008](0008-beacon-correction-method.md)) at one frame per second plus the ~10 s the filter needs to converge. The simulation uses one frame every 2 s, the harder case.
  - FT8 >= 90 % at -15 dB and FT4 >= 90 % at -12 dB: the design targets, set near the sensitivity of a decoder written for this repository (reference WSJT-X decodes FT8 down to about -20 dB). They are deliberately thin: FT4 at -12 dB measured 9/10, exactly on the limit. If a decoder change moves them, the curve in the report is the evidence for revising the number, not for loosening it silently.
  - CW CER < 5 % at 20 WPM, 6 dB SNR in 2500 Hz, QSB depth 0.3: the design's "moderate signal under fading" case. The decoder integrates in ~25 Hz bins, so the effective tone-to-noise ratio is about 20 dB higher than the figure quoted; the 0 dB column is shown in the report as information, not asserted.
  - PTT keyed <= `heartbeatTimeoutMs` + 100 ms: the fail-safe promise of [ADR 0005](0005-ptt-fail-safe-state-machine.md) (carrier cut in under 2 s with the default timeout), plus 100 ms for the 50 ms checking granularity and timer scheduling. Measured worst case is 0.75 x the timeout.
- **Knobs** (environment variables): `SIM_BEACON_SECONDS` (simulated drift duration, default 7200; the outage is placed at half of it, at most 3600 s), `SIM_TRIALS` (decode trials per SNR point, default 2), `SIM_ASSERT_TRIALS` (trials at the two asserted SNR points, default 10), `SIM_CW_TRIALS` (default 3), `SIM_PTT_SESSIONS` (default 1000), `SIM_CONTENTION_ATTEMPTS`, `SIM_RESULTS_DIR` (where per-scenario JSON results go; default in the OS temp dir). More trials narrow the uncertainty of the 90 % bounds but change the seeds actually used, so a threshold verdict is only comparable between runs with the same knobs.
- **Results pipeline.** `simTest()` in `metrics.js` records pass/fail and duration per case and persists one JSON per scenario (every scenario file runs in its own process); `report.js` merges results younger than 6 h into `docs/testing/sim-report.md`. A fast subset (`test/unit/sim-smoke.test.js`) runs in `npm test`; the full set is not part of `npm test` or CI because it takes several minutes.

## Alternatives considered
- **Record real I/Q and replay it:** realistic, but needs copyrighted/personal captures, large files and a stable reference truth; synthetic signals give exact ground truth (the injected drift, the sent text).
- **Mocking at function level only:** faster, but hides integration errors between the spectrum parser, filter, station and API validation.
- **Running real SDRangel in CI:** heavy, needs hardware drivers, and would not be deterministic.

## Consequences
- **Not a substitute for on-air tests.** The simulations validate logic and regressions against a model: AWGN and slow fading, one common LNB drift, ideal ADC, no interference other than a few fixed spurs, no transponder sideband inversion, no real SDRangel latency or UDP loss. Real LNBs, strong adjacent signals, AGC behaviour and CPU load on a Raspberry Pi can differ. The [checklist](../testing/CHECKLIST.md) remains the acceptance test; the report states this itself.
- **Observed intermittency.** On 2026-11-09 one full `npm run sim` under heavy CPU load from other processes reported 3 failing cases that passed when rerun alone, with no code change. Results are deterministic for a given seed, so the cause is timing, not statistics; the failing cases were not recorded, so this has not been confirmed. The likely mechanism is the 280 s per-test timeout in `simTest()`: the beacon cases take about 150 s each on an idle machine (the full run takes ~5 min), so a 2x slowdown crosses the limit. Practical rules: run `npm run sim` on a quiet machine; on a failure, rerun the single file (`node --test test/sim/beacon.sim.test.js`) before investigating; use `SIM_BEACON_SECONDS=1800` for a quicker check; do not raise timeouts or relax thresholds to hide a failure that reproduces on an idle machine. If it recurs, record the failing case title (the report shows the first failure message) and the load.
- A new rig or scenario must carry its own seed and a stated justification for each threshold, as above.

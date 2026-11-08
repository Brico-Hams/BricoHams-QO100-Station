# 0008. Beacon correction method

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
LNB local oscillators drift with temperature by kHz. The QO-100 NB beacon (10489.750 MHz) is a stable reference; measuring it in the IF spectrum tells us the drift. A wrong correction would move the transmit frequency, so the method must be robust and conservative.

## Decision
- **Estimate**: find the strongest bin within ±10 kHz of the expected beacon IF, require peak minus window median of at least 10 dB, reject peaks on the window edge, then refine with parabolic interpolation on the dB values (sub-bin accuracy).
- **Filter**: median of the last 5 estimates (outliers), then EMA with alpha 0.3; lock after 3 consecutive hits, unlock after 5 misses; deadband 2 Hz (no writes to SDRangel for smaller changes); hard limit 50 kHz.
- **Apply**: RX device centre = beacon IF + correction, always. TX is corrected only if `station.applyCorrectionToTx` is true, because the beacon measures the drift of the **RX** LNB; correcting TX is valid only when the TX oscillator shares the same reference (e.g. GPSDO/10 MHz). Default false. TX retunes are deferred while transmitting.
- Without lock nothing changes; the last correction is kept (holdover) with status `no-lock`.

## Alternatives considered
- **Mean of the spectrum peak without interpolation**: resolution limited to the bin width.
- **Beacon demodulation / PLL**: more accurate but needs coherent processing the SDRangel REST/spectrum interface does not give us.
- **Kalman filter**: more tuning parameters; median + EMA is easier to reason about and test.
- **TX correction by default**: could shift the uplink wrongly if the TX source is not tied to the RX LO.
- **Manual-only correction**: operators would chase the drift continuously.

## Consequences
- Needs the spectrum WS feed (`audio.enabled`); otherwise status is `no-lock` with reason `no_source`.
- Accuracy is verified with synthetic spectra only; real spectrum frame layout is unverified.
- Operators with free-running TX oscillators must watch their own uplink.

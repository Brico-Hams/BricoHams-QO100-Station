# beacon

Measures the QO-100 NB BPSK beacon (10489.750 MHz) in the receiver's IF spectrum and corrects RX/TX for LNB drift.

## Public API (`index.js`)
- `estimateBeaconOffset({powersDb, centerHz, binHz, expectedHz, searchHz=10000, minSnrDb=10})`: pure. Bin `i` is at
  `centerHz + (i - N/2) * binHz`. Returns `{found:true, offsetHz, peakHz, snrDb}` or `{found:false, reason}`
  (`bad_input | outside_span | low_snr | no_peak`). Parabolic interpolation on the dB values gives sub-bin accuracy.
- `createBeaconFilter({medianSize=5, alpha=0.3, lockCount=3, unlockCount=5})`: `update(offsetHz|null)` returns
  `{status:'locked'|'no-lock', offsetHz}`; median rejects outliers, EMA smooths, hysteresis avoids lock flapping.
- `createBeaconController({getSpectrum, station, lnbLoHz, deadbandHz=2, filter, onStatus, logger})`: `step()` processes one frame,
  `status()` returns `{status, offsetHz, appliedHz, snrDb, reason, updatedAt}`. `getSpectrum()` must return the IF spectrum
  (centre in IF Hz, i.e. downlink minus LNB LO); the controller expects the beacon at `10489.750 MHz - lnbLoHz`.

## Invariants
- Without lock nothing is written to SDRangel; when lock is lost the last applied correction is kept (holdover) and status is `no-lock`.
- Corrections smaller than `deadbandHz` are not written (avoids hammering SDRangel).
- Correction `e` (beacon seen at nominal + e) is applied via `station.setCorrection(e)`: RX centre = beacon IF + e, TX centre =
  beacon uplink - e (TX only when idle; see `src/modes`).

## Source of spectrum frames
SDRangel's REST API does not stream FFT data; a frame source (for example its spectrum WebSocket, or a plugin) must be
supplied as `spectrumSource` to `createApp`. Not implemented yet (phase 2 only defines the interface).

## Testing
`node --test test/unit/beacon.test.js`

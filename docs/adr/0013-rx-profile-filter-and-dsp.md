# 0013. RX profile: filter presets, AGC, squelch and noise reduction

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
Filter width presets, AGC modes, squelch and noise reduction are standard in every compared receiver (HDSDR, SDR#, SDRuno, GQRX, SDRangel). BricoHams used one fixed profile per mode.

## Decision
- `src/modes/rx-profile.js` defines `FILTER_PRESETS` per mode (USB, CW: narrow/normal/wide; FT8/FT4: normal/wide), where `normal` equals the existing default, and a validated `DEFAULT_RX_DSP` (`agc` off/slow/medium/fast, `squelchDb` −100..0 or null, `noiseReduction` boolean).
- The station keeps the chosen filter and DSP, merges them into the RX channel patch, resets the filter to `normal` on mode change and keeps the DSP across modes.
- Input is validated by an allow-list of keys and ranges; anything else is 400.
- The SSBDemod setting names (`agc*`, `dnr`, `rfBandwidth`, `lowCutoff`) are isolated in `toChannelSettings` and marked "verify against the SDRangel swagger". The mock server only stores them.
- Only the RX channel is touched; the TX audio path and PTT are unchanged.

## Alternatives considered
- **Free-form bandwidth**: more flexible, harder to validate, and presets cover QO-100 use.
- **Client-side DSP**: would need audio processing in the browser and would not affect decoders.

## Consequences
- If a field name differs in the installed SDRangel, the setting is ignored by SDRangel; the fix is local to `toChannelSettings`.

# 0019. Notch and auto-notch in the RX audio path

- **Status:** Accepted (amended by [0022](0022-sdrangel-api-alignment.md): SDRangel has no notch in its API, so the notch is client-side only; the `sdrangel` engine described below does not exist)
- **Date:** 2026-11-08

## Context
Carriers and birdies inside an SSB passband are common on the QO-100 narrowband transponder. SDRangel may or may not expose a notch in its SSB demodulator.

## Decision
- State `{enabled, offsetHz, widthHz, auto}` lives in the station (`POST /api/notch`, operator + CSRF, validated ranges in `src/modes/notch.js`) and is part of `status`.
- Default engine `station.notchEngine = "client"`: a biquad notch (manual) or an LMS adaptive line enhancer (auto) in the RX AudioWorklet (`notch-dsp.js`, `rx-player.js`). It always works and only affects the local audio.
- Engine `sdrangel`: the same state is mapped to demodulator settings (`SDRANGEL_NOTCH_KEYS`, **verify against the SDRangel swagger**); the client notch is then forced off to avoid double notching.
- Clicking a carrier in the spectrum sets the notch; shortcuts `k` (notch) and `u` (auto-notch), operator-only in the UI.

## Alternatives considered
Only SDRangel (not guaranteed to exist); notch on the server PCM (would affect every listener).

## Consequences
The client notch is per-listener; the key names for the `sdrangel` engine are unverified.

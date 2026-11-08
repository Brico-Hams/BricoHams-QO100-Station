# 0017. Feature selection from the SDR software comparison

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
We compared BricoHams with SDRuno, HDSDR, SDR#, SDR Console, SDRangel, GQRX, CubicSDR, GNU Radio, gr-air-modes, dump1090 and rtl_433 (`docs/references/sdr-software/comparison.md`). The design spec lists ADS-B and ISM sensors as non-goals.

## Decision
- Implement the gaps that matter to QO-100 operators and fit the existing architecture (server + SDRangel REST + PWA): memories, band plan overlay, RIT/XIT with TX lock, filter presets, RX AGC/squelch/NR, scope tools, shortcuts and RX recording (ADRs 0011-0015).
- Do not implement ADS-B (dump1090, gr-air-modes) or 433 MHz decoding (rtl_433); they appear in the comparison only.
- Proprietary programs (SDRuno, HDSDR, SDR#, SDR Console) are inspiration only: no code, assets or UI copied. No GPL/BSD code was reused; if it ever is, it must be attributed and compatible with GPL-3.0-or-later.
- Left for later: I/Q recording, DX cluster, plugin API, in-browser notch and noise blanker beyond SDRangel's own, multi-RX.

## Consequences
- Claims about third-party programs come from memory and are marked "(verificar)" where uncertain.

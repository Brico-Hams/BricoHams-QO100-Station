# 0001. SDRangel as the radio engine

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
The station needs full-duplex SDR for QO-100 (RX near 740 MHz IF, TX on 2400 MHz), SSB/CW/digital channels, support for many SDR devices on Windows, Linux x64 and arm64, and a machine-controllable interface. Writing DSP and drivers from scratch would dominate the project.

## Decision
Use SDRangel, driven through its REST API (device sets, channels), its spectrum WebSocket and UDP audio. BricoHams is a control layer around it; it does not link SDRangel code.

## Alternatives considered
- **SDR++**: good UI, but no complete remote-control API for tuning/TX and no comparable TX channel chain.
- **GNU Radio**: powerful but needs a flowgraph per radio and custom UI/control; high effort for the same result.
- **Own DSP**: months of work, driver maintenance for each SDR, high risk of RF defects.
- **SDR Console (proprietary)**: closed source, Windows only, no open control API, and incompatible with a GPL project.

## Consequences
- We inherit SDRangel's device support and DSP; we depend on its REST/UDP/WS interfaces, which in this repository are **unverified** against a real instance (see DEVELOPER.md).
- GPL-3.0 integration drives ADR 0002.
- SDRangel must be installed and run separately; its unauthenticated interfaces must stay on loopback.

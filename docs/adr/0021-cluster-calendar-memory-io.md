# 0021. DX cluster, activity calendar and memory import/export

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
Operators want spots and a calendar of QO-100 activities, and to move frequency memories between tools.

## Decision
- `src/cluster/`: telnet DX cluster client (`node:net`, configured host/port/callsign, reconnect with backoff). Spots are filtered to the NB downlink 10489.5–10490.0 MHz; uplink 2400.x spots are converted to downlink; the rest is dropped. Spots go over WS (`spot`, `spots`) and `GET /api/spots`; clicking one tunes the **RX only**. `POST /api/spots` (operator) posts to the cluster only if `cluster.postSpots`.
- Calendar: minimal RFC 5545 VEVENT parser, loaded from a configured URL (timeout, size limit) or uploaded by the owner. RRULE is not expanded.
- Everything is off by default; no outbound connection unless the owner enables it.
- Memories: export JSON (`schema` + `version`) and CSV; import (operator) validates each row, reports invalid rows, dedupes by name or frequency+mode, offers a dry run, and accepts CHIRP-like columns (name, frequency in MHz, mode). Imports are always personal.

## Consequences
Cluster protocol quirks vary between nodes (verify against a real node); the calendar covers simple events only.

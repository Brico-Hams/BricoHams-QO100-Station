# 0011. Station database and frequency memories

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
The comparison with SDR programs (see `docs/references/sdr-software/comparison.md`) shows that frequency memories/bookmarks are universal (SDR#, SDRuno, HDSDR, GQRX, SDRangel) and BricoHams had none. Several operators share one station, so memories must be per user, plus a few station-wide ones.

## Decision
- A second SQLite file, `stationDbPath` (`./data/station.db`), holds `memories`, `settings` and the `recordings` index. It is separate from the logbook so that the logbook keeps its own backup and retention rules (ADR 0007). It is opened lazily with `node:sqlite` and versioned migrations.
- A memory is `{name, downlinkHz, mode, filter?}`. Name 1-32 chars without control characters, unique per scope ignoring case; frequency inside the narrow-band transponder range derived from `BAND_PLAN`; at most 200 per user and 200 shared.
- Shared memories (owner column NULL) are created, edited and deleted by the `owner` role only. Other users' rows answer 404, not 403, so ids cannot be probed.
- Built-in presets (`QO100_PRESETS`: beacon, CW, FT8, FT4, SSB) are code, not rows.
- Recall goes through `station.setMode` / `tune` / `setFilter`, so it obeys the same TX rules as manual tuning (409 `tx_active` when the mode would change while keyed).

## Alternatives considered
- **Same file as the logbook**: couples backup/restore of QSOs to preferences.
- **localStorage only**: not shared between devices, lost on clearing the browser.
- **A JSON file**: no atomicity or uniqueness guarantees.

## Consequences
- One more data file to back up.
- Memories are never a TX path: recalling only tunes the receiver and, via the existing rules, the TX offset.

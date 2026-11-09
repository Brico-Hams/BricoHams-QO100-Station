# 0020. I/Q recording and playback delegated to SDRangel

- **Status:** Accepted (amended by [0022](0022-sdrangel-api-alignment.md): endpoints and keys now checked against the swagger copy; only the report wrapper names and the `fileRecordName` suffix remain to be confirmed on a real instance)
- **Date:** 2026-11-08

## Context
I/Q files are huge. Streaming them through Node would waste CPU and bandwidth and expose raw spectrum.

## Decision
- `src/sdrangel/iq.js` drives SDRangel only: a `FileSink` channel on the RX device set records; playback switches the RX device set to `FileInput` and `live` switches back and re-tunes. All endpoints and settings keys are marked **verify against the SDRangel swagger**.
- Policy reuses the WAV recorder rules (ADR 0014): `iq.enabled` in config is the master switch (default off), the owner can switch off at run time (`PUT /api/iq/policy`), per-user quota `iq.maxUserMb`, `iq.maxSeconds` limit, one recording at a time, per-user isolation, `RecordingError` codes. Rows live in table `iq_recordings` (station DB migration v2).
- Operator role + CSRF for start/stop/playback/delete; nothing touches the TX device set or the PTT.

## Consequences
Disk accounting relies on the size SDRangel reports; files stay on the SDRangel host, so no download is offered.

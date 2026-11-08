# 0022. SDRangel API alignment: UDPSource/UDPSink, strict mock, reference copy

- **Status:** Accepted (amends 0013, 0019 and 0020)
- **Date:** 2026-11-08

## Context
The first integration was written from memory. Checking it against the SDRangel swagger and sources showed that several
assumptions do not exist: SSBMod has no UDP audio input, SSBDemod has no UDP output and no notch, `FileSink` has no `record`
setting (recording is an action), and there is no API to list or delete I/Q files.

## Decision
- **Audio path.** RX: a `UDPSink` channel (sampleFormat `FormatUSBMono`=7, 48 kHz) sends USB audio to `audio.rxUdp`. TX: a `UDPSource` channel (sampleFormat `FormatUSB`=3, 48 kHz) listens on `audio.txUdp`. `SSBMod` is added only for CW (`modAFInput`=CWTone, `cwKeyer`) and the UDPSource is muted while it is used. `station.provision()` creates and configures them (idempotent) and starts the spectrum server (`POST .../spectrum/server`); failures there are logged, not fatal.
- **Client tables.** `src/sdrangel/client.js` keeps one table per concern (endpoints, device settings keys per hwType, channel wrapper keys) and every entry carries `ref: <file>:<line>` or is listed in `NOT_IN_SDRANGEL_API`.
- **Strict mock.** `mock-server.js` validates every write against the reference YAML with `swagger-lite` (`validateAgainst`); unknown keys or wrong types give 400 with details. Tests therefore cannot rely on keys the real API lacks.
- **Reference copy.** `docs/references/sdrangel-swagger/` (swagger.yaml, include/*.yaml, source/*) is a read-only copy. Refresh: copy the files from the SDRangel tag in use over the folder, run `npm test`, fix the table entries that fail, update the `ref:` lines.
- **I/Q.** `FileSink.fileRecordName` points into `iq.dir`, which BricoHams manages: listing, deletion and quota are done on that directory (path-safe, names validated). Recording uses the `FileSinkActions.record` action.
- **Beacon.** `beacon.engine`: `bricohams` (default, spectrum based, ADR 0008) or `sdrangel-freqtracker` (FreqTracker channel, `trackingDeltaFrequency` report).
- **RX DSP.** Notch and auto-notch are client-side only (not in the API). Squelch and AGC use UDPSink fields. Noise reduction exists only in SSBDemod, which has no UDP output, so it is refused (`dnr_unavailable`).

## Alternatives considered
Keeping SSBDemod/SSBMod with a virtual audio device (needs OS-specific loopback drivers); decoding audio from the spectrum websocket (not available).

## Consequences
RX `lowCutoff` cannot be set (UDPSink has no such field); only `rfBandwidth` applies. The `<Type>Report` wrapper names and the suffix SDRangel adds to `fileRecordName` are inferred and must be confirmed on a real instance.

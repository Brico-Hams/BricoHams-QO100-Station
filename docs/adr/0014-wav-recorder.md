# 0014. Server-side WAV recording of the RX audio

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
Recording received audio is common (SDR#, HDSDR, SDRuno, GQRX, SDRangel). It lets operators review QSOs and share clips. It also stores other people's voices, uses disk and must not be a way to fill the server.

## Decision
- `src/webrtc/wav.js` writes a canonical PCM WAV (12 kHz, mono, s16le) with a 44-byte header, finalized on close. `fixWavHeader` repairs files left open by a crash.
- `src/webrtc/recorder.js` taps the existing RX audio fan-out (no second capture). Files are created with `wx` and mode 0600 under `recording.dir/<sha256(email)[0:16]>/`, so no user input reaches a path.
- Limits: `recording.maxFileMb` (100), `recording.maxUserMb` (1000), one recording per user, 4 concurrent, 413 `quota_exceeded` when less than 1 MB of quota remains. The per-file cap is the smaller of the file cap and the remaining quota.
- Operators can record, download and delete their own files; the owner role sees all. Listeners cannot record or download.
- Policy: `recording.enabled` in the config is the master switch; the owner can switch recording off at run time (`PUT /api/recordings/policy`) but cannot enable what the config disabled.
- On start-up unfinished rows are repaired (`recovered`); on shutdown recordings are stopped.
- Only receive audio is recorded. The microphone path is never tapped.

## Alternatives considered
- **Browser-side recording**: not available to the station owner as a policy control and lost on reload.
- **I/Q recording**: very large; left to SDRangel (see comparison).
- **Per-user opt-in to share**: out of scope for now.

## Consequences
- Operators should be told that RX audio can be recorded (see the help chapter); amateur-radio traffic is public, but local rules on retention apply (verify).

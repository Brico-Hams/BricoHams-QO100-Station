# 0006. PCM over WSS instead of WebRTC

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
Browsers need to hear the receiver and send the microphone with low latency. Narrow-band SSB/CW audio is small (12 kHz mono is about 192 kbit/s raw). The server may sit behind NAT, a reverse proxy or a home router where opening UDP ports is hard.

## Decision
Carry audio as 16-bit PCM mono in binary frames over the already authenticated WSS connection (`/ws/control`): RX at 12 kHz in 240-sample frames, microphone at 12 kHz (8-48 kHz accepted), plus spectrum frames. The server resamples to and from SDRangel's 48 kHz UDP audio. The folder `src/webrtc/` keeps its historical name.

## Alternatives considered
- **WebRTC**: lower jitter under loss, but ICE/STUN/TURN, UDP ports and a large native dependency; a second authentication path to secure.
- **Opus over WebSocket**: saves bandwidth but needs a codec in the browser and server (dependency, latency); unnecessary at this bit rate.
- **HTTP chunked streaming**: no upstream path for the microphone.

## Consequences
- One port, one TLS, one session: simple to proxy and to secure; origin and session checks cover audio too.
- TCP head-of-line blocking can add latency on lossy links; slow listeners get frames dropped (backpressure) rather than queued.
- Bandwidth about 200 kbit/s per listener for audio, more with spectrum.
- Everything is testable in-process.

# src/webrtc: audio transport and spectrum

The folder name is historical. There is **no WebRTC** (spec §6): audio travels as 16-bit PCM mono over the
existing authenticated WSS (TLS), so no extra ports, ICE or TURN are needed.

## Public API (`index.js`)

| Export | Purpose |
|---|---|
| `createRxAudio(opts)` | UDP in (SDRangel UDPSink, USBMono, 48 kHz s16le; `audio.rxUdp`) -> 12 kHz -> fan-out to listeners. `addListener(ws)`, `addTap(fn)` (local consumers such as the decoders receive each 12 kHz `Int16Array` frame and keep the pipeline running with no listeners), `stats()`, `start()`, `stop()`. |
| `createTxAudio({ptt, sink, ...})` | `handleFrame(connId, buf)` gates, validates, limits and forwards mic frames. `stats()`. |
| `createUdpTxSink(opts)` | `TxAudioSink` that sends s16le 48 kHz UDP to SDRangel's UDPSource channel (`audio.txUdp`, FormatUSB). |
| `createSpectrumSource` / `SpectrumSource` | WS client of SDRangel's spectrum server; `getSpectrum()` returns `{centerHz, binHz, power[]}` or null when stale. |
| `createSpectrumFeed({source})` | Downsamples to <= 10 fps / 512 bins for browsers. |
| `parseSpectrumFrame`, `downsampleSpectrum` | Pure functions. |
| `Resampler`, `toInt16` | Windowed-sinc resampler. |
| `encodeFrame` / `decodeFrame` (frames.js) | Binary frame codecs. |

## Binary frames (little endian)

| Kind | Direction | Header | Body |
|---|---|---|---|
| 1 MIC | client -> server | `kind u8, flags u8, seq u16, sampleRate u32` | s16le mono |
| 2 RX_AUDIO | server -> client | same 8 bytes (rate 12000) | s16le mono, 240 samples |
| 3 SPECTRUM | server -> client | `kind u8, flags u8, seq u16, centerHz f64, binHz f32, count u16` (18 bytes) | `count` u8, dB = byte*0.5 - 140 |

## Invariants

- RX: a slow listener (`bufferedAmount` above the high-water mark) misses frames; ingest never blocks. With no listeners nothing is processed.
- TX: a mic frame is forwarded only if the sender holds the PTT turn **and** state is `TX_ON`. Anything else is dropped and counted. On any state change away from `TX_ON` the sink is reset, so forwarding stops within one frame.
- TX input: sample-rate whitelist {8000, 12000, 16000, 24000, 48000}, max 100 ms per frame, limiter (ceiling 0.8, hard clamp) so a hot mic cannot overdrive the PA.
- No secrets are handled here; nothing is logged per frame.

## TxAudioSink interface and the fallback (spec §7)

A sink implements `write(Int16Array)` (48 kHz mono), `reset()` and `close()`.
Implementation 1 is `createUdpTxSink` (SDRangel UDPSource, sampleFormat FormatUSB, 48 kHz s16le mono; SSBMod has no UDP input).
**Fallback implementation (not built):** if SDRangel's UDP input is unusable, write the PCM to a virtual
loopback audio device (VB-Cable on Windows, `snd-aloop` on Linux) selected as the modulator's audio input.
Only a new class with the same three methods is needed.

## Verify against real SDRangel

- UDPSink/UDPSource are provisioned by `station.provision()` (ADR 0022). Spectrum frame layout follows `wsspectrum.cpp`; enabling the spectrum server uses `POST /sdrangel/deviceset/{n}/spectrum/server` (swagger), logged and non-fatal if refused.
- Not verified on hardware: real UDPSink/UDPSource datagram sizing and latency.

## Recording (ADR 0014)

- `wav.js`: `wavHeader`, `parseWavHeader`, `createWavWriter({path, sampleRate, maxBytes, channels})` (opens with `wx`, mode 0600, `full` flag at the cap, idempotent `close()`), `fixWavHeader(path)`.
- `recorder.js`: `createRecorder({db, rxAudio, dir, enabled, maxFileMb, maxUserMb, clock, logger})` with `policy`, `setEnabled`, `status`, `start`, `stop`, `list`, `locate`, `remove`, `stopAll`, `recoverUnfinished`; `RecordingError(code, status)`.
- Invariants: only RX audio is recorded; paths contain a hash of the e-mail, never user input; one recording per user, 4 concurrent; per-file and per-user caps; the config switch can only be tightened at run time; unfinished files are repaired at start-up.
- Tests: `node --test test/unit/advanced.test.js test/functional/advanced.test.js`.

## Tests test/unit/tx-audio.test.js test/unit/spectrum.test.js test/functional/audio.test.js`

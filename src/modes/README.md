# modes

Band plan, frequency conversions, mode switching and the decoder interface.

## Public API (`index.js`)
- Frequencies: `BEACON_DOWNLINK_HZ`, `TRANSPONDER_OFFSET_HZ` (8089.5 MHz), `DEFAULT_LNB_LO_HZ`, `downlinkToUplink`, `uplinkToDownlink`,
  `downlinkToIf`, `ifToDownlink`.
- Band plan (downlink): CW 10489.505-10489.540, digital 10489.540-10489.650, SSB 10489.650-10489.990 MHz. `segmentFor(hz)`,
  `checkTransmit(hz, mode)`, `DEFAULT_DIAL_HZ`. The segment edges and dial frequencies are unverified; check against the current
  AMSAT-DL/IARU plan.
- `createStation({client, rxDeviceSet, txDeviceSet, lnbLoHz, applyToTx, isTxActive, decoders, logger})`:
  `tune(downlinkHz)`, `setMode(mode)` (`USB|CW|FT8|FT4`), `setCorrection(hz, source)`, `onTxIdle()`, `status()`.
  `StationError` has `code` = `frequency_out_of_range | unknown_mode | correction_out_of_range`.
- Decoders: `createUnavailableDecoder(mode)`, `createDecoderRegistry()`, `createDefaultDecoderRegistry({useWorkers})` (CW, FT8, FT4),
  `utcSlot(mode, nowMs)`, `DecoderUnavailableError`, `createCwDecoder()`, `createSlotDecoder({mode, executor})`,
  `createInlineExecutor()`, `createWorkerExecutor()`, `createDecodeService({rxAudio, station, decoders, publish})`,
  `decodeSlot(samples, {mode})`, `encodeMessage(text, mode)`, `synthSlot(text, mode, {freqHz})`.

## Files
The spec asks for `src/modes/ft8/`; that directory could not be created, so the FT8/FT4 code is flat with an `ft8-` prefix.

| File | Purpose |
|---|---|
| `cw-decoder.js` | Goertzel bank (300-1200 Hz, 25 Hz steps, 10 ms blocks), adaptive threshold and dot length (5-40 WPM), Morse table with prosigns |
| `ft8-constants.js` | Costas arrays, Gray maps, FT4 XOR sequence, per-protocol parameters |
| `ft8-tables.js`, `ft8-ldpc.js` | LDPC(174,91) tables, CRC-14, encoder, belief-propagation decoder |
| `ft8-message.js` | 77-bit message pack/unpack (standard, non-standard, free text, telemetry), callsign hash table |
| `ft8-encode.js` | Message to channel symbols, GFSK synthesizer, `synthSlot` (test signals and future TX) |
| `ft8-fft.js`, `ft8-decode.js` | Mixed-radix FFT, waterfall, sync candidates, soft LLRs, `decodeSlot` |
| `slot-decoder.js`, `ft8-worker.js` | UTC-slot buffering and inline / worker-thread executors |
| `decode-service.js` | RX audio tap to decoder of the current mode to WebSocket `decode` messages |

Port of the algorithms of ft8_lib (MIT, Karlis Goba), see `NOTICE.md`. Unsupported 77-bit types (DXpedition, EU VHF, ARRL Field Day / RTTY RU, WWROF)
are skipped. `snrDb` is an estimate from the waterfall noise floor and `dtSec` is relative to the nominal 0.5 s start.

## Invariants
- RX device stays centred on the beacon IF (+ correction) so the spectrum always shows the whole NB transponder; the tuned
  frequency is the `inputFrequencyOffset` of the SSB channels relative to the beacon (same offset on RX and TX).
- The TX device centre and TX channel offset are never changed while `isTxActive()`; the change is applied by `onTxIdle()`.
- All station operations are serialized; a failed SDRangel call restores the previous tuning state.
- SDRangel is the only side effect, always through the client.
- Sideband inversion of the transponder is not modelled (spec formula: uplink = downlink - 8089.5 MHz); verify on air.

## Decoder interface
```js
{ mode: 'FT8', available: true, decode(pcmFrame, utcSlot, nowMs) { return [{ text, snrDb, dtSec, freqHz }]; /* or a Promise */ } }
```
`pcmFrame` is mono 12 kHz PCM (Int16 or Float32) from the RX audio tap (`rxAudio.addTap`). FT8/FT4 decoders buffer the frames of a UTC slot
(placed by `nowMs`) and return the slot's messages once, at 14.5 s (FT8) / 7.0 s (FT4) or when the next slot starts; they return `[]` otherwise.
The CW decoder is a stream: it returns `[{text, wpm, freqHz}]` chunks of newly decoded text. `reset()`, `flush()` and `close()` are optional.
A mode without a decoder gets the stub: `available:false`, and `decode()` throws `DecoderUnavailableError` (`code: 'decoder_not_available'`).
In production FT8/FT4 decoding runs in a worker thread (`useWorkers: true`) because an inline decode blocks the event loop for about a second.

## Testing
`node --test test/unit/modes.test.js test/unit/cw-decoder.test.js test/unit/ft8.test.js test/unit/decode-service.test.js`.
The decoder tests synthesize signals (CW with noise; FT8/FT4 with the built-in encoder plus seeded AWGN at -10 dB SNR in 2500 Hz); no audio fixtures or hardware.

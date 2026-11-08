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
- Decoders: `createUnavailableDecoder(mode)`, `createDecoderRegistry()`, `utcSlot(mode, nowMs)`, `DecoderUnavailableError`.

## Invariants
- RX device stays centred on the beacon IF (+ correction) so the spectrum always shows the whole NB transponder; the tuned
  frequency is the `inputFrequencyOffset` of the SSB channels relative to the beacon (same offset on RX and TX).
- The TX device centre and TX channel offset are never changed while `isTxActive()`; the change is applied by `onTxIdle()`.
- All station operations are serialized; a failed SDRangel call restores the previous tuning state.
- SDRangel is the only side effect, always through the client.
- Sideband inversion of the transponder is not modelled (spec formula: uplink = downlink - 8089.5 MHz); verify on air.

## Decoder interface
```js
{ mode: 'FT8', available: true, decode(pcmFrame, utcSlot) { return [{ text, snrDb, dtSec, freqHz }]; } }
```
`pcmFrame` is mono PCM (12 kHz for FT8/FT4), `utcSlot` comes from `utcSlot(mode)`. Register with `registry.register(decoder)` and pass
the registry to `createStation`. Until then the stub is returned: `available:false`, and `decode()` throws `DecoderUnavailableError`
(`code: 'decoder_not_available'`) so the UI can say so. To plug in:
- **ft8_lib** (C): build as a WASM or native addon, wrap `decode` around its slot decoder.
- **ggmorse** (CW): feed audio frames and return the decoded text.
- **SDRangel's FT8 demod**: add an `FT8Demod` channel to `CHANNEL_SETTINGS_KEYS` and read messages from its WebSocket/report instead of PCM.

## Testing
`node --test test/unit/modes.test.js`

# sdrangel

REST client, in-process mock and PTT driver for SDRangel's `sdrangelsrv` (default `http://127.0.0.1:8091`).

## Public API (`index.js`)
- `createSdrangelClient({baseUrl, timeoutMs=5000, fetch})`: `getInstance`, `listDeviceSets`, `getDeviceSet`, `getDeviceSettings`,
  `patchDeviceSettings`, `setCenterFrequency`, `setLoPpm`, `setTransverter`, `setRunning`, `getRunning`, `addChannel`,
  `getChannelSettings`, `patchChannelSettings`, `getChannelReport`, `getSpectrumSettings`, `patchSpectrumSettings`.
  Every method returns a promise; failures are `SdrangelError` with `kind` = `timeout | network | http | invalid` (and `status` for `http`).
- `ENDPOINTS`, `DEVICE_TABLE`, `CHANNEL_TABLE`, `deviceSettingsKey`, `NOT_IN_SDRANGEL_API`: the only place with API paths and settings keys; every entry has a `ref:` to `docs/references/sdrangel-swagger` or is listed as not in the API.
  Also `switchDevice` (body `{hwType, direction, sequence}`), `setRecording` (FileSink action), `getSpectrumServer`/`setSpectrumServer`.
- `createMockSdrangel({deviceSets?})`: `start()` (ephemeral loopback port, returns URL), `stop()`, `state`, `calls`, `delayMs`, `failNext(status)`.
  Default: device set 0 = RTLSDR RX, device set 1 = PlutoSDR TX (direction 1). Every write is validated against the reference YAML (swagger-lite): unknown key or wrong type gives 400 with details. `device/run` POST/DELETE return the state before the change, as in the swagger.
- `createSdrangelPttDriver({client, txDeviceSet})`: `setTx(on)` starts/stops the TX device; an "off" that SDRangel does not confirm
  (`state` still `running`) throws, which sends the PTT machine to LOCKOUT.

## Invariants
- One request, one timeout, no retries (the PTT watchdog and the beacon loop already re-drive state).
- Patches always carry `deviceHwType`/`channelType` + `direction`, read with a GET first, as SDRangel requires.
- Indices and frequencies are validated before any request is sent.

## Reference and refresh
The API facts come from `docs/references/sdrangel-swagger/` (ADR 0022). To refresh: replace the copy with the files of the SDRangel version in use, run `npm test`, then fix table entries and `ref:` lines that fail.
Not verifiable from the copy: HL2/Metis, LimeSDR and TestSource settings, `ChannelReport.yaml` (report wrapper names are inferred), the file suffix FileSink appends to `fileRecordName`.

## I/Q recording and playback

`iq.js` `createIqManager({dir, ...})` and `iq-routes.js` `createIqApi`: FileSink recording (name inside the BricoHams-managed `iq.dir`, started/stopped with the `FileSinkActions.record` action) and FileInput playback on the RX device set. List, delete and quota are done by BricoHams on that directory, with validated file stems. Invariant: never touches the TX device set or PTT. See ADR 0020 and 0022.

## Testing
`node --test test/unit/sdrangel.test.js test/unit/sdrangel-alignment.test.js`

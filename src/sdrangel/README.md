# sdrangel

REST client, in-process mock and PTT driver for SDRangel's `sdrangelsrv` (default `http://127.0.0.1:8091`).

## Public API (`index.js`)
- `createSdrangelClient({baseUrl, timeoutMs=5000, fetch})`: `getInstance`, `listDeviceSets`, `getDeviceSet`, `getDeviceSettings`,
  `patchDeviceSettings`, `setCenterFrequency`, `setLoPpm`, `setTransverter`, `setRunning`, `getRunning`, `addChannel`,
  `getChannelSettings`, `patchChannelSettings`, `getChannelReport`, `getSpectrumSettings`, `patchSpectrumSettings`.
  Every method returns a promise; failures are `SdrangelError` with `kind` = `timeout | network | http | invalid` (and `status` for `http`).
- `ENDPOINTS`, `DEVICE_SETTINGS_KEYS`, `CHANNEL_SETTINGS_KEYS`: the only place with API paths and settings keys.
- `createMockSdrangel({deviceSets?})`: `start()` (ephemeral loopback port, returns URL), `stop()`, `state`, `calls`, `delayMs`, `failNext(status)`.
  Default: device set 0 = RTLSDR RX, device set 1 = PlutoSDROutput TX.
- `createSdrangelPttDriver({client, txDeviceSet})`: `setTx(on)` starts/stops the TX device; an "off" that SDRangel does not confirm
  (`state` still `running`) throws, which sends the PTT machine to LOCKOUT.

## Invariants
- One request, one timeout, no retries (the PTT watchdog and the beacon loop already re-drive state).
- Patches always carry `deviceHwType`/`channelType` + `direction`, read with a GET first, as SDRangel requires.
- Indices and frequencies are validated before any request is sent.

## To verify against a real SDRangel
The paths and keys were written from memory of the SDRangel REST API and are **not verified**. Check them in
`sdrangel/swagger/sdrangel/api/swagger/swagger.yaml` (`/sdrangel/deviceset/{id}/device/settings`, `.../device/run`,
`.../channel`, `.../channel/{id}/settings|report`, `.../spectrum/settings`) and the per-device settings keys
(`rtlSdrSettings`, `plutoSdrOutputSettings`, ...). Also check: the response of `POST .../channel`, the TX hardware type names,
and whether stopping the TX device actually removes the carrier on every supported SDR.

## I/Q recording and playback (phase 13)

`iq.js` `createIqManager` and `iq-routes.js` `createIqApi`: FileSink recording and FileInput playback on the RX device set, WAV-like policy (config switch, owner switch, per-user quota). Client additions: `switchDevice`, `listIqFiles`, `deleteIqFile`. All endpoints and keys are marked **verify** against the swagger; the mock (`mock-server.js`) emulates them. Invariant: never touches the TX device set or PTT. See ADR 0020.

## Testing
`node --test test/unit/sdrangel.test.js`

# log: logbook, ADIF, LoTW and QRZ

QSO logbook stored in SQLite (`node:sqlite`), ADIF 3.1.4 import/export, LoTW upload through the TQSL command line and QRZ Logbook upload. Per-user secrets (the QRZ API key) are encrypted at rest.

## Files

| File | Role |
|---|---|
| `store.js` | `createLogStore`, `validateQso`, `LogError`. Schema + migrations, CRUD, duplicate detection, upload status, encrypted per-user secrets. |
| `adif.js` | `toAdif`, `parseAdif`, `importAdif`, `qsoToAdifRecord`, `field`. |
| `lotw.js` | `createLotwUploader`, `mapExitCode`, `defaultRunner`. |
| `qrz.js` | `createQrzClient`, `parseQrzResponse`. |
| `secrets.js` | `createSecretBox` (AES-256-GCM), `secretsKeyFromEnv`. |
| `routes.js` | `createLogApi`: the HTTP routes, wired in `src/server/app.js`. |

## HTTP API (role `operator` or `owner`; writes need `X-CSRF-Token`)

| Route | Purpose |
|---|---|
| `GET /api/log?limit&offset&call` | List, newest first (`{items,total}`). |
| `POST /api/log` | Add a QSO. 400 `validation` (with `fields`), 409 `duplicate` (with `existingId`; send `force:true` to store anyway). |
| `GET/PUT/DELETE /api/log/:id` | Read, edit, delete. Operators change only their own QSOs; owners any. |
| `GET /api/log/export.adi` | Whole logbook as an ADIF download. |
| `POST /api/log/lotw` `{ids}` | One TQSL run for up to 100 QSOs. 503 `lotw_not_configured` if `logbook.lotw` is unset. |
| `POST /api/log/qrz` `{ids}` | Upload with the caller's own QRZ key. 409 `qrz_key_missing`. |
| `PUT/DELETE /api/log/qrz-key` `{apiKey}`, `GET` | Write-only key. GET returns only `{hasKey, canStore}`. 503 if `BRICOHAMS_SECRETS_KEY` is unset. |

## Configuration

```json
"logbook": { "path": "./data/logbook.db", "lotw": { "tqslPath": "C:\\Program Files (x86)\\TrustedQSL\\tqsl.exe", "stationLocation": "QO-100 EA4AAA" } }
```

`BRICOHAMS_SECRETS_KEY` (env): 32 bytes, base64 (or 64 hex). Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. If it is lost, stored QRZ keys cannot be recovered; users must enter them again.

The database is opened on first use, not at startup.

## Invariants

- SQL is parameterized; the only interpolated identifiers come from fixed whitelists.
- The client cannot set `station_callsign`, `operator`, `created_by`, band, `prop_mode`, `sat_name` or upload statuses; they come from the session or the server.
- `band=13CM`, `band_rx=3CM`, `prop_mode=SAT`, `sat_name=QO-100` for every QSO. Uplink `freq` must be 2400.000-2400.500 MHz, `freq_rx` 10489.500-10490.000 MHz.
- RST: SSB `59` style (default 59), CW `599` style (default 599), FT8/FT4 a dB report -50..+50 (required, stored as `-07`/`+03`).
- Duplicate: same call and mode within 600 s.
- ADIF: field lengths are UTF-8 byte counts. FT4 is exported as `MODE=MFSK SUBMODE=FT4`, SSB as `SUBMODE=USB`; import reverses both.
- Secrets are bound to owner and name as GCM associated data. Plaintext keys are never logged, returned or written to disk.
- LoTW: `execFile` with an argument array and no shell; the temporary ADIF directory is always removed. The user installs TQSL and manages certificates, station locations and their passwords in TQSL; BricoHams never touches them. A password-protected certificate makes TQSL prompt and exit with code 1 (`cancelled`); use a certificate without a password for unattended uploads.

## Testing

`node --test test/unit/log-store.test.js test/unit/adif.test.js test/unit/lotw.test.js test/unit/qrz.test.js test/unit/secrets.test.js test/functional/log.test.js`

All collaborators are injectable (`runner` for TQSL, `fetch` for QRZ, `clock` for the store), so no network, TQSL or real accounts are needed.

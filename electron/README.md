# electron

Desktop shell (Windows, desktop Linux). `main.js` starts the server in-process on `127.0.0.1`
and shows it in a sandboxed BrowserWindow.

## Behaviour / invariants

- Config: `userData/config.json` (copied from `config.example.json` on first run; the help page opens).
  TLS and host are overridden to loopback HTTP; relative data paths resolve under `userData`.
- Secrets come from the environment or `userData/secrets.env` (`KEY=VALUE`), never from config.json.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no preload.
- Only `media` permission for the local origin; navigation limited to the local origin and
  `https://accounts.google.com`; new windows denied.
- Quit: `app.close()` releases the PTT holder (carrier off) before exit; single instance lock.

## Test

`test/unit/packaging.test.js` checks these settings statically. Run the app with `npm run desktop`.
Not verified: the tray icon is empty (no image asset yet), and Electron 45's bundled Node must
support `node:sqlite`.

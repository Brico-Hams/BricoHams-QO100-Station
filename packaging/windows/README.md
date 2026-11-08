# Windows packaging notes

## Build

`npm ci && npm run dist:win` produces an NSIS x64 installer in `dist/` (not one-click: you can
choose the directory; a desktop shortcut is created).

## Running in the background

The installed app is the Electron shell: it starts the BricoHams server in-process on
`127.0.0.1` and lives in the system tray (Open / Help / Quit). Closing the window only hides
it; use the tray menu **Quit** to stop the server (this cuts any carrier first). To start it at
login, put a shortcut to the installed executable in `shell:startup`.

Configuration is `%APPDATA%\BricoHams QO-100 Station\config.json` (copied from the example on
first run). Secrets (`GOOGLE_CLIENT_SECRET`, `BRICOHAMS_SECRETS_KEY`) go in `secrets.env` in the
same folder as `KEY=VALUE` lines, or in user environment variables. Never put them in config.json.

## SmartScreen

The installer is not code-signed, so Windows SmartScreen shows "Windows protected your PC".
Verify the `.sha256` published with the release, then choose **More info -> Run anyway**.
Signing needs a paid certificate; the release workflow disables certificate auto-discovery.

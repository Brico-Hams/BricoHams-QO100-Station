# hello-panel (example client plugin)

Part of [BricoHams](https://bricohams.org) · Amateur radio · Do it yourself.

Shows the RX frequency and mode in a panel on the Radio tab.

## Install

1. Copy this folder to `plugins/hello-panel/` (the server serves only `plugins/<name>/`, never `plugins/examples/`).
2. Add `"hello-panel"` to `plugins.enabled` in `config.json` and restart.

## API used

`export function activate(api)`; `api.registerPanel({title, render(container)})` and `api.subscribe('frequency' | 'mode', fn)`.
See "Plugin API" in `docs/DEVELOPER.md`.

# 0009. Packaging: Electron desktop and headless .deb

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
Two audiences: people at a desktop (Windows, desktop Linux) who want a double-click app, and people running a station on a server or Raspberry Pi who want a service. Node is not installed on most target machines, and we avoid trusting the system Node version.

## Decision
- **Desktop**: Electron shell (`electron/main.js`) that starts the server on loopback and shows the PWA in a sandboxed window with a tray icon. Windows NSIS x64 installer; Linux AppImage x64 and arm64. Config and secrets live in the user data directory.
- **Servers/Pi**: a headless `.deb` (amd64, arm64) that bundles Node 24 (`24.20.0`, SHA-256 verified against the official `SHASUMS256.txt` at build time), installs to `/opt/bricohams-qo100`, runs as the unprivileged `bricohams` user under a hardened systemd unit, and **never** enables TX nor starts the service on install. `install.sh` downloads the latest `.deb` and verifies its `.sha256`.
- GitHub Actions builds and publishes on `v*` tags; CI runs `npm test` on Windows, Ubuntu x64 and Ubuntu arm64.

## Alternatives considered
- **Docker image**: awkward for USB SDR access and for non-technical users.
- **pkg/SEA single binary**: `node:sqlite` and native deps complicate it; no GUI/tray.
- **Electron everywhere**: heavy for headless Pi servers.
- **System Node dependency in the .deb**: distro Node versions are too old.
- **Code-signing from day one**: needs paid certificates; deferred (Windows SmartScreen warns).

## Consequences
- Two packaging paths to maintain and test (checklist section A).
- Installers are unsigned; users verify SHA-256.
- Updating Node means a new release.
- Open items: Electron 45's `node:sqlite`, the tray icon asset, and the bundled Node version.

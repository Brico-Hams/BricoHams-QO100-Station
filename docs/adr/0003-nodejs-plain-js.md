# 0003. Node.js, plain JavaScript, no build step

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
The same code must run on Windows, Linux x64/arm64 (including Raspberry Pi), be readable by radio amateurs who are not professional developers, and be installable without a toolchain. The needs (HTTP, WebSocket, TLS, SQLite, crypto, test runner) are covered by Node 24 built-ins.

## Decision
Node.js 24, ES modules, plain JavaScript with JSDoc, no transpilation or bundling. Only two runtime dependencies: `openid-client` (certified OIDC) and `ws` (WebSocket). Everything else uses `node:` modules (`node:sqlite`, `node:test`, `node:crypto`, `node:http/https`).

## Alternatives considered
- **TypeScript**: stronger types, but adds a build step, tooling and a barrier to casual contributors. JSDoc gives documentation without a compiler.
- **Python**: good SDR ecosystem, but packaging for Windows and a real-time WS/audio server is heavier.
- **Go/Rust**: fast single binaries, but a smaller contributor pool in the community and no benefit given that DSP is delegated to SDRangel.
- **Express/Fastify and an ORM**: convenient but enlarge the supply-chain surface; the API is small.

## Consequences
- No build means the repository is the product; tests run with `node --test`.
- Fewer dependencies, fewer supply-chain risks, and a smaller `.deb`.
- No static type checking: discipline in validation and tests is required.
- Node 24 must be bundled in the installers (ADR 0009).

# 0007. `node:sqlite` logbook

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
We need a durable, queryable logbook (list, search by call, duplicate detection, upload status, per-user encrypted secrets) that works identically on Windows, x64 and arm64 without native compilation.

## Decision
Use Node's built-in `node:sqlite` (`DatabaseSync`) with WAL and a small migration table. Tables: `qsos`, `user_secrets`, `migrations`. The database opens lazily on first use. Interchange is ADIF 3.1.4 (export and import functions).

## Alternatives considered
- **better-sqlite3**: native addon needing prebuilt binaries or a compiler per platform; breaks the "no build" goal.
- **JSON/CSV files**: no atomicity, poor querying, easy corruption.
- **A server database (PostgreSQL)**: heavy for a single-station app.
- **ADIF file as primary store**: no indexed queries or metadata.

## Consequences
- No extra dependency; backups are a single file.
- `node:sqlite` requires Node 24 (and was experimental in some versions: pin Node in installers; Electron 45's bundled Node must be verified to include it).
- SQL is parameterised; schema changes need migrations.

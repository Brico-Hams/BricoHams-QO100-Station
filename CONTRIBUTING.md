# Contributing

> Español: para probar sin programar, usa [docs/testing/CHECKLIST.md](docs/testing/CHECKLIST.md) y [REPORT-TEMPLATE.md](docs/testing/REPORT-TEMPLATE.md).

Thanks for helping. Read [docs/DEVELOPER.md](docs/DEVELOPER.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.

## Ways to contribute

- Run the manual checklist on real hardware and send a report (the most valuable contribution right now, see the `verify` list in DEVELOPER.md).
- Report bugs with version, OS, SDR model, and the (redacted) log. Never paste secrets, cookies or `config.json` containing them.
- Security issues: follow [SECURITY.md](SECURITY.md), not a public issue.
- Code, docs, translations.

## Rules for code

- Node 24, ES modules, plain JavaScript. No TypeScript, no build step, **no new dependencies** without an ADR (runtime deps are `openid-client` and `ws` only).
- JSDoc on every exported function; comments explain non-obvious *why* only. Code, comments and identifiers in English.
- Validate all input at trust boundaries; never hardcode or log secrets.
- Anything that can key the transmitter must keep the fail-safe invariants of [ADR 0005](docs/adr/0005-ptt-fail-safe-state-machine.md).
- Update the module's `src/<module>/README.md` when its public API changes.

## Tests are required

- Every behaviour change or bug fix needs a test in `test/unit/` or `test/functional/`.
- Tests must not need network, hardware, real Google or real SDRangel. Use the fakes in `test/fixtures/` and the mock in `src/sdrangel/mock-server.js`.
- `npm test` must pass on Windows, Linux x64 and Linux arm64 (CI runs all three).

## Commits and pull requests

- [Conventional Commits](https://www.conventionalcommits.org/): `feat(ptt): ...`, `fix(log): ...`, `docs: ...`, `test: ...`, `chore: ...`. Scope = module folder. Breaking changes: `!` and a `BREAKING CHANGE:` footer.
- One logical change per PR, with a description of how you tested it (and on what hardware, if any).
- Sign off every commit (`git commit -s`): this is the [Developer Certificate of Origin](https://developercertificate.org/) 1.1, certifying you may submit the work under the project's licence.

## Licence

The project is **GPL-3.0-or-later**. By contributing you agree that your contribution is licensed under the same terms. Do not submit code you cannot
license this way (for example copied from proprietary software such as SDR Console, or from licences incompatible with GPL-3.0). Add third-party
components to [NOTICE.md](NOTICE.md).

# Copilot instructions — BricoHams

## Reference repositories (source of truth)

- Station: https://github.com/Brico-Hams/BricoHams-QO100-Station
- Remote-Listen: https://github.com/Brico-Hams/BricoHams-QO100-Remote-Listen

Always use the `Brico-Hams` organisation in links, install scripts, package metadata and docs
(the old `bricohams`/`BricoHams` org name is obsolete; GitHub only redirects it).
When a change in one project affects the other (shared branding, OpenWebRX listening, docs), check the other repository too.

## Conventions

- Code, comments and commit messages in English; user help and the manual in Spanish first.
- Every deliverable carries the BricoHams branding: `branding/bricohams_horizontal.png`, palette navy #12263f, orange #e8871e,
  grey #5b6b7b, charcoal #22262b, tagline "Radioafición · Hazlo tú mismo", https://bricohams.org,
  authors Anatol EA5KAO, Diego EA5JEF, Pedro Roca Molina.
- Never commit secrets (`*.env`, real `settings.json`, credentials) nor third-party copyrighted material.

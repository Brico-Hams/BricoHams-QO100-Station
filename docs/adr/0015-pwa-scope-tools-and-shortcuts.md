# 0015. PWA scope tools and keyboard shortcuts

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
Zoom, spectrum averaging, peak hold, waterfall palettes/contrast and keyboard shortcuts are standard in the compared programs. The PWA drew a fixed spectrum and had only Space for PTT.

## Decision
- All scope processing is client-side in `scope-math.js` (palettes classic/grayscale/fire/viridis, contrast, linear-power averaging, peak hold, zoom 1-16x). Preferences are stored in `localStorage`. The server's spectrum feed is unchanged.
- The band plan overlay uses `GET /api/bandplan` and is drawn over the spectrum.
- `shortcuts.js` holds a single table of bindings; `features.js` runs them. **Space is reserved for PTT and handled only by `app.js`.** The shortcut handler ignores `Space`, key repeats in text fields, and Ctrl/Alt/Meta combinations, and acts only for operator-only actions when the user is an operator. Shortcuts never call PTT, turn or microphone code; `features.js` reaches the application through a frozen bridge, `BHApp`, that exposes no PTT or microphone function. Unit tests enforce both properties.
- The user can disable shortcuts in Settings; the table is shown there for accessibility.
- No inline scripts or styles (CSP `script-src 'self'; style-src 'self'`); the service worker cache is bumped.

## Alternatives considered
- **Server-side averaging**: adds load and latency for per-user views.
- **Shortcuts for TX**: rejected; keying must keep the hold/turn rules of ADR 0005.

## Consequences
- Screen-reader users get labelled controls and the shortcut list.

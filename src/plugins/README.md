# src/plugins — Plugin API (server side)

![BricoHams](../../branding/bricohams_horizontal.png)

BricoHams · Amateur radio · Do it yourself · https://bricohams.org — authors Anatol EA5KAO, Diego EA5JEF, Pedro Roca Molina.

There are **no server-side code plugins** (see `docs/adr/0018-plugin-api.md`). The server offers only:

1. `static.js` — `resolvePluginFile(root, enabled, pathname)` maps `/plugins/<name>/<file>` for **enabled** client plugins only
   (segment whitelist: no `..`, no dotfiles, extension allow-list).
2. `webhooks.js` — `createWebhookDispatcher(opts)` and `verifySignature(...)`: an outgoing, owner-configured event feed.

## Webhook contract

Events: `decode`, `spot`, `qso_logged`, `ptt_state` (read-only information, never a command channel).
Request: `POST` JSON with headers `X-BricoHams-Timestamp` and `X-BricoHams-Signature: sha256=<hex>`, where the digest is
HMAC-SHA256 over `"<timestamp>.<body>"` using the endpoint secret (taken from the environment variable named by `secretEnv`).
Receivers must reject stale timestamps. Retries use exponential backoff; redirects are refused; logs contain the host only.

## Invariants

- Disabled unless `webhooks.enabled` and at least one endpoint; `https` required except loopback.
- Payloads never contain tokens, cookies or secrets.
- Nothing here touches PTT.

## Testing

`node --test test/unit/phase13.test.js test/functional/phase13.test.js`.

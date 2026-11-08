# 0004. Google OIDC, allowlist and roles

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
A station exposed to the internet must know who is at the controls and must let the owner decide who may listen, operate or administer. Operators are friends and club members, usually with Google accounts. The owner should not store passwords.

## Decision
- Sign in with Google OpenID Connect (authorization code, PKCE S256, `state`, `nonce`), using `openid-client`. The owner creates their own OAuth client.
- An **allowlist** in the configuration maps each verified email to a callsign and a role: `listener` (receive only), `operator` (tune, TX, log), `owner` (everything, including LOCKOUT reset from the local machine).
- Sessions are server-side, in memory, with a `SameSite=Strict` cookie and a CSRF token on state-changing requests.
- Google tokens are validated again in our code (`nonce`, `exp`, `sub`, `email_verified`, allowlist) so no single library check is trusted alone.

## Alternatives considered
- **Local passwords**: we would own password storage, resets and brute-force defence; rejected.
- **Client TLS certificates**: strong but unusable for casual remote users and mobile browsers.
- **Other IdPs (GitHub, Microsoft)**: possible later; Google was chosen for reach. `google.issuer` is configurable but only Google is supported.
- **Open registration with approval**: more attack surface and moderation work.
- **Database-backed users**: the allowlist file is simpler and auditable, at the price of restart-to-apply.

## Consequences
- Each deployment needs a Google Cloud OAuth client (documented step by step in Spanish help).
- Account security depends on Google (2-step verification advised).
- Restarting the server signs everybody out; allowlist changes need a restart.
- Audit and logbook entries carry the callsign from the allowlist, never one supplied by the client.

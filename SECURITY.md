# Security Policy

## Supported components

The whole monorepo (`apps/panel`, `apps/bot`, `apps/relay`, `packages/shared-types`) is
treated as one security boundary. Always run the latest `main`.

## Reporting a vulnerability

Open a **private security advisory** via GitHub (Security → Advisories → New draft) rather
than a public issue. Include: affected component, endpoint/file, reproduction steps, and
impact. You will get an acknowledgement within 7 days. Please do not test against
deployments you do not own.

## Security model (what you can rely on)

- **Four isolated auth domains** on the Panel API: admin session (cookie `HttpOnly +
  Secure + SameSite=Lax` + CSRF token), bot bearer (scoped `api_clients`), relay bearer
  (exactly one active token, hash-only at rest), subscription bearer.
- **Append-only ledger**: `audit_logs` and `usage_reports` are protected by SQLite
  triggers — UPDATE/DELETE are rejected by the database itself.
- **Credential confidentiality**: upstream credentials are encrypted with AES-256-GCM;
  the DEK exists only as a Panel Worker secret. Plaintext never leaves the three
  contract-permitted contexts (encrypted at rest, decrypted to a relay *you* assigned,
  masked display in the admin UI).
- **Fail-closed bot**: the Telegram bot serves only allowlisted owner IDs and fails closed
  when the Panel is unreachable.
- **Rate limiting** on all sensitive API domains (KV-backed sliding windows) with
  `429 + Retry-After` and login lockout.
- **Strict SPA CSP** (`default-src 'self'`, no inline scripts), `nosniff`, `DENY`,
  `no-referrer` on API and static responses alike.
- **Secret hygiene**: `.secrets/`, `.dev.vars`, `.env` are gitignored; the repo ships a
  scanner (`scripts/secret-scan.py`) that verifies the working tree *and* the full git
  history stay free of real credential values. Run it in CI or locally after changes.

## Operator responsibilities (self-hosting)

- Set `ADMIN_PEPPER` and `DATA_ENCRYPTION_KEY` to fresh random 32-byte values and back
  them up — losing the DEK makes existing encrypted upstream credentials unrecoverable.
- Serve the Panel only over HTTPS via your own Custom Domain.
- Keep the Telegram bot allowlist limited to your own numeric user ID(s).
- Rotate relay tokens after staff changes (`POST /api/v1/relays/:id/token`); old tokens
  are rejected immediately by design.

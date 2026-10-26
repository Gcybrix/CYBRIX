# CYBRIX Security Guide

## Enforced in code
- Tokens live only in **Cloudflare Secrets** (`secret_text` bindings) — never in plain vars, code, logs or the repo.
- `secrets.local.env` is gitignored; `.env.example` ships without real values.
- Telegram webhook uses `secret_token` — wrong header ⇒ **403** (verified).
- Update idempotency via `webhook_events` (Telegram retries are harmless — verified).
- All D1 queries are parameterized (no SQL injection); output is escaped (no XSS); panel sends CSP + nosniff + frame-DENY.
- Data isolation: non-owner panel users only ever see their own rows.
- Credit spend is atomic (D1 batch + balance guard) — race-safe.
- Audit events for sensitive actions (publish, spend, grant, login, errors) — never contain tokens.

## Honest limits (important)
- Code obfuscation is **not encryption**. If a customer controls their own Cloudflare account, no mechanism is unbreakable; a policy service under CYBRIX control is on the roadmap for enforceable policies.
- Multi-account human identity cannot be verified with certainty on Telegram; technical controls (unique ID, membership, rate, risk score) are applied and remaining risk is disclosed.
- Telegram does not reliably notify when a member leaves; membership is re-checked before finalizing results.

## Token rotation (after delivery)
1. BotFather → `/mybots` → API Token → Revoke (both bots) → update `secrets.local.env` → re-run `bun scripts/deploy.ts`
2. GitHub → Developer settings → PAT → Regenerate
3. Cloudflare → My Profile → API Tokens → Roll
4. If any token leaked publicly: revoke immediately and stop using it.

## Builder bot
- Customer tokens persist only during the install wizard and are **deleted afterwards**.
- Recommended minimal customer Cloudflare token: Workers Scripts Edit + D1 Edit + Accounts Read.
- Tokens are never printed in full (masked: first 6 chars).

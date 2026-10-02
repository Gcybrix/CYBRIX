# cybrix-bot — CYBRIX Telegram Management Bot

Cloudflare Worker thin client over the **CYBRIX REST API** (`/api/v1`, Prompt 4).
No D1 access, no local business logic, no independent database — everything runs
through the official API with a scoped `api_clients` token (Prompt 6 §1/§3).

```text
Telegram ──webhook(secret_token)──▶ cybrix-bot Worker ──Bearer(api_clients)──▶ CYBRIX Panel API ──▶ D1/KV/Secrets
                                          │
                                          └── reports ──▶ Operator's Telegram chat (TELEGRAM_REPORT_CHAT_ID)
```

- Runtime: **Cloudflare Workers + Hono + KV** (Workers-compatible deps only, Prompt 6 §21)
- Language of v1 messages: English (matches Prompt 6 report samples); i18n is a future extension
- Status: **implemented, 64/64 tests passing** — `npm test`

---

## 1. Setup (Owner runbook)

### 1.1 Create the bot's API client in the panel
Panel → Settings → Security → API Clients → Create. Grant the scopes the bot needs
(read-only set — see `packages/shared-types/src/scopes.ts → BOT_REQUIRED_SCOPES`).
The raw token is shown **once** — put it straight into a secret:

```bash
wrangler secret put CYBRIX_BOT_API_TOKEN        # paste the raw api_clients token
```

> **GAP-B1:** the bot requires the `telegram_admins:read` scope to read the allowlist
> (Prompt 4 provides no bot-readable allowlist path). Until the panel implements it,
> the bot **fails closed** (all commands denied + CRITICAL report). Register the scope
> when implementing Prompt 5 — do not change any other contract.

### 1.2 Telegram secrets (Owner-only, never in git)

```bash
wrangler secret put TELEGRAM_BOT_TOKEN          # from @BotFather
wrangler secret put TELEGRAM_WEBHOOK_SECRET     # random ≥16 chars, used by setWebhook secret_token
# non-secret vars live in wrangler.toml [vars]: CYBRIX_API_BASE_URL, LOG_LEVEL
# report destination (chat id of the owner's admin chat):
wrangler secret put TELEGRAM_REPORT_CHAT_ID     # or set as a [vars] entry
```

Set the KV binding id in `apps/bot/wrangler.toml` (`wrangler kv namespace create`).

### 1.3 Deploy + wire the webhook

```bash
npm run bot:deploy
npm run bot:webhook:set -- https://cybrix-bot.<account>.workers.dev/webhook
npm run bot:webhook:info    # verify
```

`tools/webhook.mjs` reads `TELEGRAM_BOT_TOKEN` from the environment only and redacts
secrets from all output. `allowed_updates` is pinned to `message` + `callback_query`.

### 1.4 Local development

```bash
cp .dev.vars.example .dev.vars   # fill in; .dev.vars is gitignored
npm run dev                      # wrangler dev on :8787
```

---

## 2. Commands

| Command | Scope dependency | Behavior |
|---|---|---|
| `/start` | — | Authorization → main menu (inline keyboard) |
| `/help` | — | Command reference |
| `/status` | `dashboard:read` | Users/Configs/Relays/Subscriptions counts + traffic today/7d/30d |
| `/users` | `users:read` | Paginated list (5/page): status, traffic used/limit, expiry |
| `/user <username>` | `users:read` | User detail: traffic %, reset day, expiry, created |
| `/config [username]` | `configs:read` | Config list with XOR path label (`→ upstream / → relay / no path`) |
| `/subscription <username>` | `subscriptions:read` | Subscription list — **tokens/URLs are never rendered** |
| `/relays` | `relays:read` | Health badges: 🟢 ONLINE / 🟡 DEGRADED / 🔴 OFFLINE / ⚪ DISABLED |
| `/stats` | `dashboard:read` | Usage summary (today/7d/30d, active relays) |
| `/audit` | `audit:read` | Recent audit events (read-only, paginated) |
| `/settings` (button) | `settings:read` | Read-only settings view; CF Secrets listed as "secret-managed" only |

Missing scopes degrade **gracefully** (`⛔ not permitted` + a deduped INFO report) —
that is the OD-5 abstraction behavior required by Prompt 6 §24. All API failures map
through the Prompt 4 error contract to safe messages (`src/api/errors.ts`).

---

## 3. Security model

- **Webhook:** constant-time `X-Telegram-Bot-Api-Secret-Token` check; invalid/missing → 401,
  body never processed. Valid → 200 immediately, update processed via `waitUntil`.
- **Authorization:** TELEGRAM **USER ID** against the panel allowlist (`telegram_admins`,
  60s KV cache). Chat IDs are only message targets. Unknown users get one generic line —
  zero system info.
- **Fail-closed:** if the allowlist cannot be verified (network/401/403), ALL management
  commands are denied and a CRITICAL report is fired.
- **Re-auth on every callback:** forged callback data is rejected by a strict parser;
  surviving views are read-only and re-authorized anyway.
- **Anti-spam:** per-user 20 commands/min (KV), update_id dedup, callback throttling.
- **Redaction:** every outbound text (user replies, operator reports, logs) passes
  `src/reporting/redact.ts`. Secret-shaped values (bot tokens, `cyb_*` tokens, Bearer,
  hex/b64 blobs, `password=…` pairs) can never appear in Telegram messages or logs.
- **No secret storage:** the bot keeps nothing but ephemeral KV state (sessions, counters,
  dedup keys, allowlist cache) — all TTL-bounded, all secret-free.

## 4. Reporting layer (reusable by future stages)

`src/reporting/reporter.ts` exports fire-and-forget helpers that later stages import:

```ts
import { reportStageStarted, reportStageCompleted, reportStageFailed } from '../reporting/reporter'
// also: reportDeployment / reportRelayHealth / reportUsage / reportSecurity / fireReport
```

Severity ladder: `INFO → SUCCESS → WARNING → ERROR → CRITICAL`
(dedup + ×5 aggregation for non-critical; CRITICAL never deduped, hard-capped 10/min to
protect the Telegram API, drops are logged). Telegram outages → bounded retry (3 attempts,
backoff, honors `retry_after`) → structured redacted log. **Notification failure never
breaks the calling flow** (`Notification failure != Core system failure`).

Destination: `TELEGRAM_REPORT_CHAT_ID` (v1: one chat; comma-separated list already supported
by `reportDestinations()` — the multi-destination seam of Prompt 6 §19).

## 5. Development

```bash
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest — 64 tests across 8 files
```

Test matrix (Prompt 6 §22): webhook secret (valid/invalid/missing) · allowlist
(authorized/unauthorized/backend-failure) · every command · API errors
(401/403/404/409/422/429/500) · reporting (severities, dedup, aggregation, outage+retry,
redaction) · KV session TTL · update dedup · throttle. See `docs/DESIGN.md` for the
architecture reference and the full deliverables map.

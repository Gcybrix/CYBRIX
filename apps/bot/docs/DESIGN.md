# cybrix-bot — Design Reference (Prompt 6 deliverables map)

Aligned with: Prompt 2 (Architecture) · Prompt 3 (Database Schema) · Prompt 4 (REST API
Contract) · Prompt 5 (Web Admin Panel). Conflict rule applied: newest locked decisions win.

---

## 1. Telegram Bot Architecture (deliverable 1)

```text
┌─────────────┐  HTTPS + secret_token   ┌──────────────────┐  Bearer (api_clients)  ┌───────────────┐
│   Telegram   │ ──────────────────────▶ │  cybrix-bot      │ ─────────────────────▶ │  CYBRIX Panel │
│  Bot API     │ ◀────────────────────── │  (CF Worker)     │ ◀───────────────────── │  API /api/v1  │
└─────────────┘   sendMessage/answer     └───────┬──────────┘   GET-only, envelope     └──────┬────────┘
      ▲                                          │ KV (state, TTL)                            │
      │                                          ▼                                            ▼
      │                                  telegram:session:{uid},                    D1 · KV · Secrets
      │                                  tg:rl:{uid}, tg:upd:{id},
      └── reports to Operator chat       tg:allowlist, rep:*
          (TELEGRAM_REPORT_CHAT_ID)
```

Layered request path (mirrors Prompt 4 ch.2 discipline):

`Webhook secret gate → update dedup → actor/chat extraction → per-user throttle →
allowlist authorization (fail-closed) → command/callback dispatch → panel API (read-only)
→ render (escape + redact + clamp) → Telegram delivery (bounded retry)`.

| Module | Responsibility |
|---|---|
| `src/index.ts` | Hono app: `GET /healthz`, `POST /webhook`, 404/500 handlers |
| `src/telegram/security.ts` | Constant-time webhook secret compare |
| `src/handlers/update.ts` | Dedup, routing, exception-safe orchestration |
| `src/handlers/commands.ts` | Slash commands + API-failure UX + security reporting |
| `src/handlers/callbacks.ts` | Inline keyboard views; re-authorization on every callback |
| `src/handlers/views.ts` | Renderers (status/users/relays/stats/audit/settings/…) |
| `src/auth/authorize.ts` | Allowlist flow (SSOT = panel `telegram_admins`) |
| `src/api/client.ts` | Prompt 4 envelope client (Bearer, request id, GET-retry) |
| `src/api/panel.ts` | Typed read-only service layer |
| `src/api/errors.ts` | ApiError + user-safe message mapping |
| `src/state/session.ts` | Conversation state (KV, TTL 600s) |
| `src/state/rate.ts` | Per-user throttle (KV, 20/min) |
| `src/reporting/reporter.ts` | TelegramReporter (deliverable 11) |
| `src/reporting/redact.ts` | Redaction rules (deliverable 18) |
| `src/telegram/{format,send,keyboard,types}.ts` | Telegram-safe rendering & transport |

## 2. Webhook Design (deliverable 2)

- Route `POST /webhook`; Telegram `secret_token` arrives as
  `X-Telegram-Bot-Api-Secret-Token`; validated in constant time **before** body parse.
- Missing/invalid → `401` (no processing, no echo of why in the body beyond status).
- Valid → `200 {"ok":true}` immediately; processing scheduled with `ctx.waitUntil` so slow
  panel calls never cause Telegram retry storms.
- Malformed JSON → `400`. `update_id` dedup (KV TTL 120s) guards duplicate deliveries.
- `GET /healthz` → `{ok, service}` only — no version, no internals.
- Setup tool: `tools/webhook.mjs` (`set <url>` / `delete` / `info`) with `allowed_updates`
  pinned to `message`+`callback_query`; token read from env only, output redacted.

## 3. Authentication Flow (deliverable 3)

Bot → Panel auth = **api_clients Bearer token** (Prompt 6 §3):

1. Owner creates the API client in the panel; raw token shown once → `wrangler secret put
   CYBRIX_BOT_API_TOKEN`.
2. Worker reads it from env; sends `Authorization: Bearer …` + `X-Request-Id` (UUID) per call.
3. Token lives ONLY as SHA-256 hash in panel D1 (Prompt 3); rotate = new token + secret update.
4. The bot NEVER uses Admin Sessions or Relay Tokens. Token never logged (redactor + no-URL logging).

## 4. Telegram Allowlist Flow (deliverable 4)

`from.id` (USER id — chat ids are never used for authorization) → KV cache
(`tg:allowlist`, TTL 60s) → miss ⇒ `GET /api/v1/telegram-admins` (scope
`telegram_admins:read` — **GAP-B1**) → id ∈ list?

- allowed → dispatch
- denied → single generic line `⛔ You are not authorized…` + WARNING security report (deduped)
- backend error (network/401/403) → **FAIL-CLOSED**: same generic denial + CRITICAL report
  with remediation hint (`Check bot API token / telegram_admins:read scope (GAP-B1)`)

Unauthorized users can never discover whether the system exists, how many admins exist,
or which commands exist.

## 5. Command Specification (deliverable 5)

See `README.md §2` for the full table (10 commands). Design rules:

- Read-only v1 — no mutation endpoints are called, matching "no business logic in the bot".
- Optional commands (`/user`, `/config`, `/subscription`) are implemented because Prompt 4
  supports them; they resolve users via `GET /users?q=` (exact-match preference).
- Lists: 5/page max, cursor pagination (Prompt 4 ch.8), forward-only `Next` + `Refresh`.
- Unknown commands → hint, not error. Missing argument → usage line.

## 6. Inline Keyboard Specification (deliverable 6)

Main menu: `📊 Dashboard · 👥 Users · 🚀 Relays · 📈 Usage · 📋 Audit · ⚙️ Settings ·
🔌 Configs · ❓ Help`.

Callback data contract: `v:<view>[:<cursor>]` with registry views
`menu|dash|users|relays|stats|audit|cfg|settings|help`; parser is a strict regex
(length-capped cursor, case-sensitive) — anything else is "Expired or invalid action".
**Every callback re-checks the allowlist** before rendering (Prompt 6 §6). Callbacks edit
the bot message in place (`editMessageText`) with fallback to a fresh message.

## 7. Conversation State Design (deliverable 7)

Key `telegram:session:{user_id}` (KV, TTL 600s), payload `{userId, view, cursor?, updatedAt}`.
Secret-free by construction (enforced by test). v1 views are cursor-self-contained, so the
store is (a) the seam for future multi-step flows, (b) a refresh hint. Operations are
best-effort — KV failure never breaks a command. Expiry/cleanup: TTL + explicit clear on
`/start`.

## 8. API Integration Layer (deliverable 8)

`src/api/client.ts`: envelope-native (`{data, meta}` / `{error:{code,message,details,
request_id}}`), `X-Request-Id` per call, 15s timeout, GET-only retry (1×, on 503/429/network,
honors `Retry-After` ≤5s) — the Prompt 5 ch.32 policy applied to a bot. `src/api/panel.ts`
wraps Prompt 4 endpoints with shared-types. Byte counters stay decimal strings end-to-end;
BigInt math only in the display layer.

## 9. Error Handling (deliverable 9)

`userMessageForApiError()` maps all 11 Prompt 4 codes (plus transport) to fixed UI lines;
raw backend messages and internals never reach users (`DO-NOT-LEAK` asserted in tests).
401 → CRITICAL "rotate CYBRIX_BOT_API_TOKEN" report; 403 → deduped INFO "grant scopes".
The update router is exception-safe: worst case = logged ERROR report + generic user line;
the webhook itself always answered Telegram.

## 10. Rate Limiting (deliverable 10)

Per-user 20 cmd/min (KV counter, TTL 60s) with a calm `⏳ Too many commands` reply; update
dedup (120s); report-side dedup/aggregation (§12 below); CRITICAL hard cap 10/min. KV
counters are best-effort (eventual consistency) — abuse-tolerant by design, consistent with
the panel's own KV limiter (Prompt 4 ch.13).

## 11–16. Reporting System (deliverables 11–16)

`src/reporting/reporter.ts` — the single delivery layer, zero business logic:

- **Severity ladder:** `INFO ℹ️ / SUCCESS ✅ / WARNING ⚠️ / ERROR ❌ / CRITICAL 🚨`
- **Core:** `deliverReport()` → dedup (300s window, ×N aggregation every 5th occurrence)
  → format (HTML, escaped, redacted, Time + Request ID + Component) →
  `sendAll(destinations)` → bounded retry (3 attempts, backoff, honors `retry_after`) →
  failure lands in structured logs (redacted).
- **Stage Reporting (12):** `reportStageStarted / reportStageCompleted / reportStageFailed`
  — the exact Prompt 6 §9 message shapes; future stages import these instead of
  re-implementing (Prompt 6 §26: "گزارش Stageهای بعدی از همین لایه استفاده کنند").
- **Deployment (13):** `reportDeployment {service, version, environment, status}`.
- **Relay (14):** `reportRelayHealth {relay, status, lastHeartbeat, usage}` —
  severity derived (ONLINE→INFO, DEGRADED→WARNING, OFFLINE→ERROR).
- **Usage (15):** `reportUsage {period, users, configs, traffic, activeRelays}`.
- **Security (16):** `reportSecurity {type, actor, action, resource, requestId}` —
  fired on unauthorized command attempts and webhook anomalies.
- **Destination (Prompt 6 §19):** `TELEGRAM_REPORT_CHAT_ID`; `reportDestinations()` already
  accepts a comma-separated list → multi-destination is a config change, not a redesign.
- **No central service (Prompt 6 §20):** reports travel user-bot → user-chat; the CYBRIX
  project itself has no server, ever.

## 17. Secret Management (deliverable 17)

All four secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CYBRIX_BOT_API_TOKEN`,
`TELEGRAM_REPORT_CHAT_ID`) live in CF Secrets / `.dev.vars` (gitignored; `.dev.vars.example`
holds placeholders only). `wrangler.toml` contains non-secret vars and a placeholder KV id.
Nothing secret is ever hardcoded, echoed, logged, or stored in KV. `.gitignore` blocks
`.dev.vars*`, `.wrangler/`, `dist/`.

## 18. Redaction Rules (deliverable 18)

Ordered rule pipeline (auth headers → bot-token shape → `cyb_*` prefixes → sensitive
key=value → long hex → long base64url), applied until stable, at **every** outbound
chokepoint: user replies, operator reports, structured logs. The never-send list of
Prompt 6 §12 is enforced by tests (`redaction.test.ts`, `reporting.test.ts`).

## 19. Testing Plan (deliverable 19)

Vitest, no Workers runtime needed (`test/helpers.ts` = KV mock + fetch router + fixtures).
64 tests / 8 files covering Prompt 6 §22 exactly:

| Area | Coverage |
|---|---|
| Webhook | valid / invalid / missing secret, malformed JSON, healthz, 404 |
| Authentication | authorized, unauthorized (generic-only response, security report), backend-failure fail-closed ×2, allowlist cache |
| Commands | /start /help /status /users /relays /stats /audit + /user /config /subscription, unknown, message limits |
| API errors | 401/403/404/409/422/429/500 mapped; no leak; 429 GET-retry; network fail-closed |
| Reporting | 5 severities, dedup, ×5 aggregation, CRITICAL-no-dedup, outage→3 attempts→log, KV-failure swallow, redaction |
| Security | secret-shape scan of messages & logs; KV session secret-free |

## 20. Cloudflare Worker Integration (deliverable 20)

Hono (Workers-native), `executionCtx.waitUntil` for async work, KV binding for ephemeral
state, no Node-only dependencies, `compatibility_date 2025-03-01`, observability enabled.
Deploy: `npm run bot:deploy`; webhook wiring: `tools/webhook.mjs`.

## 21. Monorepo Integration (deliverable 21)

`apps/bot` + `packages/shared-types` (npm workspaces). The bot imports API types/scopes/
endpoint constants from `@cybrix/shared-types` — the same package Prompt 5's panel will
consume. Telegram code lives ONLY in `apps/bot` (Prompt 6 §23); `apps/panel` and
`apps/relay` are documented stubs for their future phases.

## 22. Documentation (deliverable 22)

This document + `README.md` (runbook) + root `README.md` (repo rules). i18n of bot
messages is an acknowledged future extension (v1 English, consistent with Prompt 6 samples).

---

## GAP Register (Prompt 6 §26 — nothing changed silently)

| GAP | Need | Status |
|---|---|---|
| **GAP-B1** | Bot must read `telegram_admins` (Prompt 4 has no bot-readable path). Proposed **additive scope** `telegram_admins:read` (OD-5 amendment). | Registered; bot **fails closed** until the panel grants it. No other contract touched. |

## Open Decision handling (Prompt 6 §24)

| OD | Bot impact | Implementation |
|---|---|---|
| OD-5 Bot Scopes | Command → scope mapping | `BOT_REQUIRED_SCOPES` registry; 403 → graceful degradation + deduped INFO report |
| OD-1 Subscription Format | `/subscription` output | Metadata only; no format assumptions; tokens never rendered |
| OD-2 Subscription URL | Delivery URL display | Not displayed; URL shown once by panel at issue/rotate only |
| OD-8 Token Prefix | Redaction | `cyb_(rly\|apc\|sub)_` pattern ready; treated as opaque otherwise |

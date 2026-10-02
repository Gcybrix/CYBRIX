# @cybrix/panel

Web Admin Panel — Cloudflare Worker (**Hono** + no-build SPA) with Cloudflare D1 as the
database and KV for sessions, CSRF, rate limiting and temporary state.

**Status: implemented, production-verified.** Deployed live with real evidence
(health endpoints, 79/79 production smoke, full auth/webhook matrices).

## Layout

```text
src/
  worker.ts        entry — auth gates, error envelope, security headers, cron
  routes/          auth, users, upstreams, relays, configs, subscriptions,
                   usage, audit, settings, telegram-admins, api-clients
  lib/             credential encryption (AES-256-GCM), audit sanitizer,
                   cursor pagination, rate limiting, errors
migrations/        0001_core … 0005_triggers (13 tables, 20 indexes, 14 triggers)
public/            Web Admin SPA (same-origin, strict CSP, no build step)
```

## Key properties

- **Standard envelope** on every response: `{ ok, data | error }` with a stable error-code
  set; `POST`/`PUT`/`DELETE` require the CSRF header for session auth.
- **XOR assignment model** — a config points either at a direct upstream or at a relay,
  never both (CHECK constraint in D1).
- **Sync data-plane** for relays: full + incremental (cursor) sync, tombstone delivery,
  heartbeat with `should_sync`, idempotent usage ingest (`UNIQUE(relay_id, report_id)`).
- **Monthly traffic reset** via the Worker cron (`17 3 * * *` default): resets due
  subscriptions based on per-subscription `traffic_reset_day` (or the global default),
  `actor=system`, idempotent under duplicate cron invocations.
- **First-owner bootstrap**: `GET /api/v1/setup/status` → `POST /api/v1/setup` (works only
  while zero owners exist; then permanently closed).

## Commands

```bash
npm run dev                   # wrangler dev (local D1/KV)
npm run deploy                # wrangler deploy (uses wrangler.toml)
npm run db:migrate:remote     # apply migrations to the remote D1
```

Prefer `bash scripts/deploy-cf-panel.sh` (repo root) for a full first deployment — it
creates D1/KV, patches `wrangler.toml` IDs, migrates remotely, deploys and sets secrets.

## Secrets (Worker secrets — never in wrangler.toml)

| Secret | Purpose |
|---|---|
| `ADMIN_PEPPER` | pepper mixed into password hashing |
| `DATA_ENCRYPTION_KEY` | AES-256-GCM DEK for upstream credentials (base64, 32 bytes) |

## Health

- `GET /healthz` — liveness (no auth, CORS `*` per contract)
- `GET /readyz` — checks D1 + KV, `{"checks":{"d1":"ok","kv":"ok"}}`

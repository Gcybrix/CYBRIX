# CYBRIX

**Self-hosted proxy management panel** — a privacy-first, three-component system where every
deployment is independent and the project operators never see your data.

| Component | Runtime | Role |
|---|---|---|
| **Panel** | Cloudflare Workers + D1 + KV | Single source of truth: users, upstreams, relays, configs, subscriptions, usage, audit. Includes a same-origin Web Admin SPA. |
| **Telegram Bot** | Cloudflare Worker (thin client) | Owner-only management bot. Talks to the Panel API over HTTPS. **Never** touches the database. |
| **Relay** | Railway (Docker, optional) | Outbound-only data-plane agent: pulls assignments, sends heartbeats + usage reports. Holds no admin power and no bot token. |

```text
                    ┌────────────────────────────┐
                    │  Cloudflare Panel (SSOT)   │
                    │  Worker + D1 + KV          │
                    │  REST API + Web Admin SPA  │
                    └─────────▲────────▲─────────┘
                              │ HTTPS  │ HTTPS (Bearer, scoped)
              ┌───────────────┘        └────────────────┐
              │ scoped api_client token                 │ relay token (single active)
   ┌──────────┴──────────┐                   ┌───────────┴───────────┐
   │ Telegram Bot Worker │                   │ Relay (Railway, opt.) │
   │ thin client, no D1  │                   │ outbound-only agent   │
   └─────────────────────┘                   └───────────────────────┘
```

**Design invariants** (enforced in code and schema, not by convention):

- **API-first** — `/api/v1` is the *only* data path. Bot, Relay and the Admin SPA never
  access D1 directly.
- **Optional Relay** — the system is complete without any relay (`upstream_id XOR relay_id`
  assignment model allows both direct and relayed configurations).
- **Append-only evidence** — `audit_logs` and `usage_reports` are guarded by SQLite triggers;
  UPDATE/DELETE are physically rejected.
- **Soft delete** — users/configs/etc. use tombstones (`deleted_at`, `version`) so
  incremental sync can propagate deletions.
- **Idempotent usage** — `UNIQUE(relay_id, report_id)`; replays never double-count.
- **Exactly one active relay token** — partial unique index; rotation invalidates the old
  token immediately.
- **Credentials encrypted** — AES-256-GCM; the DEK lives only in Panel Worker secrets.
- **No secrets in code, logs, messages, or this repository.** Ever.

## Monorepo layout

```text
apps/
  panel/            Web Admin Panel — Hono Worker + SPA + D1 migrations (13 tables)
  bot/              cybrix-bot — Telegram management bot (TelegramReporter inside)
  relay/            Railway Relay — sync / heartbeat / usage agent (+ offline buffer)
packages/
  shared-types/     REST API contract types (Prompt 4) — single source of truth
scripts/            deployment + verification scripts (never echo secrets)
railway.json        Railway build config for apps/relay
```

Component docs: [`apps/panel/README.md`](apps/panel/README.md) ·
[`apps/bot/README.md`](apps/bot/README.md) ·
[`apps/relay/README.md`](apps/relay/README.md) + [`apps/relay/docs/`](apps/relay/docs/)

## Requirements

- Node.js ≥ 18 and npm (workspaces)
- A Cloudflare account with **Workers, D1 and KV** enabled (free tier is sufficient)
- A Telegram bot token from [@BotFather](https://t.me/BotFather) (for the bot)
- Optionally: a [Railway](https://railway.app) account with billing enabled (for the relay)
- One Cloudflare zone (any domain in your account) — required because Cloudflare blocks
  Worker→Worker fetches to `*.workers.dev` on the same account (error 1042); the Panel must
  be reachable through a **Custom Domain** on your own zone.

## Develop & test

```bash
npm install
npm run typecheck        # tsc --strict for panel / bot / relay
npm test                 # 161 tests: panel 22 + bot 64 + relay 75
```

Local dev (all secrets stay in gitignored `.dev.vars` / `.env`):

```bash
cp apps/panel/.dev.vars.example apps/panel/.dev.vars   # fill in random values
cp apps/bot/.dev.vars.example  apps/bot/.dev.vars
npm run panel:dev        # wrangler dev (panel)      → http://127.0.0.1:8787
npm run bot:dev          # wrangler dev (bot)
npm run relay:build && npm run relay:start               # relay locally
```

## Deploy the Panel (Cloudflare)

`scripts/deploy-cf-panel.sh` performs the full cycle idempotently — it creates the D1
database and KV namespace (or finds existing ones), patches `apps/panel/wrangler.toml`
with the real IDs, applies all migrations **remotely**, deploys the Worker, and sets the
two production secrets from freshly generated random values.

1. Put your Cloudflare API token in a **gitignored** `.secrets/cybrix.env`:

   ```bash
   mkdir -p .secrets
   cat > .secrets/cybrix.env <<'EOF'
   CF_API_TOKEN=<token with D1:Edit, Workers KV:Edit, Workers Scripts:Edit>
   CF_ACCOUNT_ID=<your account id>
   EOF
   chmod 600 .secrets/cybrix.env
   ```

2. Set **your** panel hostname — either add `PANEL_DOMAIN=panel.example.com` to
   `.secrets/cybrix.env` (the deploy script patches `wrangler.toml` for you), or edit
   `apps/panel/wrangler.toml` manually (`routes → pattern = "panel.example.com"`,
   `custom_domain = true`) — use a hostname from **your own** Cloudflare zone.
3. Run the script, then verify:

   ```bash
   bash scripts/deploy-cf-panel.sh
   curl https://panel.example.com/healthz    # {"status":"ok", ...}
   curl https://panel.example.com/readyz     # {"checks":{"d1":"ok","kv":"ok"}}
   ```

4. **First owner bootstrap** — open the Panel URL; the Web Admin walks you through
   `POST /api/v1/setup` (available only while no owner exists). Owner credentials are shown
   once — store them in a password manager.

> The generated `ADMIN_PEPPER` / `DATA_ENCRYPTION_KEY` are persisted by the script to
> `.secrets/panel-generated.env` (gitignored). Losing them means losing encrypted
> upstream credentials — back that file up safely.

## Deploy the Telegram Bot (Cloudflare)

1. Create the bot with @BotFather, then put the token in `.secrets/cybrix.env`:

   ```bash
   TELEGRAM_BOT_TOKEN=<token from BotFather>
   TELEGRAM_OWNER_ID=<your numeric telegram id>
   ```

2. In the Panel **Web Admin → Settings → API Clients**, create a client named e.g.
   `cybrix-bot` with exactly the scopes the bot needs:
   `audit:read configs:read configs:write dashboard:read relays:read settings:read
   subscriptions:read subscriptions:write telegram_admins:read upstreams:read
   upstreams:write usage:read users:read users:write`
   (the raw token is shown **once**).
3. Also register your numeric Telegram ID under **Settings → Telegram Admins** — the bot
   is fail-closed and serves only allowlisted owners.
4. Run the deploy script (it generates the webhook secret, registers the webhook, sets all
   Worker secrets, and persists raw values to `.secrets/bot-generated.env`):

   ```bash
   bash scripts/deploy-cf-bot.sh
   ```

5. Verify: send `/start` to your bot, then `/status` — every command goes
   Telegram → Bot Worker → Panel API → D1 and back.

## Deploy the Relay (Railway, optional)

The relay is a **deploy-ready but optional** component. `railway.json` +
`apps/relay/Dockerfile` build it automatically.

```bash
bash scripts/deploy-railway-relay.sh      # requires activated Railway billing
```

Or manually: create a Railway project from this repo → set the variables below → deploy.
Then create the relay in the Panel (**Relays → create → Issue Token**, raw token shown
once) and finish the bootstrap:

| Variable | Meaning |
|---|---|
| `RELAY_ID` | Relay UUID from the Panel |
| `RELAY_TOKEN` | Bearer token from the Panel (`cbx_rl_…`, single active) |
| `CYBRIX_API_URL` | `https://panel.example.com/api/v1` |

The relay is outbound-only (no inbound ports except its own `/healthz`), buffers usage
reports while offline (deterministic drop-oldest, bounded queue), persists cursors across
restarts, and flush→ACK→dedup on recovery.

**Static egress check** (one honest measurement, no inference):

```bash
node apps/relay/scripts/verify-egress.mjs
# → STATIC_VERIFIED | DYNAMIC | UNKNOWN | UNSUPPORTED
```

## Secrets reference (names only — never commit values)

| Where | Key | Purpose |
|---|---|---|
| Panel Worker secrets | `ADMIN_PEPPER`, `DATA_ENCRYPTION_KEY` | password hashing pepper / credential DEK |
| Bot Worker secrets | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CYBRIX_BOT_API_TOKEN`, `TELEGRAM_REPORT_CHAT_ID` | Telegram identity, webhook auth, Panel scope token, report destination |
| Relay (Railway) | `RELAY_ID`, `RELAY_TOKEN` (or `RELAY_TOKEN_FILE`), `CYBRIX_API_URL` | relay identity + Panel base URL |

Local development uses the same names in gitignored `.dev.vars` (Workers) and `.env`
(relay). Templates: `apps/*/.dev.vars.example`, `apps/relay/.env.example`.

## Repo rules that hold across the codebase

1. **API-first:** panel API (`/api/v1`) is the ONLY data path. Bot/Relay/Panel-UI never
   touch D1 directly.
2. **Shared types:** every API type comes from `@cybrix/shared-types` — no scattered
   redefinitions. (The relay's single VALUE import of `API` is wired relatively so the
   emitted runtime stays dependency-free; type imports use the alias.)
3. **Secrets:** only in Cloudflare env/Secrets, Railway Variables, or local `.dev.vars` /
   `.env` (gitignored). Never in code, logs, messages, or this repository.
4. **GAP discipline:** anything a component needs that the contract does not provide is
   registered as a numbered GAP (`apps/bot/docs/DESIGN.md` §GAP-B1,
   `apps/relay/docs/DESIGN.md` §GAP-R1..R3) — contracts are never changed silently.
5. **Reporting:** stage/operational reports flow through `@cybrix/bot`'s TelegramReporter
   (`apps/bot/src/reporting/reporter.ts`); the relay feeds signals via heartbeat metadata
   (`apps/relay/docs/DESIGN.md` §9) — the relay itself never holds a bot token.

## Security

Reporting a vulnerability: see [`SECURITY.md`](SECURITY.md). Highlights: four separate
auth domains (session+CSRF, scoped bot bearer, single-active relay bearer, subscription
bearer), rate limiting on all sensitive domains, strict CSP on the SPA, HttpOnly + Secure
+ SameSite=Lax cookies, append-only audit/usage tables, AES-256-GCM credential storage,
and a repo-wide secret scanner (`scripts/secret-scan.py`) that checks the working tree
**and** full git history.

## License

MIT — see [`LICENSE`](LICENSE).

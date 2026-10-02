# @cybrix/relay — CYBRIX Railway Relay

Optional, self-hosted **Network/Data-Plane component** (Prompt 7). Every deployment runs its
own relay against its own Panel. The relay is an **outbound-only agent**: it never exposes a
management API, never touches D1, and never holds any credential except its own relay token
and the minimum-necessary config credentials delivered over HTTPS by the Panel API.

```text
                CONTROL PLANE (SSOT)                    DATA PLANE
┌────────────────────────────────────────────┐   ┌─────────────────────────────┐
│ CYBRIX Panel — Cloudflare Worker           │   │ Railway Relay (this app)    │
│ D1 · KV · Secrets · REST API (/api/v1)     │◄──┤ sync · heartbeat · usage    │
└────────────────────────────────────────────┘   │ ephemeral local state only  │
          Outbound-only: Relay → Panel (HTTPS)   └──────────┬──────────────────┘
                                                            ▼
                                                      Upstream / Internet
```

## Status

| Item | Value |
|---|---|
| Stage | Prompt 7 — **READY FOR REVIEW** |
| Runtime | Node.js ≥ 18 (Docker: node:20-alpine), **zero runtime npm dependencies** |
| Tests | 75/75 passing (unit · integration · security) |
| Typecheck | `tsc --strict` clean |
| Static egress | **UNKNOWN — not verified** (see `docs/STATIC-EGRESS.md`; honest by design) |

## Quick start (local)

```bash
# from the repo root
npm install
npm run relay:typecheck && npm run relay:test
npm run relay:build
cp apps/relay/.env.example apps/relay/.env        # fill in (never commit)
node apps/relay/dist/apps/relay/src/index.js      # or: npm run relay:start
```

The relay boots, syncs its assignments, heartbeats every 60 s and flushes usage every 60 s.
Health: `GET http://127.0.0.1:8080/healthz` (liveness) and `/healthz/local` (snapshot).

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `RELAY_ID` | ✅ | — | UUIDv4 issued by the Panel (fixed identity, §5) |
| `RELAY_TOKEN` | ✅* | — | Bearer token (`cbx_rl_…`) — shown exactly once at issue/rotate |
| `RELAY_TOKEN_FILE` | ✅* | — | Alternative to `RELAY_TOKEN`; absolute path; enables SIGHUP hot-reload |
| `CYBRIX_API_URL` | ✅ | — | Panel base URL (HTTPS enforced in production) |
| `PORT` | — | `8080` | Health endpoint port (`0` = ephemeral) |
| `HEALTH_BIND` | — | `0.0.0.0` | Health bind address (`127.0.0.1` to restrict) |
| `DATA_DIR` | — | `./data` | Offline queue + cursor state (mount a volume to persist) |
| `HEARTBEAT_INTERVAL_S` | — | `60` | Heartbeat period (server may suggest a new one) |
| `SYNC_INTERVAL_S` | — | `30` | Sync poll period (plus server-driven `should_sync`) |
| `USAGE_FLUSH_INTERVAL_S` | — | `60` | Usage aggregation window |
| `HTTP_TIMEOUT_MS` | — | `10000` | Per-request timeout |
| `RETRY_MAX_ATTEMPTS` | — | `5` | Bounded attempts per request (§18) |
| `RETRY_BASE_MS` / `RETRY_MAX_BACKOFF_MS` | — | `1000` / `60000` | Exponential backoff + jitter bounds |
| `QUEUE_MAX_REPORTS` / `QUEUE_MAX_BYTES` | — | `2000` / `26214400` | Offline buffer caps (§17) |
| `SHUTDOWN_FLUSH_TIMEOUT_MS` | — | `20000` | Graceful-shutdown flush budget (§20) |
| `LOG_LEVEL` | — | `info` | `debug` · `info` · `warn` · `error` |
| `ALLOW_INSECURE_API` | — | `0` | `1` only for local dev (allows http:// API URL) |

\* exactly ONE of `RELAY_TOKEN` / `RELAY_TOKEN_FILE`.

## Documentation map

| Doc | Covers |
|---|---|
| [`docs/DESIGN.md`](docs/DESIGN.md) | Architecture, state machine, sync/heartbeat/usage flows, offline buffer, retry matrix, isolation, protocol abstraction, security, logging, Telegram mapping, GAP register, OD impact |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Bootstrap flow (§6), Railway setup, secrets, volumes, healthcheck, token rotation (§19), deployment test record |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | AUTH_FAILED, cursor resync, queue full, EADDRINUSE, deleted/disabled relay, clock skew, log field reference |
| [`docs/STATIC-EGRESS.md`](docs/STATIC-EGRESS.md) | §23/§24/§34 — verification procedure, result record, alternatives if dynamic |

## Deliverables map (Prompt 7 §36)

1. Architecture → `docs/DESIGN.md` §1–3 · 2. Runtime → `src/runtime.ts` · 3. Authentication → `src/api/client.ts` + §4/§30 · 4. Bootstrap → `docs/DEPLOYMENT.md` §2 · 5. Sync Client → `src/runtime.ts` (sync) · 6. Heartbeat → `src/runtime.ts` (heartbeat) · 7. Usage Reporter → `src/usage/collector.ts` + queue delivery · 8. Offline Buffer → `src/queue/offline-buffer.ts` · 9. Retry System → `src/api/client.ts` + `src/core/scheduler.ts` · 10. Health System → `src/health/server.ts` + heartbeat metadata · 11. Graceful Shutdown → `src/runtime.ts` (shutdown) + `Dockerfile` (tini) · 12. Token Rotation → `reloadToken()` + `docs/DEPLOYMENT.md` §5 · 13. Multi-Relay → `docs/DESIGN.md` §10 · 14. Security Hardening → `docs/DESIGN.md` §11 + `Dockerfile` · 15. Dockerfile → `Dockerfile` · 16. Railway Config → `../railway.json` · 17. Static Egress Verification → `scripts/verify-egress.mjs` + `docs/STATIC-EGRESS.md` · 18. Telegram Reporting Integration → `docs/DESIGN.md` §9 · 19–21. Tests → `test/` · 22–24. Docs → this tree.

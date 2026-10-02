# CYBRIX Relay — Deployment Guide (Railway)

## 1. Prerequisites

* A deployed CYBRIX Panel (Cloudflare Worker) reachable over HTTPS.
* A Railway account (Hobby plan or higher is enough — see `docs/STATIC-EGRESS.md` for the
  honest picture about static egress before promising that feature to anyone).

## 2. Bootstrap flow (Prompt 7 §6)

```text
1. Admin creates the Relay in the CYBRIX Panel  →  POST /api/v1/relays
2. Panel creates the relay record               →  RELAY_ID (copy it)
3. Admin issues the token                       →  POST /api/v1/relays/{id}/token
   → raw token (cbx_rl_…) shown EXACTLY ONCE — store it immediately in Railway,
     it cannot be retrieved again (lost token ⇒ Rotate)
4. Configure the relay service (env/secrets):
      RELAY_ID, RELAY_TOKEN (or RELAY_TOKEN_FILE), CYBRIX_API_URL
5. Deploy → relay starts
6. Relay authenticates (Bearer) and performs the initial full sync
7. Relay requests assignments continuously (cursor-based sync)
8. Relay sends heartbeats every 60 s (Panel shows the relay as online)
```

## 3. Railway setup

1. **New Service → GitHub Repo** (this monorepo).
2. **Root Directory:** repo root (railway.json is at the root; the Dockerfile lives at
   `apps/relay/Dockerfile` and is referenced by `railway.json`).
3. Railway detects `railway.json` → builder `DOCKERFILE` → start command
   `node apps/relay/dist/apps/relay/src/index.js`.
4. **Variables** (set as secret/private):
   `RELAY_ID`, `RELAY_TOKEN`, `CYBRIX_API_URL`, optional tuning (see README table).
5. **Healthcheck:** `railway.json` sets `healthcheckPath=/healthz`, timeout 120 s. The image
   also defines a Docker `HEALTHCHECK` against `127.0.0.1:PORT/healthz`.
6. **Restart policy:** `ON_FAILURE`, max 10 retries. Note: the relay does NOT crash-loop on
   auth failures (it parks in `auth_failed`); restarts are for real crashes/OOM.
7. **Volume (optional but recommended):** mount a volume at `/app/data` to persist the
   offline usage queue + sync cursor across restarts. Without a volume the state is
   ephemeral: a redeploy loses pending (un-ACKed) usage windows and the relay simply
   re-syncs — acceptable, documented trade-off, never a correctness risk (Panel is SSOT).
8. **Public networking:** the health endpoint must be reachable for the Railway healthcheck.
   The data plane (tcp-forward listeners) needs a Railway **TCP Proxy** per listen port if
   clients connect over the public internet. Map `parameters.listen_port` values in the
   Panel config accordingly.

## 4. Deployment test record

| Test | Where | Result |
|---|---|---|
| Unit + integration + security suite (75 tests) | `npm run relay:test` | ✅ 75/75 PASS |
| Typecheck (strict) | `npm run relay:typecheck` | ✅ PASS |
| Compiled-boot smoke (dist output, real health endpoints, state persistence, structured logs) | local, `node dist/apps/relay/src/index.js` | ✅ PASS |
| Docker image build | not executed in the design sandbox (no docker daemon) | ⏳ run `docker build -f apps/relay/Dockerfile .` before first deploy |
| Railway deploy | requires your Railway account | ⏳ post-deploy |

## 5. Token rotation (Prompt 7 §19)

Old token → Rotate (Panel) → new token shown once → update relay → reload. Two supported paths:

**A. Env rotation (Railway default)**

```text
Panel: POST /api/v1/relays/{id}/token/rotate   → new cbx_rl_… (shown once)
Railway: update RELAY_TOKEN variable            → Railway redeploys
Relay: restarts with the new token, re-syncs, no rebuild needed
```

The relay handles the gap gracefully: while the old token is revoked it sits in
`auth_failed` (no request storm) and recovers on the first successful sync.

**B. File rotation + SIGHUP (zero restart)**

1. Set `RELAY_TOKEN_FILE=/run/secrets/relay_token` (absolute path) instead of `RELAY_TOKEN`.
2. Rotate in the Panel; write the new raw token into the file.
3. `kill -HUP <pid>` (or `docker kill -s HUP`) → the relay re-reads the file and — if it was
   in `auth_failed` — immediately triggers a fresh sync.

The raw token is never logged, never persisted by the relay, never displayed again by the Panel.

## 6. Upgrades

Pull the new image → Railway redeploys → graceful shutdown runs (SIGTERM): data plane stops,
pending usage is flushed within `SHUTDOWN_FLUSH_TIMEOUT_MS`, state is persisted atomically.
Rolling restarts therefore do NOT corrupt the offline queue and lose at most the current
flush window.

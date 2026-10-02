# CYBRIX Relay — Troubleshooting Guide

## Reading the logs

One JSON object per line (Prompt 7 §28):

```json
{"ts":"2026-09-25T01:32:59.938Z","level":"info","event":"relay.boot",
 "component":"relay","relay_id":"9f1c…","api_host":"panel.example…","software_version":"0.1.0"}
```

Key events: `relay.boot` · `health.listening` · `sync.full_applied` / `sync.delta_applied` ·
`sync.failed` / `heartbeat.failed` / `usage.failed` · `usage.acked` / `usage.enqueued` /
`usage.rejected_4xx` / `usage.idempotency_conflict` / `usage.delivery_deferred` ·
`queue.dropped_oldest` · `relay.auth_failed` · `relay.event` (code+severity) ·
`adapter.started/stopped/failed` · `relay.shutdown_begin/complete` · `token.reloaded`.

Secrets are never present (redaction + secret-scan tests enforce it).

## Symptom → cause → fix

### `relay.auth_failed` / state `auth_failed` (log: 401 `UNAUTHORIZED`/`TOKEN_REVOKED`)
The relay token was revoked/rotated or is wrong. The relay does NOT retry-storm; it parks.
→ Fix: rotate (`POST /api/v1/relays/{id}/token/rotate`), update `RELAY_TOKEN` (redeploy) or
write the new token to `RELAY_TOKEN_FILE` + SIGHUP. See `DEPLOYMENT.md` §5.

### 403 `FORBIDDEN (relay_disabled)`
The relay was disabled in the Panel. → Re-enable (`PATCH /api/v1/relays/{id}`,
`status:"active"`); no token change needed.

### 410 `RESOURCE_DELETED`
The relay was deleted on the Panel (token revoked automatically). → Re-create the relay and
re-bootstrap (new `RELAY_ID` + token).

### `sync.cursor_invalid_resync` / 400 `CURSOR_INVALID`
The stored cursor was rejected. Expected after very long outages in some panel versions.
→ Nothing to do: the relay drops the cursor and performs a safe full resync automatically (§9).

### `queue.dropped_oldest` / `queue_full` (CRITICAL)
The offline buffer hit its caps during an outage. Oldest reports were dropped
deterministically. → Restore Panel connectivity; optionally raise `QUEUE_MAX_REPORTS` /
`QUEUE_MAX_BYTES` or mount a bigger volume; check `usage_failures` in `/healthz/local`.

### `assignment.start_failed … EADDRINUSE`
Two configs claim the same `parameters.listen_port`, or the port is used by another process.
→ Change the port in the Panel config; each active tcp-forward config needs a unique port.

### `assignment.skipped_unknown_protocol`
The config's protocol has no adapter in this build (v1: only `tcp-forward`).
→ Expected for protocol types until GAP-R1 adapters ship; the config is counted in
`skipped_configs`, everything else keeps running.

### Usage entries dropped (`droppedNoUser` increased)
Traffic was flushed for a config whose owner mapping was not (yet) synced.
→ Self-healing on the next sync; if persistent, check the Panel's user/config state.

### Health endpoint unreachable / restart loop
`/healthz` binds `HEALTH_BIND:PORT` (default `0.0.0.0:8080`). If Railway's healthcheck fails,
check that `PORT` matches the exposed port and that nothing else binds it. `/healthz` is
deliberately always-200 (liveness); detailed state is on `/healthz/local`.

### Clock skew warnings
`ts`/window fields are advisory; the Panel uses its own clock (Prompt 4 §10.8). No action.

### State file corrupt warnings (`state.corrupt_recovered`, `queue.corrupt_recovered`)
A torn write was quarantined (`.corrupt-<ts>` file). The relay continues with empty state
(cursors reset → full resync; pending usage reports lost → CRITICAL `data.loss` event).
→ Check disk health/volume mount; delete the quarantine file after inspection.

### `Cannot find module` at boot (bare-metal run)
You ran the TS entry or a partially copied `dist/`. Use the Docker image or build first:
`npm run relay:build && node apps/relay/dist/apps/relay/src/index.js` from the repo root
(the relative `packages/shared-types` output must sit next to `apps/` inside `dist/`).

## Ops quick reference

```bash
curl -s localhost:8080/healthz         # liveness (Railway/Docker)
curl -s localhost:8080/healthz/local   # full local snapshot (state, queue, counters)
kill -HUP <pid>                        # reload RELAY_TOKEN_FILE (rotation, no restart)
kill -TERM <pid>                       # graceful shutdown (flush + persist)
node scripts/verify-egress.mjs --repeat 5 --delay 30   # egress probe (see STATIC-EGRESS.md)
```

# CYBRIX Relay — Design (Prompt 7)

Companion to Prompt 2 (Architecture), Prompt 3 (Schema), Prompt 4 (REST API §10.6–§10.9),
Prompt 5 (Panel) and Prompt 6 (Bot + Reporting). Where wording differs, Prompt 3/4 contracts win.

## 1. Role and non-role

The relay is a **Network/Data-Plane component**. It executes assignments the Panel authorizes
and reports facts back. It NEVER:

* manages users/admins/subscriptions/telegram/audit/billing/passwords/tokens
* touches D1, KV, or any Control-Plane storage
* decides business logic (§32): user enabled, subscription validity, traffic limits,
  config ownership — the Panel already filtered all of that before sync answered.

What it does: receive assignments (sync) → keep them in ephemeral runtime state → run the
data plane through a ProtocolAdapter → send heartbeats → collect & report usage with
`report_id` idempotency → buffer during outages → shut down gracefully.

## 2. Communication is outbound-only (§2)

`Relay → CYBRIX API` over HTTPS. The Panel never connects to Railway; there is no inbound
management port. The only listener is the **local health endpoint** (`/healthz`,
`/healthz/local`) — GET-only, read-only, non-sensitive, bind-configurable. It exists for the
container orchestrator's liveness probe, not for management (§27 rationale in §11 below).

Endpoints used (Prompt 4 inventory — nothing invented):

```text
GET  /api/v1/relays/{id}/sync?since=<cursor>
POST /api/v1/relays/{id}/heartbeat
POST /api/v1/relays/{id}/usage
```

## 3. Runtime state machine (§20/§30)

```text
booting → syncing → running ⇄ degraded → auth_failed
                          ↘ shutting_down → stopped
```

* `degraded` — retryable failures (network / 5xx / 429) or a full offline buffer.
* `auth_failed` — 401/403/410. Loops self-guard: **zero further requests** until the operator
  rotates the token (env + restart, or file + SIGHUP). No infinite retry (§30), no secret in
  any message.
* `stopped` — only via graceful shutdown.

## 4. Sync, cursor and safe resync (§8/§9)

* **Initial sync** — `GET /sync` with no `since` → full snapshot of the relay's own record,
  assigned configs (FULL, incl. minimum-necessary decrypted credential), owner-user subset.
* **Cursor** — the Prompt 4 composite cursor (base64url JSON, client-held, deterministic).
  The relay stores the final `meta.cursors.next_cursor` and echoes it as `since`.
* **Paging** — while any `has_more` is true, continue with `next_cursor`; the cursor is
  persisted only after the whole page-set is applied (atomic apply).
* **Incremental** — periodic poll (`SYNC_INTERVAL_S`) + server-driven catch-up: the heartbeat
  response's `should_sync` triggers an immediate sync (cheap, no blind polling race).
* **Safe resync (§9)** — a rejected/incompatible cursor (`400 CURSOR_INVALID`) drops the
  cursor and performs ONE full rebuild. Full snapshots replace runtime state atomically
  (`beginFullSync → accumulateFullPage* → commitFullSync`).

## 5. Assignment model & isolation (§10/§26)

* The runtime holds only rows the server scoped to `relay_id = self`.
* **Defense in depth:** the manager re-checks every record — a config whose `relay_id ≠ self`
  is rejected, counted and reported (`isolation.cross_relay_rejected`); a sync response that
  claims a foreign relay identity is a fatal misconfig (`RelayIdentityMismatchError`).
* Unassign stubs (`op:"unassigned"`, Prompt 4 §12.4) remove configs from the runtime and stop
  their adapters.
* Credential handling (§11): decrypted per-protocol credentials arrive ONLY in the FULL sync
  records over TLS, live in memory only, are never logged, never persisted, never echoed in
  errors. `DATA_ENCRYPTION_KEY` never leaves the Control Plane (decryption happens there).

## 6. Protocol abstraction (§31)

```ts
interface ProtocolAdapter {
  readonly name: string
  readonly protocols: readonly string[]
  start(ctx: { config, usage, log }): Promise<void>
  stop(configId): Promise<void>
  stopAll(): Promise<void>
  activeConfigIds(): string[]
}
```

* `AdapterRegistry` maps `configs.protocol` → adapter; reconciliation starts/stops/replaces
  adapters deterministically on every sync delta (awaited — no port-binding races).
* **v1 ships one fully working reference adapter: `tcp-forward`** (listen port → destination
  host:port, per-direction BigInt byte accounting, idle timeout, socket caps). It is the only
  data plane fully defined by today's contract. Real protocol adapters (vless/vmess/trojan/ss)
  plug in later WITHOUT touching Control Plane code — see GAP-R1.
* Configs with an unknown protocol (or `enabled:false`) are skipped, counted
  (`skipped_configs`) and reported — never crash the relay.

## 7. Usage pipeline (§15/§16)

```text
data plane (BigInt counters, per config)
  → drain window (USAGE_FLUSH_INTERVAL_S)
  → build reports (decimal-string bytes, user_id from the synced mapping,
    ≤500 entries each, FRESH UUIDv4 report_id)
  → persist into the offline buffer (BEFORE any send)
  → POST /usage (FIFO, oldest first)
  → ACK (accepted | already_processed) → ONLY NOW removed
```

Failure handling per Prompt 4 §10.9 / Prompt 7 §18:

| Response | Behaviour |
|---|---|
| `200 accepted` / `200 already_processed` | remove report (idempotent duplicate = delivered) |
| `422 VALIDATION_ERROR` (+details[]) | drop invalid entries, re-queue remainder under a NEW `report_id`, dead-letter the original — never resend as-is |
| `409 IDEMPOTENCY_CONFLICT` | dead-letter the id, re-queue under a NEW `report_id` (deterministic recovery) |
| `400 / 413 / 404` | dead-letter, advance head (no infinite loop) |
| `429 / 5xx / 503 / network / timeout` | keep report, bounded retry with backoff; head waits |
| `401 / 403 / 410` | `auth_failed`, buffer untouched, event reported |

## 8. Offline buffer (§17)

`usage-queue.json` in `DATA_DIR`, atomic snapshot (tmp+rename) after EVERY mutation:

* caps: `QUEUE_MAX_REPORTS` (count) and `QUEUE_MAX_BYTES` (wire size);
* overflow is **deterministic: drop-oldest**; each drop raises a CRITICAL `queue.dropped`
  event; a full buffer raises `queue.full` (both throttled but never silently lost);
* near-limit state is exported to the Panel via heartbeat metadata (`queue_near`);
* a corrupt snapshot is quarantined (renamed) at boot → empty queue + CRITICAL `data.loss`
  event (bounded loss, deterministic behaviour);
* rejected reports go to a bounded dead-letter file (`usage-dead.json`, 500 max) for
  post-mortem.

## 9. Telegram Reporting integration (§29)

The relay holds **NO Telegram bot token** (Prompt 6 §29). Flow:

```text
Relay signals ──heartbeat metadata──▶ Panel relay-ingest ──▶ TelegramReporter (Prompt 6) ──▶ Telegram
```

Event mapping (all signals are flat string/int/bool, ≤16 keys, ≤2 KB — Prompt 4 §10.8):

| Relay condition | Signal (heartbeat) | Report type (Prompt 6) | Severity |
|---|---|---|---|
| Relay online (first heartbeat / return) | heartbeat seen | Relay Health | SUCCESS |
| Relay offline (missed heartbeats) | Panel-side timeout | Relay Health | WARNING/CRITICAL |
| Sync failure | `last_error_kind=sync`, `sync_failures` | Relay Health | WARNING/ERROR |
| Heartbeat failure | Panel-side (missed) | Relay Health | ERROR |
| Usage delivery failure | `last_error_kind=usage`, `usage_failures` | Usage | WARNING/ERROR |
| Queue near limit | `queue_near=true` | Relay Health | WARNING |
| Queue full | `queue_full=true` | Relay Health | CRITICAL |
| Authentication failure | `last_error_code=UNAUTHORIZED/TOKEN_REVOKED/FORBIDDEN`, `status=error` | Security Event | CRITICAL |
| Relay deleted | 410 → `auth_failed` + event | Security Event | CRITICAL |
| Deployment/startup failure | no heartbeat within grace after deploy | Deployment | ERROR |

`Notification failure ≠ core failure` (Prompt 6): relay-side throttling keeps signal volume
bounded (300 s per code; CRITICAL capped at 10/min, never silently dropped).

## 10. Multi-relay (§25/§26)

Each relay = own `RELAY_ID` + own token + own heartbeat/health + own usage + own buffer.
Scaling is horizontal by *adding relays*, never by replicating one identity. The Panel
enforces authorization server-side (self-scoped endpoints); the relay re-checks client-side.
Run exactly **1 replica per relay identity** (`railway.json` sets `numReplicas: 1`).

## 11. Security hardening (§27) & logging (§28)

* Non-root container user (`cybrix`), minimal base (`node:20-alpine`), `tini` as PID 1,
  no extra packages beyond `tini`+`wget`, no debug endpoints, no unauthenticated management
  surface (health = read-only liveness/snapshot; bind configurable to loopback).
* HTTPS-only API (enforced in production; explicit `ALLOW_INSECURE_API=1` escape hatch for
  local dev), request timeouts, bounded retries, bounded buffers, zero runtime deps
  (minimal supply-chain surface).
* Redaction (shared rules with the bot): bearer headers, Telegram token shapes, `cbx_rl_`
  / `cbx_apc_` / `cbx_sub_` (and legacy `cyb_*`) families, credentials in URLs, long hex,
  long base64url blobs, plus a sensitive-key blocklist. Applied to EVERY log line, error
  message and exported payload.
* Structured logs (one JSON/line): `ts, level, component, event, relay_id, request_id, …`.
  Never logged: `RELAY_TOKEN`, credentials, `DATA_ENCRYPTION_KEY`, subscription tokens,
  Telegram tokens, passwords.

## 12. Retry matrix (§18)

| Case | Client (per request) | Loop (per trigger) |
|---|---|---|
| timeout / network / DNS | retry ≤ `RETRY_MAX_ATTEMPTS`, exp backoff + jitter | exponential backoff per consecutive failure (bounded), state → degraded |
| 429 | honour `Retry-After`, else backoff (5 min ceiling) | same |
| 5xx / 503 | retry ≤ max attempts | same |
| 400/413/422 | NO retry (payload problem) | usage: dead-letter/requeue-new-id; sync: no retry |
| 409 | NO retry | usage: regenerate report_id once per head |
| 401/403/410 | NO retry | `auth_failed` — all loops stop requesting; recovery = rotation |

## 13. Two-level health (§21)

* **Local** (`/healthz/local`): state, uptime, active/skipped configs, queue metrics,
  pending counters, last sync/heartbeat/usage-ACK timestamps, last error — everything the
  process knows about itself.
* **Control-Plane**: derived by the PANEL from heartbeats (`last_seen_at`, status, agent
  version, API latency) — never exposed by the relay, never mixed with local health.

## 14. GAP register (new in Prompt 7 — contracts unchanged)

| GAP | Statement | Proposal | Status |
|---|---|---|---|
| **GAP-R1** | Prompt 3/4 leave `configs.protocol` + data-plane parameters open; no per-protocol data-plane parameter schema (e.g. `listen_port`, transport params) exists, so real protocol adapters cannot be configured from the Panel yet. | Define a versioned per-protocol `parameters` registry (Panel UI + validation) mirroring the `ProtocolAdapter` interface; adapters stay additive. | OPEN — v1 ships `tcp-forward` reference adapter; Panel-side registry needed before real protocols |
| **GAP-R2** | Relay operational events currently ride inside heartbeat `metadata` (≤16 flat keys/2 KB) — sufficient for v1 signals, but limited (no priority, no server-side dedup, no history). | Optional additive endpoint `POST /api/v1/relays/{id}/events` (self-scoped, idempotent event batches). NOT implemented — heartbeat metadata only, per Prompt 4. | OPEN — optional |
| **GAP-R3** | Forward-compat: under the Prompt 3 XOR a relay-assigned config has no upstream, so `data.upstreams` is always empty today. If relay→upstream chaining is ever productized, sync must start including upstream rows for relay configs. | Already provisioned in the contract ("قاعده برای Forward-compat"); no change now. | NOTE — no action in v1 |

## 15. Open Decisions impact

| OD | Impact on relay |
|---|---|
| OD-1 / OD-2 (subscription formats/URL) | none |
| OD-5 (bot scopes) | none (relay uses relay_tokens domain, not api_clients) |
| OD-8 (token prefixes) | redaction covers both drafts (`cbx_rl_`, `cyb_rly_`); Panel samples use `cbx_rl_` |
| OD-9 (token meta `last_used_at`) | none |

No Prompt 3/4 contract was changed. All new needs are registered as GAP-R1..R3 above.

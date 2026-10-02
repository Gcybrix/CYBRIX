/**
 * CYBRIX Relay Plane contract types — mirrors Prompt 4 §10.6–§10.9
 * (Relay Token / Sync / Heartbeat / Usage Push).
 *
 * Conventions on the relay plane (Prompt 4 §10) — they DIFFER from the admin
 * plane on purpose, exactly as written in Prompt 4:
 *  - timestamps are epoch SECONDS (integer), advisory where noted
 *  - byte counters are DECIMAL STRINGS ("12345"), <= i64 max
 *  - the sync cursor is a client-held, opaque composite base64url token
 *  - relay auth = exactly ONE active relay token (`cbx_rl_…`, Prompt 4 §10.6)
 *
 * Consumed by apps/relay (Prompt 7). Relay never invents new endpoints.
 */

/* ---------- Relay Token (§10.6) ---------- */

export interface IssuedRelayToken {
  relay_id: string
  token_id: string
  /** plaintext shown EXACTLY once at issue/rotate — never stored, never logged */
  token: string
  issued_at: number
  issued_by?: string
  expires_at: number | null
}

export interface RelayTokenMetaView {
  has_active: boolean
  token_id: string | null
  token_prefix: string | null
  issued_at: number | null
  issued_by: string | null
  last_used_at: number | null
  expires_at: number | null
}

/* ---------- Sync (§10.7) ---------- */

/**
 * Composite cursor payload. Encoded as base64url(JSON) into `?since=`.
 * The relay normally echoes the server-provided `meta.cursors.next_cursor`
 * verbatim; the codec exists for tooling/tests and safe resync bookkeeping.
 */
export interface RelaySyncCursor {
  v: 1
  p: {
    configs: [number, string] | null
    users: [number, string] | null
    upstreams: [number, string] | null
    relays: [number, string] | null
  }
}

/** The relay's own record — the ONLY record in `data.relays`. */
export interface RelaySelfRecord {
  id: string
  name: string
  provider?: string | null
  public_endpoint?: string | null
  public_port?: number | null
  status: 'active' | 'disabled' | string
  version: number
  updated_at: number
  deleted_at: number | null
}

/** Unassign stub (Prompt 4 §10.7/§12.4) — relay MUST drop it from runtime. */
export interface UnassignStub {
  id: string
  version: number
  updated_at: number
  op: 'unassigned'
}

/** Config assigned to THIS relay — FULL record incl. decrypted credential. */
export interface RelayConfigRecord {
  id: string
  user_id: string
  protocol: string
  relay_id: string
  upstream_id: string | null
  /**
   * Decrypted per-protocol credential — minimum necessary data (Prompt 4 §14).
   * Relay keeps it in memory only; never logs, never persists it to disk.
   */
  credential?: Record<string, unknown> | null
  /** protocol-specific data-plane parameters — open field per Prompt 3 (GAP-R1) */
  parameters?: Record<string, unknown>
  enabled?: boolean
  version: number
  updated_at: number
  deleted_at: number | null
  /** present ONLY on unassign stubs */
  op?: 'unassigned'
}

/** Owner subset for assigned configs. Relay MUST NOT decide policy (Prompt 7 §32). */
export interface RelayUserRecord {
  id: string
  status: 'active' | 'disabled' | string
  expires_at: number | null
  traffic_limit_bytes: string | null
  traffic_used_bytes: string
  traffic_reset_day: number | null
  version: number
  updated_at: number
  deleted_at: number | null
}

/** Always empty under the Prompt 3 XOR in v1 — kept for forward-compat (§10.7). */
export interface RelayUpstreamRecord {
  id: string
  type: string
  host: string
  port: number
  version: number
  updated_at: number
  deleted_at: number | null
}

export type RelaySyncConfigRow = RelayConfigRecord | UnassignStub

export interface RelaySyncData {
  relays: RelaySelfRecord[]
  upstreams: RelayUpstreamRecord[]
  configs: RelaySyncConfigRow[]
  users: RelayUserRecord[]
}

export interface RelaySyncMeta {
  cursors: {
    next_cursor: string
    has_more: {
      configs: boolean
      users: boolean
      upstreams: boolean
      relays: boolean
    }
  }
  server_time: number
}

export interface RelaySyncEnvelope {
  data: RelaySyncData
  meta: RelaySyncMeta
}

/* ---------- Heartbeat (§10.8) ---------- */

export type RelayHeartbeatStatus = 'online' | 'degraded' | 'error'

export interface RelayHeartbeatRequest {
  /** epoch seconds — ADVISORY ONLY, server clock wins (clock-skew safe) */
  ts: number
  status: RelayHeartbeatStatus
  /** 1..32 chars (semver suggested) */
  agent_version: string
  uptime_seconds: number
  /** current sync cursor — used by the server to compute `should_sync` */
  sync_cursor?: string
  active_configs: number
  /**
   * OPTIONAL flat object: <= 16 keys, values string|int|bool, <= 2KB total,
   * NO secrets (violations → 422). Prompt 7 §29 uses these keys to carry
   * relay event signals to the Control Plane's TelegramReporter.
   */
  metadata?: Record<string, string | number | boolean>
}

export interface RelayHeartbeatResponseData {
  server_time: number
  heartbeat_interval_seconds: number
  should_sync: boolean
  relay: {
    id: string
    status: 'active' | 'disabled' | string
    health: 'online' | 'offline' | string
  }
}

/* ---------- Usage Push (§10.9) ---------- */

export interface RelayUsageEntry {
  user_id: string
  config_id: string
  /** decimal strings, ^[0-9]{1,19}$ */
  bytes_up: string
  bytes_down: string
  /** optional, advisory (no accounting use) */
  window_from?: number
  window_to?: number
}

export interface RelayUsageReportRequest {
  /** UUIDv4 — persisted by the relay BEFORE sending (idempotency key) */
  report_id: string
  generated_at: number
  /** 1..500 entries */
  entries: RelayUsageEntry[]
}

export type RelayUsageAckStatus = 'accepted' | 'already_processed'

export interface RelayUsageAckData {
  status: RelayUsageAckStatus
  report_id: string
  ingested_at: number
  entries_accepted?: number
  users?: { user_id: string; traffic_used_bytes: string }[]
}

/* ---------- Cursor codec (pure, Workers + Node safe) ---------- */

function toBase64Url(json: string): string {
  const b64 = typeof btoa === 'function' ? btoa(json) : Buffer.from(json, 'latin1').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(token: string): string {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('latin1')
}

export function encodeRelaySyncCursor(cursor: RelaySyncCursor): string {
  return toBase64Url(JSON.stringify(cursor))
}

/** Throws `CURSOR_INVALID` (as Error with that code in `message`) on bad input. */
export function decodeRelaySyncCursor(token: string): RelaySyncCursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(fromBase64Url(token))
  } catch {
    throw new Error('CURSOR_INVALID')
  }
  const c = parsed as RelaySyncCursor | null
  if (!c || typeof c !== 'object' || c.v !== 1 || !c.p || typeof c.p !== 'object') {
    throw new Error('CURSOR_INVALID')
  }
  return c
}

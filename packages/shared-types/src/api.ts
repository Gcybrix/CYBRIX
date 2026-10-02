/**
 * CYBRIX REST API contract types — mirrors Prompt 4 envelopes & resources.
 * Conventions locked in Prompt 4 ch.4:
 *  - all ids are strings (UUIDv4 in D1)
 *  - byte counters are DECIMAL STRINGS ("1099511627776"); null = unlimited
 *  - timestamps are ISO 8601 UTC strings
 */

/* ---------- Envelopes ---------- */

export interface PaginationMeta {
  next_cursor: string | null
  has_more: boolean
  limit: number
}

export interface ResponseMeta {
  request_id?: string
  pagination?: PaginationMeta
  [key: string]: unknown
}

export interface Envelope<T> {
  data: T
  meta?: ResponseMeta
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: unknown
    request_id?: string
  }
}

/** The 11-code error registry locked in Prompt 4 ch.6 */
export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RESOURCE_DELETED'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INTERNAL_ERROR'

/* ---------- telegram_admins ---------- */

export interface TelegramAdmin {
  id: string
  telegram_user_id: number
  note?: string | null
  created_at: string
}

/* ---------- users ---------- */

export interface User {
  id: string
  username: string
  note?: string | null
  enabled: boolean
  /** decimal string, null = unlimited */
  traffic_limit_bytes: string | null
  /** decimal string */
  traffic_used_bytes: string
  /** 1..28, null = settings default */
  traffic_reset_day: number | null
  traffic_last_reset_at?: string | null
  expiry_at?: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  version?: number
}

export interface UserWrite {
  username: string
  note?: string | null
  enabled?: boolean
  traffic_limit_bytes?: string | null
  expiry_at?: string | null
  traffic_reset_day?: number | null
}

/* ---------- upstreams ---------- */

export interface Upstream {
  id: string
  name: string
  type: string
  host: string
  port: number
  enabled?: boolean
  /** write-only on create/update; never returned by API */
  has_credentials?: boolean
  created_at: string
  updated_at: string
  deleted_at?: string | null
  version?: number
}

/* ---------- relays ---------- */

export type RelayStatus = 'online' | 'stale' | 'offline' | 'disabled'

export interface Relay {
  id: string
  name: string
  provider?: string | null
  region?: string | null
  note?: string | null
  enabled: boolean
  /** derived server-side (Prompt 4 ch.24) */
  status?: RelayStatus
  last_seen_at?: string | null
  agent_version?: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  version?: number
}

/* ---------- configs ---------- */

export interface Config {
  id: string
  user_id: string
  name: string
  /** XOR locked in Prompt 3 — at most one of these is set */
  upstream_id: string | null
  relay_id: string | null
  enabled: boolean
  has_credentials?: boolean
  created_at: string
  updated_at: string
  deleted_at?: string | null
  version?: number
  /** protocol-specific payload intentionally open (Prompt 3) */
  [key: string]: unknown
}

/* ---------- subscriptions ---------- */

export interface Subscription {
  id: string
  user_id: string
  name?: string | null
  enabled: boolean
  created_at: string
  updated_at?: string
  deleted_at?: string | null
  /** token plaintext appears ONLY once in issue/rotate responses (Prompt 4 ch.18) */
  subscription_url?: string
}

/* ---------- relay tokens ---------- */

export interface RelayTokenMeta {
  id: string
  created_at: string
  issued_by?: string | null
  last_used_at?: string | null
}

export interface IssuedToken {
  id: string
  /** shown exactly once */
  token: string
  created_at: string
}

/* ---------- usage ---------- */

export interface UsageDailyRow {
  date: string
  user_id: string
  config_id: string
  relay_id: string
  rx_bytes: string
  tx_bytes: string
}

export interface UsageRawRow {
  report_id: string
  relay_id: string
  user_id: string
  config_id: string
  rx_bytes: string
  tx_bytes: string
  window_start: string
  window_end: string
}

/* ---------- audit ---------- */

export type AuditActorType = 'admin' | 'bot' | 'relay' | 'system' | string

export interface AuditLogEntry {
  id: string
  created_at: string
  actor_type: AuditActorType
  actor_id?: string | null
  action: string
  resource_type?: string | null
  resource_id?: string | null
  details?: unknown
  request_id?: string | null
  ip?: string | null
  user_agent?: string | null
}

/* ---------- dashboard ---------- */

export interface RelayHealthEntry {
  id: string
  name: string
  status: RelayStatus | string
  last_seen_at?: string | null
}

export interface DashboardSummary {
  counts: {
    users: { total: number; active: number; disabled: number; expiring_soon?: number }
    configs: { total: number; enabled: number }
    upstreams: { total: number; enabled: number }
    relays: { total: number; online: number; offline: number }
    subscriptions: { total: number; active: number }
  }
  traffic: {
    today: string
    last_7d: string
    last_30d: string
  }
  relays_health: RelayHealthEntry[]
  recent_audit: AuditLogEntry[]
}

/* ---------- api clients ---------- */

export interface ApiClientRecord {
  id: string
  name: string
  scopes: string[]
  enabled: boolean
  last_used_at?: string | null
  created_at: string
}

/* ---------- settings ---------- */

export interface SettingsView {
  editable: Record<string, unknown>
  read_only: Record<string, unknown>
  /** values are NEVER exposed (Prompt 4 ch.32) */
  internal_only: { key: string }[]
}

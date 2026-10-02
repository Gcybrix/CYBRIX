/**
 * CYBRIX Panel — Worker environment & constants (Prompt 2/3/4).
 */

export interface Env {
  DB: D1Database
  KV: KVNamespace
  ASSETS: Fetcher
  ADMIN_PEPPER: string
  DATA_ENCRYPTION_KEY: string
  LOG_LEVEL?: string
  PANEL_VERSION?: string
}

export const HEALTH_ONLINE_WINDOW_S = 180
export const HEARTBEAT_INTERVAL_S = 60
export const SESSION_TTL_S = 12 * 3600
export const SESSION_ABSOLUTE_TTL_S = 24 * 3600
export const RATE_LIMIT_DEFAULTS: Record<string, { limit: number; window_s: number }> = {
  auth_login_ip: { limit: 10, window_s: 60 },
  auth_login_user: { limit: 5, window_s: 900 },
  login_lockout: { limit: 10, window_s: 900 },
  admin_api: { limit: 120, window_s: 60 },
  bot: { limit: 300, window_s: 60 },
  relay_sync: { limit: 30, window_s: 60 },
  relay_heartbeat: { limit: 6, window_s: 60 },
  relay_usage: { limit: 60, window_s: 60 },
  subscription: { limit: 30, window_s: 60 },
  health: { limit: 60, window_s: 60 },
}

export const BODY_LIMIT_BYTES = 256 * 1024
export const USAGE_BODY_LIMIT_BYTES = 1024 * 1024

/** Credentialed protocols (Prompt 4 §10.3). */
export const PROTOCOLS = ['vless', 'vmess', 'trojan', 'ss'] as const
export const SS_METHODS = ['aes-256-gcm', 'chacha20-ietf-poly1305'] as const

export const EDITABLE_SETTINGS = ['traffic_reset_default_day'] as const
export const READONLY_SETTINGS = ['schema_version'] as const

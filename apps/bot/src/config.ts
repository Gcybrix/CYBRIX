/**
 * Central constants — tuning knobs in ONE place.
 */

export const LIMITS = {
  /** per-user Telegram command/callback throttle (Prompt 6 §14) */
  RATE_LIMIT_PER_MIN: 20,

  /** list page sizes — Telegram messages must stay small (Prompt 6 §17) */
  LIST_PAGE_SIZE: 5,
  RELAYS_MAX: 50,

  /** panel API behaviour (mirrors Prompt 5 ch.32 retry policy) */
  API_TIMEOUT_MS: 15_000,
  API_RETRY_MAX: 1,
  API_RETRY_BASE_MS: 400,
  API_RETRY_MAX_WAIT_MS: 5_000,

  /** Telegram delivery retries (Prompt 6 §13: bounded, backoff, no infinite loop) */
  TG_ATTEMPTS: 3,
  TG_BACKOFF_MS: [200, 800, 2000],

  /** allowlist cache — short TTL keeps revocation timely */
  ALLOWLIST_TTL_S: 60,

  /** conversation state TTL (Prompt 6 §7) */
  SESSION_TTL_S: 600,

  /** webhook update dedup window (Telegram retries duplicates) */
  UPDATE_DEDUP_TTL_S: 120,

  /** reporting dedup window + aggregation stride (Prompt 6 §14) */
  REPORT_DEDUP_TTL_S: 300,
  REPORT_AGGREGATE_STRIDE: 5,
  /** CRITICAL reports are never dropped silently; hard cap protects Telegram API */
  CRITICAL_CAP_PER_MIN: 10,

  /** hard cap for any outgoing Telegram message */
  TG_MAX_MESSAGE_CHARS: 3900,
} as const

export const KV_PREFIX = {
  session: 'telegram:session:',
  rate: 'tg:rl:',
  allowlist: 'tg:allowlist',
  update: 'tg:upd:',
  reportDedup: 'rep:dedup:',
  reportCritical: 'rep:crit:',
} as const

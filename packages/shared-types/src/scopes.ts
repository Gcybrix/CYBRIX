/**
 * API Client Scope Registry — DRAFT, pending OD-5 finalization (Prompt 4 ch.50).
 *
 * GAP-B1 (registered in Prompt 6):
 *   cybrix-bot MUST read the Telegram allowlist to enforce Prompt 6 §4.
 *   `telegram_admins:read` is proposed as an ADDITIVE scope (read-only,
 *   non-sensitive telegram user ids). Until the panel implements it the
 *   bot fails closed and reports CRITICAL (see apps/bot/src/auth/authorize.ts).
 *
 * UI rule (Prompt 5 ch.28): scope checkboxes are rendered from this
 * registry only — no free-form scopes anywhere.
 */

export const SCOPES = [
  'users:read',
  'users:write',
  'configs:read',
  'configs:write',
  'upstreams:read',
  'upstreams:write',
  'relays:read',
  'subscriptions:read',
  'subscriptions:write',
  'usage:read',
  'usage:raw',
  'audit:read',
  'dashboard:read',
  'settings:read',
  // GAP-B1 — required by cybrix-bot; NOT part of Prompt 4 OD-5 draft
  'telegram_admins:read',
] as const

export type Scope = (typeof SCOPES)[number]

/**
 * Minimal scopes cybrix-bot needs for its read-only v1 command set.
 * Missing scopes degrade commands gracefully (403 → "not permitted").
 */
export const BOT_REQUIRED_SCOPES: Scope[] = [
  'telegram_admins:read', // GAP-B1
  'dashboard:read',
  'users:read',
  'configs:read',
  'upstreams:read',
  'relays:read',
  'subscriptions:read',
  'usage:read',
  'audit:read',
  'settings:read',
]

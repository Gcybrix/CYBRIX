/**
 * Telegram authorization — Allowlist flow (Prompt 6 §4).
 *
 * SSOT is the panel's `telegram_admins` table, read through the official API:
 *   GET /api/v1/telegram-admins   (bot scope: telegram_admins:read — GAP-B1)
 *
 * Authorization is by TELEGRAM USER ID (from.id). Chat IDs are only message
 * targets and must never be confused with user ids.
 *
 * FAILURE MODE IS FAIL-CLOSED: if the allowlist cannot be verified
 * (network error, 401, 403 due to a missing GAP-B1 scope, …) every
 * management command is denied with a generic response and a CRITICAL
 * report is emitted. No management capability is ever available on trust.
 */

import type { TelegramAdmin } from '@cybrix/shared-types'
import { KV_PREFIX, LIMITS } from '../config'
import type { Logger } from '../log'
import { describeError } from '../log'
import type { CybrixApi } from '../api/panel'

export type AuthOutcome =
  | { result: 'allowed' }
  | { result: 'denied' }
  | { result: 'backend_error'; status?: number }

interface CachedAllowlist {
  ids: number[]
  at: string
}

export async function checkAuthorization(
  env: { KV: KVNamespace },
  api: CybrixApi,
  telegramUserId: number,
  log: Logger,
): Promise<AuthOutcome> {
  // 1) short-lived KV cache (revocations propagate within ALLOWLIST_TTL_S)
  try {
    const cached = await env.KV.get<CachedAllowlist>(KV_PREFIX.allowlist, 'json')
    if (cached && Array.isArray(cached.ids)) {
      return classify(cached.ids, telegramUserId)
    }
  } catch (err) {
    log.warn('allowlist_cache_read_failed', describeError(err))
  }

  // 2) fetch fresh allowlist from the panel API
  let ids: number[]
  try {
    const admins = await api.telegramAdmins()
    ids = (admins as TelegramAdmin[])
      .map((a) => Number(a.telegram_user_id))
      .filter((n) => Number.isFinite(n) && n > 0)
  } catch (err) {
    const status = (err as { status?: number }).status
    log.error('allowlist_fetch_failed', { status, ...describeError(err) })
    return { result: 'backend_error', status }
  }

  // 3) refresh cache
  try {
    await env.KV.put(KV_PREFIX.allowlist, JSON.stringify({ ids, at: new Date().toISOString() }), {
      expirationTtl: LIMITS.ALLOWLIST_TTL_S,
    })
  } catch (err) {
    log.warn('allowlist_cache_write_failed', describeError(err))
  }

  return classify(ids, telegramUserId)
}

function classify(ids: number[], telegramUserId: number): AuthOutcome {
  return ids.includes(telegramUserId) ? { result: 'allowed' } : { result: 'denied' }
}

/** Unified generic denial — leaks nothing about the system (Prompt 6 §4). */
export const UNAUTHORIZED_TEXT =
  '⛔ You are not authorized to use this bot.\nIf you believe this is a mistake, contact the operator.'

/**
 * Conversation state (Prompt 6 §7) — KV ONLY, with TTL, secret-free.
 *
 * Key shape:  telegram:session:{user_id}
 * TTL:        600s (SESSION_TTL_S) — stale flows self-expire
 * Content:    view + cursor bookkeeping; NEVER secrets or credentials.
 *
 * v1 views are stateless-by-callback-data (cursor travels in the callback),
 * so the session store exists for (a) flows that later need multi-step
 * state, and (b) a "current view" hint for refresh-style operations.
 */

import { KV_PREFIX, LIMITS } from '../config'
import type { BotView } from '../telegram/keyboard'

export interface BotSession {
  userId: number
  view: BotView
  cursor?: string
  updatedAt: string
}

export async function getSession(env: { KV: KVNamespace }, userId: number): Promise<BotSession | null> {
  try {
    return await env.KV.get<BotSession>(KV_PREFIX.session + userId, 'json')
  } catch {
    return null
  }
}

export async function setSession(
  env: { KV: KVNamespace },
  userId: number,
  view: BotView,
  cursor?: string,
): Promise<void> {
  try {
    const session: BotSession = {
      userId,
      view,
      cursor,
      updatedAt: new Date().toISOString(),
    }
    await env.KV.put(KV_PREFIX.session + userId, JSON.stringify(session), {
      expirationTtl: LIMITS.SESSION_TTL_S,
    })
  } catch {
    /* state is best-effort; never fail a command over it */
  }
}

export async function clearSession(env: { KV: KVNamespace }, userId: number): Promise<void> {
  try {
    await env.KV.delete(KV_PREFIX.session + userId)
  } catch {
    /* ignore */
  }
}

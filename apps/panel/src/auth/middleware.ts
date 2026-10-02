/**
 * The four independent authentication domains (Prompt 4 §3) + scope/ownership
 * gatekeeping (§4). Each route group accepts EXACTLY one domain.
 *
 * IMPORTANT (Hono compose semantics): authenticate* helpers do NOT call
 * next() — gates run authentication, then the scope check, then call next()
 * exactly once. A wrong-scope bot is rejected BEFORE the handler runs.
 */
import type { Context, Next } from 'hono'
import type { CybEnv, Ctx } from '../ctx'
import { ApiError } from '../http'
import { getSession, parseSessionCookie, touchSession, verifyCsrf, type SessionRecord } from './session'
import { sha256Hex } from './tokens'

type AnyCtx = Context<CybEnv>

/* ------------------------------ authentication ------------------------------ */

/** Session authentication only (no next). Throws 401/SESSION_EXPIRED. */
export async function authenticateAdmin(c: AnyCtx): Promise<{ adminId: string; sessionKey: string; session: SessionRecord }> {
  const now = Math.floor(Date.now() / 1000)
  const sid = parseSessionCookie(c.req.header('cookie'))
  if (!sid) throw new ApiError('UNAUTHORIZED', 'Authentication required')
  const rec: SessionRecord | null = await getSession(c.env.KV, sid)
  if (!rec) throw new ApiError('SESSION_EXPIRED', 'Session has expired')
  if (now - rec.iat > 24 * 3600) throw new ApiError('SESSION_EXPIRED', 'Session has expired')
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(c.req.method)) {
    if (!verifyCsrf(rec, c.req.header('x-csrf-token'))) {
      throw new ApiError('CSRF_FAILED', 'Missing or invalid CSRF token')
    }
  }
  await touchSession(c.env.KV, sid, rec, now)
  c.set('ctx', {
    env: c.env,
    now,
    requestId: c.get('requestId') ?? '',
    waitUntil: (p: Promise<unknown>) => c.executionCtx.waitUntil(p),
    actor: { kind: 'admin', adminId: rec.admin_id, sessionKey: sid, session: rec },
  })
  return { adminId: rec.admin_id, sessionKey: sid, session: rec }
}

/** Bot authentication only (no next). Throws 401/TOKEN_*. */
export async function authenticateBot(c: AnyCtx): Promise<{ clientId: string; name: string; scopes: string[] }> {
  const auth = c.req.header('authorization') ?? ''
  if (!/^Bearer cbx_bot_[A-Za-z0-9_-]{43}$/.test(auth)) {
    throw new ApiError('UNAUTHORIZED', 'Authentication required')
  }
  const hash = await sha256Hex(auth.slice(7))
  const row = await c.env.DB.prepare(
    `SELECT id, name, scopes, status, last_used_at FROM api_clients WHERE token_hash = ?`,
  )
    .bind(hash)
    .first<{ id: string; name: string; scopes: string; status: string; last_used_at: number | null }>()
  if (!row) throw new ApiError('TOKEN_INVALID', 'Token is invalid')
  if (row.status === 'revoked') throw new ApiError('TOKEN_REVOKED', 'Token has been revoked')
  let scopes: string[] = []
  try {
    scopes = JSON.parse(row.scopes) as string[]
  } catch {
    scopes = []
  }
  const now = Math.floor(Date.now() / 1000)
  c.set('ctx', {
    env: c.env,
    now,
    requestId: c.get('requestId') ?? '',
    waitUntil: (p: Promise<unknown>) => c.executionCtx.waitUntil(p),
    actor: { kind: 'bot', clientId: row.id, name: row.name, scopes },
  })
  if (!row.last_used_at || now - row.last_used_at >= 60) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare(`UPDATE api_clients SET last_used_at = ? WHERE id = ?`).bind(now, row.id).run(),
    )
  }
  return { clientId: row.id, name: row.name, scopes }
}

/** Relay authentication only (no next). Throws 401, TOKEN_REVOKED, 410, 403. */
export async function authenticateRelay(c: AnyCtx): Promise<{ relayId: string; tokenId: string }> {
  const auth = c.req.header('authorization') ?? ''
  if (!/^Bearer cbx_rl_[A-Za-z0-9_-]{43}$/.test(auth)) {
    throw new ApiError('UNAUTHORIZED', 'Authentication required')
  }
  const hash = await sha256Hex(auth.slice(7))
  const row = await c.env.DB.prepare(`SELECT id, relay_id, status FROM relay_tokens WHERE token_hash = ?`)
    .bind(hash)
    .first<{ id: string; relay_id: string; status: string }>()
  if (!row) throw new ApiError('TOKEN_INVALID', 'Token is invalid')
  if (row.status !== 'active') throw new ApiError('TOKEN_REVOKED', 'Token has been revoked')
  const relay = await c.env.DB.prepare(`SELECT status, deleted_at FROM relays WHERE id = ?`)
    .bind(row.relay_id)
    .first<{ status: string; deleted_at: number | null }>()
  if (!relay || relay.deleted_at) throw new ApiError('RESOURCE_DELETED', 'This relay has been deleted')
  if (relay.status !== 'active') throw new ApiError('FORBIDDEN', 'Relay is disabled', { reason: 'relay_disabled' })
  c.set('ctx', {
    env: c.env,
    now: Math.floor(Date.now() / 1000),
    requestId: c.get('requestId') ?? '',
    waitUntil: (p: Promise<unknown>) => c.executionCtx.waitUntil(p),
    actor: { kind: 'relay', relayId: row.relay_id, tokenId: row.id },
  })
  c.executionCtx.waitUntil(
    c.env.DB.prepare(`UPDATE relay_tokens SET last_used_at = ? WHERE id = ?`).bind(Math.floor(Date.now() / 1000), row.id).run(),
  )
  return { relayId: row.relay_id, tokenId: row.id }
}

/** Subscription authentication only (no next). */
export async function authenticateSubscription(c: AnyCtx): Promise<{ subscriptionId: string; userId: string; status: string }> {
  const auth = c.req.header('authorization') ?? ''
  if (!/^Bearer cbx_sub_[A-Za-z0-9_-]{43}$/.test(auth)) {
    throw new ApiError('UNAUTHORIZED', 'Authentication required')
  }
  const hash = await sha256Hex(auth.slice(7))
  const row = await c.env.DB.prepare(`SELECT id, user_id, status, deleted_at FROM subscriptions WHERE token_hash = ?`)
    .bind(hash)
    .first<{ id: string; user_id: string; status: string; deleted_at: number | null }>()
  if (!row) throw new ApiError('TOKEN_INVALID', 'Token is invalid')
  if (row.status === 'revoked' || row.deleted_at) throw new ApiError('TOKEN_REVOKED', 'Token has been revoked')
  c.set('ctx', {
    env: c.env,
    now: Math.floor(Date.now() / 1000),
    requestId: c.get('requestId') ?? '',
    waitUntil: (p: Promise<unknown>) => c.executionCtx.waitUntil(p),
    actor: { kind: 'subscription', subscriptionId: row.id, userId: row.user_id, status: row.status },
  })
  return { subscriptionId: row.id, userId: row.user_id, status: row.status }
}

/* ------------------------------ middleware wrappers ------------------------------ */

export async function requireAdmin(c: AnyCtx, next: Next): Promise<void> {
  await authenticateAdmin(c)
  await next()
}

export async function requireBot(c: AnyCtx, next: Next): Promise<void> {
  await authenticateBot(c)
  await next()
}

export async function requireRelay(c: AnyCtx, next: Next): Promise<void> {
  await authenticateRelay(c)
  await next()
}

export async function requireSubscription(c: AnyCtx, next: Next): Promise<void> {
  await authenticateSubscription(c)
  await next()
}

export function getCtx(c: AnyCtx): Ctx {
  const ctx: Ctx | undefined = c.get('ctx')
  if (!ctx) throw new ApiError('INTERNAL_ERROR')
  return ctx
}

/** Throw 403 when the authenticated bot lacks `scope`. */
export function assertScope(c: AnyCtx, scope: string): void {
  const ctx = getCtx(c)
  if (ctx.actor.kind === 'bot' && !ctx.actor.scopes.includes(scope)) {
    throw new ApiError('FORBIDDEN', 'Insufficient scope', { reason: 'missing_scope', scope })
  }
}

/** Relay self-scope enforcement (§4.2). */
export function assertRelaySelf(ctx: Ctx, pathId: string): void {
  if (ctx.actor.kind !== 'relay' || ctx.actor.relayId !== pathId) {
    throw new ApiError('FORBIDDEN', 'Cross-relay access denied', { reason: 'relay_mismatch' })
  }
}

/**
 * Dual-domain gate (§4.3): admin session always passes; a bot token must
 * carry the read scope (GET) or write scope (state-changing methods).
 */
export function requireAdminOrBot(readScope: string, writeScope?: string) {
  return async (c: AnyCtx, next: Next): Promise<void> => {
    const cookie = parseSessionCookie(c.req.header('cookie'))
    if (cookie) {
      await authenticateAdmin(c)
    } else {
      if (!c.req.header('authorization')) throw new ApiError('UNAUTHORIZED', 'Authentication required')
      const { scopes } = await authenticateBot(c)
      const needed = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(c.req.method) ? (writeScope ?? readScope) : readScope
      if (!scopes.includes(needed)) {
        throw new ApiError('FORBIDDEN', 'Insufficient scope', { reason: 'missing_scope', scope: needed })
      }
    }
    await next()
  }
}

/** Admin-only gate (no bot path). */
export function requireAdminOnly() {
  return async (c: AnyCtx, next: Next): Promise<void> => {
    const cookie = parseSessionCookie(c.req.header('cookie'))
    if (cookie) {
      await authenticateAdmin(c)
      await next()
      return
    }
    throw new ApiError('UNAUTHORIZED', 'Authentication required')
  }
}

/**
 * Subscriptions (Prompt 4 §10.11) — management plane + public subscription
 * plane. Multiple active subscriptions per user are ALLOWED (Prompt 3 decision).
 * Raw token appears exactly once (issue/rotate).
 */
import { Hono } from 'hono'
import type { Env } from '../env'
import type { CybEnv } from '../ctx'
import { ApiError, noContent, ok, readJsonBody } from '../http'
import { BodyReader, assertValid, checkQuery, isUuid } from '../validate'
import { getCtx, requireAdminOrBot, requireSubscription } from '../auth/middleware'
import { deletedClause, paginate, parseListQuery } from '../list'
import { configOut, subscriptionOut, userOut, bytesStr } from '../serialize'
import { writeAudit } from '../audit'
import { generateToken } from '../auth/tokens'
import { decryptCredential } from '../crypto/credential'
import { checkRate, rateHeaders } from '../ratelimit'
import { ApiError as HttpApiError } from '../http'

export const userSubscriptions = new Hono<CybEnv>()
export const subscriptionPublic = new Hono<CybEnv>()

const SUB_LIST_PARAMS = ['status', 'deleted', 'sort', 'order', 'limit', 'cursor'] as const

userSubscriptions.use('*', requireAdminOrBot('subscriptions:read', 'subscriptions:write'))

userSubscriptions.use('*', async (c, next) => {
  const issues = checkQuery(new URL(c.req.url), SUB_LIST_PARAMS)
  if (issues.length > 0 && c.req.method === 'GET') throw new ApiError('VALIDATION_ERROR', 'Request validation failed', issues)
  await next()
})

async function loadUser(c: { env: Env }, userId: string): Promise<void> {
  const u = await c.env.DB.prepare(`SELECT id, deleted_at FROM users WHERE id = ?`).bind(userId).first<{ id: string; deleted_at: number | null }>()
  if (!u || u.deleted_at) throw new ApiError('NOT_FOUND')
}

userSubscriptions.get('/', async (c) => {
  const userId = c.req.param('userId')!
  if (!isUuid(userId)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'user_id', issue: 'must be a UUIDv4' }])
  const url = new URL(c.req.url)
  const params = parseListQuery(url, 'subscriptions')
  const page = paginate(params)
  const conds = ['user_id = ?', deletedClause(params)]
  const vals: unknown[] = [userId]
  const status = url.searchParams.get('status')
  if (status) {
    if (status !== 'active' && status !== 'revoked') throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'status', issue: 'must be active|revoked' }])
    conds.push('status = ?')
    vals.push(status)
  }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM subscriptions WHERE ${conds.join(' AND ')}${page.where} ${page.orderClause} LIMIT ?`,
  )
    .bind(...vals, ...page.params, params.limit + 1)
    .all<Record<string, unknown>>()
  let data = rows.results ?? []
  let hasMore = false
  if (data.length > params.limit) {
    hasMore = true
    data = data.slice(0, params.limit)
  }
  return ok(c, data.map(subscriptionOut), { pagination: { limit: params.limit, next_cursor: hasMore ? page.nextCursor(data) : null, has_more: hasMore } })
})

userSubscriptions.post('/', async (c) => {
  const ctx = getCtx(c)
  const userId = c.req.param('userId')!
  if (!isUuid(userId)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'user_id', issue: 'must be a UUIDv4' }])
  const { issues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (issues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', issues)
  await loadUser(c, userId)
  const { token, hash, prefix } = await generateToken('subscription')
  const now = Math.floor(Date.now() / 1000)
  const id = crypto.randomUUID()
  await c.env.DB.prepare(
    `INSERT INTO subscriptions (id, user_id, status, token_hash, token_prefix, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?, ?)`,
  )
    .bind(id, userId, hash, prefix, now, now)
    .run()
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.kind === 'admin' ? ctx.actor.adminId : ctx.actor.kind === 'bot' ? ctx.actor.clientId : null, action: 'subscription.create', entity_type: 'subscription', entity_id: id, request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  const row = await c.env.DB.prepare(`SELECT * FROM subscriptions WHERE id = ?`).bind(id).first<Record<string, unknown>>()
  return ok(c, { subscription: subscriptionOut(row ?? {}), token, issued_at: now }, undefined, 201)
})

async function loadSub(c: { env: Env }, userId: string, subId: string): Promise<Record<string, unknown>> {
  const row = await c.env.DB.prepare(`SELECT * FROM subscriptions WHERE id = ? AND user_id = ?`).bind(subId, userId).first<Record<string, unknown>>()
  if (!row || row.deleted_at) throw new ApiError('NOT_FOUND')
  return row
}

userSubscriptions.get('/:id', async (c) => {
  const userId = c.req.param('userId')!
  const subId = c.req.param('id')!
  if (!isUuid(subId)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await loadSub(c, userId, subId)
  return ok(c, subscriptionOut(row))
})

userSubscriptions.patch('/:id', async (c) => {
  const ctx = getCtx(c)
  const userId = c.req.param('userId')!
  const subId = c.req.param('id')!
  if (!isUuid(subId)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await loadSub(c, userId, subId)
  const { body, issues: bodyIssues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (bodyIssues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', bodyIssues)
  const r = new BodyReader(body as Record<string, unknown>, ['status'])
  const status = r.enum('status', ['active', 'revoked'], { required: true })
  assertValid(r.issues)
  await c.env.DB.prepare(`UPDATE subscriptions SET status = ? WHERE id = ?`).bind(status, subId).run()
  const changed = status !== row.status ? ['status'] : []
  if (changed.length > 0) {
    writeAudit(
      c.env.DB,
      { actor_type: 'admin', actor_id: ctx.actor.kind === 'admin' ? ctx.actor.adminId : ctx.actor.kind === 'bot' ? ctx.actor.clientId : null, action: 'subscription.update', entity_type: 'subscription', entity_id: subId, metadata: { changed }, request_id: ctx.requestId },
      (p) => ctx.waitUntil(p),
    )
  }
  const updated = await c.env.DB.prepare(`SELECT * FROM subscriptions WHERE id = ?`).bind(subId).first<Record<string, unknown>>()
  return ok(c, subscriptionOut(updated ?? {}))
})

userSubscriptions.delete('/:id', async (c) => {
  const ctx = getCtx(c)
  const userId = c.req.param('userId')!
  const subId = c.req.param('id')!
  if (!isUuid(subId)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await loadSub(c, userId, subId)
  if (!row.deleted_at) {
    await c.env.DB.prepare(`UPDATE subscriptions SET deleted_at = strftime('%s','now'), status = 'revoked' WHERE id = ?`).bind(subId).run()
    writeAudit(
      c.env.DB,
      { actor_type: 'admin', actor_id: ctx.actor.kind === 'admin' ? ctx.actor.adminId : ctx.actor.kind === 'bot' ? ctx.actor.clientId : null, action: 'subscription.delete', entity_type: 'subscription', entity_id: subId, request_id: ctx.requestId },
      (p) => ctx.waitUntil(p),
    )
  }
  return noContent(c)
})

userSubscriptions.post('/:id/rotate', async (c) => {
  const ctx = getCtx(c)
  const userId = c.req.param('userId')!
  const subId = c.req.param('id')!
  if (!isUuid(subId)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  await loadSub(c, userId, subId)
  const { token, hash, prefix } = await generateToken('subscription')
  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare(`UPDATE subscriptions SET token_hash = ?, token_prefix = ?, updated_at = ? WHERE id = ?`)
    .bind(hash, prefix, now, subId)
    .run()
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.kind === 'admin' ? ctx.actor.adminId : ctx.actor.kind === 'bot' ? ctx.actor.clientId : null, action: 'subscription.rotate', entity_type: 'subscription', entity_id: subId, request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  const row = await c.env.DB.prepare(`SELECT * FROM subscriptions WHERE id = ?`).bind(subId).first<Record<string, unknown>>()
  return ok(c, { subscription: subscriptionOut(row ?? {}), token, issued_at: now }, undefined, 201)
})

userSubscriptions.post('/:id/revoke', async (c) => {
  const ctx = getCtx(c)
  const userId = c.req.param('userId')!
  const subId = c.req.param('id')!
  if (!isUuid(subId)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await loadSub(c, userId, subId)
  if (row.status !== 'revoked') {
    await c.env.DB.prepare(`UPDATE subscriptions SET status = 'revoked' WHERE id = ?`).bind(subId).run()
    writeAudit(
      c.env.DB,
      { actor_type: 'admin', actor_id: ctx.actor.kind === 'admin' ? ctx.actor.adminId : ctx.actor.kind === 'bot' ? ctx.actor.clientId : null, action: 'subscription.revoke', entity_type: 'subscription', entity_id: subId, request_id: ctx.requestId },
      (p) => ctx.waitUntil(p),
    )
  }
  return noContent(c)
})

/* ------------------------- public subscription plane ------------------------- */

subscriptionPublic.get('/', requireSubscription, async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'subscription') throw new ApiError('UNAUTHORIZED')
  const verdict = await checkRate(c.env.KV, 'subscription', ctx.actor.subscriptionId, ctx.now)
  if (!verdict.allowed) {
    return new Response(
      JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests', request_id: ctx.requestId } }),
      { status: 429, headers: { 'Content-Type': 'application/json; charset=utf-8', ...rateHeaders(verdict) } },
    )
  }
  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(ctx.actor.userId).first<Record<string, unknown>>()
  if (!user || user.deleted_at) {
    throw new ApiError('FORBIDDEN', 'Access denied', { reason: 'user_deleted' })
  }
  if (user.status !== 'active') throw new ApiError('FORBIDDEN', 'Access denied', { reason: 'user_disabled' })
  const expiresAt = user.expires_at as number | null
  if (expiresAt !== null && expiresAt !== undefined && expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new ApiError('FORBIDDEN', 'Access denied', { reason: 'user_expired' })
  }
  // configs with a path only (XOR both-NULL = no path → excluded, §10.11)
  const cfgRows = await c.env.DB.prepare(
    `SELECT c.*, r.public_endpoint, r.public_port, r.status AS relay_status
     FROM configs c
     LEFT JOIN relays r ON r.id = c.relay_id
     WHERE c.user_id = ? AND c.deleted_at IS NULL AND (c.upstream_id IS NOT NULL OR c.relay_id IS NOT NULL)`,
  )
    .bind(ctx.actor.userId)
    .all<Record<string, unknown>>()
  const configs: Record<string, unknown>[] = []
  for (const row of cfgRows.results ?? []) {
    const encrypted = row.credential_encrypted as string | null
    const credential = encrypted ? JSON.parse(await decryptCredential(encrypted, c.env.DATA_ENCRYPTION_KEY)) as Record<string, unknown> : null
    let address: string | null = null
    let port: number | null = null
    if (row.relay_id) {
      address = (row.public_endpoint as string | null) ?? null
      port = (row.public_port as number | null) ?? null
      if (row.relay_status !== 'active') continue
    } else if (row.upstream_id) {
      const u = await c.env.DB.prepare(`SELECT host, port, status FROM upstreams WHERE id = ?`).bind(row.upstream_id as string).first<{ host: string; port: number; status: string }>()
      if (!u || u.status !== 'active') continue
      address = u.host
      port = u.port
    }
    if (!address || !port) continue
    configs.push({ id: row.id, protocol: row.protocol, address, port, credential })
  }
  // last_accessed_at throttled write (60s) — §10.11
  const now = Math.floor(Date.now() / 1000)
  const last = ctx.actor.subscriptionId
  c.executionCtx.waitUntil(
    c.env.DB.prepare(`UPDATE subscriptions SET last_accessed_at = ? WHERE id = ? AND (last_accessed_at IS NULL OR ? - last_accessed_at >= 60)`)
      .bind(now, last, now)
      .run(),
  )
  const sub = await c.env.DB.prepare(`SELECT * FROM subscriptions WHERE id = ?`).bind(last).first<Record<string, unknown>>()
  return ok(c, {
    subscription: { id: sub?.id, status: sub?.status, created_at: sub?.created_at },
    user: {
      id: user.id,
      status: user.status,
      expires_at: user.expires_at,
      traffic_limit_bytes: bytesStr(user.traffic_limit_bytes),
      traffic_used_bytes: bytesStr(user.traffic_used_bytes) ?? '0',
      traffic_reset_day: user.traffic_reset_day,
      traffic_last_reset_at: user.traffic_last_reset_at,
    },
    configs,
  })
})

export { userOut, configOut }

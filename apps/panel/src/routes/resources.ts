/**
 * Users + Upstreams (Prompt 4 §10.2, §10.4). Soft deletion, cursor pagination,
 * strict validation, audit events with changed-field metadata.
 */
import { Hono } from 'hono'
import type { Env } from '../env'
import type { CybEnv } from '../ctx'
import { ApiError, noContent, ok, readJsonBody } from '../http'
import { BodyReader, assertValid, checkQuery, isUuid } from '../validate'
import { getCtx, requireAdminOrBot } from '../auth/middleware'
import { deletedClause, paginate, parseListQuery } from '../list'
import { upstreamOut, userOut } from '../serialize'
import { writeAudit } from '../audit'

export const users = new Hono<CybEnv>()
export const upstreams = new Hono<CybEnv>()

const USER_LIST_PARAMS = ['status', 'deleted', 'expired', 'q', 'sort', 'order', 'limit', 'cursor', 'include_deleted'] as const
const USER_FIELDS = ['id', 'contact', 'status', 'expires_at', 'traffic_limit_bytes', 'traffic_reset_day'] as const

users.use('*', requireAdminOrBot('users:read', 'users:write'))
upstreams.use('*', requireAdminOrBot('upstreams:read', 'upstreams:write'))

users.use('*', async (c, next) => {
  // nested sub-resources (configs/subscriptions/usage) carry their own param contracts
  if (!/(\/configs|\/subscriptions|\/usage)/.test(c.req.path)) {
    const issues = checkQuery(new URL(c.req.url), USER_LIST_PARAMS)
    if (issues.length > 0 && c.req.method === 'GET') throw new ApiError('VALIDATION_ERROR', 'Request validation failed', issues)
  }
  await next()
})

users.get('/', async (c) => {
  const url = new URL(c.req.url)
  const params = parseListQuery(url, 'users')
  const page = paginate(params)
  const conds = [deletedClause(params)]
  const vals: unknown[] = []
  const status = url.searchParams.get('status')
  if (status) {
    if (status !== 'active' && status !== 'disabled') throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'status', issue: 'must be active|disabled' }])
    conds.push('status = ?')
    vals.push(status)
  }
  const expired = url.searchParams.get('expired')
  if (expired === 'true') {
    conds.push('(expires_at IS NOT NULL AND expires_at <= ?)')
    vals.push(Math.floor(Date.now() / 1000))
  } else if (expired === 'false') {
    conds.push('(expires_at IS NULL OR expires_at > ?)')
    vals.push(Math.floor(Date.now() / 1000))
  }
  if (params.q) {
    conds.push("contact LIKE ? ESCAPE '\\'")
    vals.push(`%${params.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
  }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM users WHERE ${conds.join(' AND ')}${page.where} ${page.orderClause} LIMIT ?`,
  )
    .bind(...vals, ...page.params, params.limit + 1)
    .all<Record<string, unknown>>()
  let data = rows.results ?? []
  let hasMore = false
  if (data.length > params.limit) {
    hasMore = true
    data = data.slice(0, params.limit)
  }
  const meta: Record<string, unknown> = { pagination: { limit: params.limit, next_cursor: hasMore ? page.nextCursor(data) : null, has_more: hasMore } }
  return ok(c, data.map(userOut), meta)
})

users.post('/', async (c) => {
  const ctx = getCtx(c)
  const { body, issues: bodyIssues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (bodyIssues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', bodyIssues)
  const r = new BodyReader(body as Record<string, unknown>, [...USER_FIELDS])
  const id = (body as Record<string, unknown>)['id']
  if (id !== undefined && !isUuid(id)) r.issues.push({ location: 'body', field: 'id', issue: 'must be a UUIDv4' })
  const contact = r.str('contact', { required: true, min: 1, max: 256 })
  const status = r.enum('status', ['active', 'disabled']) ?? 'active'
  const expiresAt = r.int('expires_at', { nullable: true })
  const limitBytes = r.bytes('traffic_limit_bytes', { nullable: true })
  const resetDay = r.int('traffic_reset_day', { nullable: true, min: 1, max: 28 })
  assertValid(r.issues)
  const now = Math.floor(Date.now() / 1000)
  const finalId = (id as string | undefined) ?? crypto.randomUUID()
  try {
    await c.env.DB.prepare(
      `INSERT INTO users (id, contact, status, expires_at, traffic_limit_bytes, traffic_reset_day, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(finalId, contact, status, expiresAt ?? null, limitBytes === undefined || limitBytes === null ? null : limitBytes, resetDay ?? null, now, now)
      .run()
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('UNIQUE')) throw new ApiError('CONFLICT', 'Resource already exists', { issue: 'duplicate_id_or_contact' })
    throw err
  }
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.kind === 'admin' ? ctx.actor.adminId : ctx.actor.kind === 'bot' ? ctx.actor.clientId : null, action: 'user.create', entity_type: 'user', entity_id: finalId, request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  const row = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(finalId).first<Record<string, unknown>>()
  return ok(c, userOut(row ?? {}), undefined, 201)
})

users.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const includeDeleted = new URL(c.req.url).searchParams.get('include_deleted') === 'true'
  const row = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<Record<string, unknown>>()
  if (!row) throw new ApiError('NOT_FOUND')
  if (row.deleted_at && !includeDeleted) throw new ApiError('NOT_FOUND')
  return ok(c, userOut(row))
})

users.patch('/:id', async (c) => {
  const ctx = getCtx(c)
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL`).bind(id).first<Record<string, unknown>>()
  if (!row) throw new ApiError('NOT_FOUND')
  const { body, issues: bodyIssues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (bodyIssues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', bodyIssues)
  const r = new BodyReader(body as Record<string, unknown>, [...USER_FIELDS.filter((f) => f !== 'id')])
  const contact = r.str('contact', { min: 1, max: 256 })
  const status = r.enum('status', ['active', 'disabled'])
  const expiresAt = r.int('expires_at', { nullable: true })
  const limitBytes = r.bytes('traffic_limit_bytes', { nullable: true })
  const resetDay = r.int('traffic_reset_day', { nullable: true, min: 1, max: 28 })
  assertValid(r.issues)
  const next = {
    contact: contact !== undefined ? contact : (row.contact as string),
    status: status !== undefined ? status : (row.status as string),
    expires_at: expiresAt !== undefined ? expiresAt : (row.expires_at as number | null),
    traffic_limit_bytes:
      limitBytes !== undefined
        ? limitBytes === null
          ? null
          : limitBytes
        : (row.traffic_limit_bytes as string | number | null),
    traffic_reset_day: resetDay !== undefined ? resetDay : (row.traffic_reset_day as number | null),
  }
  await c.env.DB.prepare(
    `UPDATE users SET contact = ?, status = ?, expires_at = ?, traffic_limit_bytes = ?, traffic_reset_day = ? WHERE id = ?`,
  )
    .bind(next.contact, next.status, next.expires_at, next.traffic_limit_bytes, next.traffic_reset_day, id)
    .run()
  const changed = ['contact', 'status', 'expires_at', 'traffic_limit_bytes', 'traffic_reset_day'].filter((f) => {
    const k = f === 'contact' ? 'contact' : f
    return JSON.stringify(next[k as keyof typeof next]) !== JSON.stringify(row[f === 'contact' ? 'contact' : f])
  })
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.kind === 'admin' ? ctx.actor.adminId : ctx.actor.kind === 'bot' ? ctx.actor.clientId : null, action: 'user.update', entity_type: 'user', entity_id: id, metadata: { changed }, request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  const updated = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<Record<string, unknown>>()
  return ok(c, userOut(updated ?? {}))
})

users.delete('/:id', async (c) => {
  const ctx = getCtx(c)
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await c.env.DB.prepare(`SELECT id, deleted_at FROM users WHERE id = ?`).bind(id).first<{ id: string; deleted_at: number | null }>()
  if (!row) throw new ApiError('NOT_FOUND')
  if (!row.deleted_at) {
    await c.env.DB.prepare(`UPDATE users SET deleted_at = strftime('%s','now') WHERE id = ?`).bind(id).run()
    writeAudit(
      c.env.DB,
      { actor_type: 'admin', actor_id: ctx.actor.kind === 'admin' ? ctx.actor.adminId : ctx.actor.kind === 'bot' ? ctx.actor.clientId : null, action: 'user.delete', entity_type: 'user', entity_id: id, request_id: ctx.requestId },
      (p) => ctx.waitUntil(p),
    )
  }
  return noContent(c)
})

/* ------------------------------ upstreams ------------------------------ */

const UPSTREAM_LIST_PARAMS = ['type', 'status', 'q', 'deleted', 'sort', 'order', 'limit', 'cursor'] as const

upstreams.use('*', async (c, next) => {
  const issues = checkQuery(new URL(c.req.url), UPSTREAM_LIST_PARAMS)
  if (issues.length > 0 && c.req.method === 'GET') throw new ApiError('VALIDATION_ERROR', 'Request validation failed', issues)
  await next()
})

function actorIdentity(ctx: ReturnType<typeof getCtx>): string | null {
  if (ctx.actor.kind === 'admin') return ctx.actor.adminId
  if (ctx.actor.kind === 'bot') return ctx.actor.clientId
  return null
}

upstreams.get('/', async (c) => {
  const url = new URL(c.req.url)
  const params = parseListQuery(url, 'upstreams')
  const page = paginate(params)
  const conds = [deletedClause(params)]
  const vals: unknown[] = []
  const type = url.searchParams.get('type')
  if (type) {
    conds.push('type = ?')
    vals.push(type)
  }
  const status = url.searchParams.get('status')
  if (status) {
    if (status !== 'active' && status !== 'disabled') throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'status', issue: 'must be active|disabled' }])
    conds.push('status = ?')
    vals.push(status)
  }
  if (params.q) {
    conds.push("host LIKE ? ESCAPE '\\'")
    vals.push(`%${params.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
  }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM upstreams WHERE ${conds.join(' AND ')}${page.where} ${page.orderClause} LIMIT ?`,
  )
    .bind(...vals, ...page.params, params.limit + 1)
    .all<Record<string, unknown>>()
  let data = rows.results ?? []
  let hasMore = false
  if (data.length > params.limit) {
    hasMore = true
    data = data.slice(0, params.limit)
  }
  return ok(c, data.map(upstreamOut), { pagination: { limit: params.limit, next_cursor: hasMore ? page.nextCursor(data) : null, has_more: hasMore } })
})

upstreams.post('/', async (c) => {
  const ctx = getCtx(c)
  const { body, issues: bodyIssues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (bodyIssues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', bodyIssues)
  const r = new BodyReader(body as Record<string, unknown>, ['id', 'type', 'host', 'port', 'status'])
  const id = (body as Record<string, unknown>)['id']
  if (id !== undefined && !isUuid(id)) r.issues.push({ location: 'body', field: 'id', issue: 'must be a UUIDv4' })
  const type = r.str('type', { required: true, min: 1, max: 32, pattern: /^[a-z0-9_-]+$/ })
  const host = r.str('host', { required: true, min: 1, max: 253, pattern: /^[A-Za-z0-9._-]+$/ })
  const port = r.int('port', { required: true, min: 1, max: 65535 })
  const status = r.enum('status', ['active', 'disabled']) ?? 'active'
  assertValid(r.issues)
  const now = Math.floor(Date.now() / 1000)
  const finalId = (id as string | undefined) ?? crypto.randomUUID()
  try {
    await c.env.DB.prepare(
      `INSERT INTO upstreams (id, type, host, port, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(finalId, type, host, port, status, now, now)
      .run()
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('UNIQUE')) throw new ApiError('CONFLICT', 'Resource already exists', { issue: 'duplicate_id' })
    throw err
  }
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: actorIdentity(ctx), action: 'upstream.create', entity_type: 'upstream', entity_id: finalId, request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  const row = await c.env.DB.prepare(`SELECT * FROM upstreams WHERE id = ?`).bind(finalId).first<Record<string, unknown>>()
  return ok(c, upstreamOut(row ?? {}), undefined, 201)
})

upstreams.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await c.env.DB.prepare(`SELECT * FROM upstreams WHERE id = ?`).bind(id).first<Record<string, unknown>>()
  if (!row || row.deleted_at) throw new ApiError('NOT_FOUND')
  return ok(c, upstreamOut(row))
})

upstreams.patch('/:id', async (c) => {
  const ctx = getCtx(c)
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await c.env.DB.prepare(`SELECT * FROM upstreams WHERE id = ? AND deleted_at IS NULL`).bind(id).first<Record<string, unknown>>()
  if (!row) throw new ApiError('NOT_FOUND')
  const { body, issues: bodyIssues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (bodyIssues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', bodyIssues)
  const r = new BodyReader(body as Record<string, unknown>, ['type', 'host', 'port', 'status'])
  const type = r.str('type', { min: 1, max: 32, pattern: /^[a-z0-9_-]+$/ })
  const host = r.str('host', { min: 1, max: 253, pattern: /^[A-Za-z0-9._-]+$/ })
  const port = r.int('port', { min: 1, max: 65535 })
  const status = r.enum('status', ['active', 'disabled'])
  assertValid(r.issues)
  const next = {
    type: type ?? (row.type as string),
    host: host ?? (row.host as string),
    port: port ?? (row.port as number),
    status: status ?? (row.status as string),
  }
  await c.env.DB.prepare(`UPDATE upstreams SET type = ?, host = ?, port = ?, status = ? WHERE id = ?`)
    .bind(next.type, next.host, next.port, next.status, id)
    .run()
  const changed = Object.keys(next).filter((k) => JSON.stringify(next[k as keyof typeof next]) !== JSON.stringify(row[k]))
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: actorIdentity(ctx), action: 'upstream.update', entity_type: 'upstream', entity_id: id, metadata: { changed }, request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  const updated = await c.env.DB.prepare(`SELECT * FROM upstreams WHERE id = ?`).bind(id).first<Record<string, unknown>>()
  return ok(c, upstreamOut(updated ?? {}))
})

upstreams.delete('/:id', async (c) => {
  const ctx = getCtx(c)
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await c.env.DB.prepare(`SELECT id, deleted_at FROM upstreams WHERE id = ?`).bind(id).first<{ id: string; deleted_at: number | null }>()
  if (!row) throw new ApiError('NOT_FOUND')
  if (!row.deleted_at) {
    const ref = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM configs WHERE upstream_id = ? AND deleted_at IS NULL`).bind(id).first<{ n: number }>()
    if ((ref?.n ?? 0) > 0) throw new ApiError('CONFLICT', 'Referenced by a live config', { issue: 'referential_guard' })
    await c.env.DB.prepare(`UPDATE upstreams SET deleted_at = strftime('%s','now') WHERE id = ?`).bind(id).run()
    writeAudit(
      c.env.DB,
      { actor_type: 'admin', actor_id: actorIdentity(ctx), action: 'upstream.delete', entity_type: 'upstream', entity_id: id, request_id: ctx.requestId },
      (p) => ctx.waitUntil(p),
    )
  }
  return noContent(c)
})

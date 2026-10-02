/**
 * Settings (§10.13) + Telegram Admins (§10.14, both /telegram/admins canonical
 * and /telegram-admins compat path) + API Clients (§10.12).
 */
import { Hono } from 'hono'
import type { Env } from '../env'
import type { CybEnv } from '../ctx'
import { ApiError, noContent, ok, readJsonBody } from '../http'
import { BodyReader, assertValid, checkQuery, isUuid } from '../validate'
import { getCtx, requireAdminOnly, requireAdminOrBot, authenticateAdmin, authenticateBot, assertScope } from '../auth/middleware'
import { paginate, parseListQuery, deletedClause } from '../list'
import { apiClientOut, settingsView, telegramAdminOut } from '../serialize'
import { writeAudit } from '../audit'
import { generateToken } from '../auth/tokens'
import { parseSessionCookie } from '../auth/session'
import type { HelperCtx } from '../ctx'

export const settings = new Hono<CybEnv>()
export const telegramAdmins = new Hono<CybEnv>()
export const apiClients = new Hono<CybEnv>()

/* -------------------------------- settings -------------------------------- */

settings.use('*', async (c, next) => {
  if (c.req.method === 'GET') {
    await requireAdminOrBot('settings:read')(c, next)
  } else {
    await requireAdminOnly()(c, next)
  }
})

settings.get('/', async (c) => {
  const rows = await c.env.DB.prepare(`SELECT key, value FROM settings WHERE key = 'traffic_reset_default_day'`).all<Record<string, unknown>>()
  const migrations = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM d1_migrations`).first<{ n: number }>().catch(() => null)
  const schemaVersion = migrations?.n ?? 5
  return ok(c, settingsView(rows.results ?? [], schemaVersion))
})

settings.patch('/', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('FORBIDDEN')
  const { body, issues: bodyIssues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (bodyIssues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', bodyIssues)
  const r = new BodyReader(body as Record<string, unknown>, ['traffic_reset_default_day'])
  const day = r.int('traffic_reset_default_day', { min: 1, max: 28 })
  assertValid(r.issues)
  const before = await c.env.DB.prepare(`SELECT value FROM settings WHERE key = 'traffic_reset_default_day'`).first<{ value: string }>()
  const from = before ? Number(JSON.parse(before.value)) : null
  if (day !== undefined) {
    await c.env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('traffic_reset_default_day', ?, strftime('%s','now'))
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
      .bind(JSON.stringify(day))
      .run()
    writeAudit(
      c.env.DB,
      { actor_type: 'admin', actor_id: ctx.actor.adminId, action: 'settings.update', entity_type: 'settings', entity_id: 'traffic_reset_default_day', metadata: { changed: ['traffic_reset_default_day'], from, to: day }, request_id: ctx.requestId },
      (p) => ctx.waitUntil(p),
    )
  }
  const rows = await c.env.DB.prepare(`SELECT key, value FROM settings WHERE key = 'traffic_reset_default_day'`).all<Record<string, unknown>>()
  const migrations = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM d1_migrations`).first<{ n: number }>().catch(() => null)
  return ok(c, settingsView(rows.results ?? [], migrations?.n ?? 5))
})

/* ----------------------------- telegram admins ----------------------------- */

const TG_PARAMS = ['status', 'q', 'deleted', 'sort', 'order', 'limit', 'cursor'] as const

// Allowlist surface (GAP-B1): admin session OR bot token — GET list requires
// telegram_admins:read, POST /verify requires telegram:verify.
telegramAdmins.use('*', async (c, next) => {
  const cookie = parseSessionCookie(c.req.header('cookie'))
  if (cookie) {
    await authenticateAdmin(c)
  } else if (c.req.path.endsWith('/verify')) {
    await authenticateBot(c)
    assertScope(c, 'telegram:verify')
  } else if (c.req.method === 'GET') {
    await authenticateBot(c)
    assertScope(c, 'telegram_admins:read')
  } else {
    throw new ApiError('UNAUTHORIZED', 'Authentication required')
  }
  await next()
})

async function tgList(c: HelperCtx): Promise<Response> {
  const url = new URL(c.req.url)
  const issues = checkQuery(url, TG_PARAMS)
  if (issues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', issues)
  const params = parseListQuery(url, 'telegram_admins')
  const page = paginate(params)
  const conds = [deletedClause(params)]
  const vals: unknown[] = []
  const status = url.searchParams.get('status')
  if (status) {
    if (status !== 'active' && status !== 'revoked') throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'status', issue: 'must be active|revoked' }])
    conds.push('status = ?')
    vals.push(status)
  }
  if (params.q) {
    conds.push('(telegram_user_id LIKE ? OR username LIKE ?)')
    vals.push(`%${params.q}%`, `%${params.q}%`)
  }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM telegram_admins WHERE ${conds.join(' AND ')}${page.where} ${page.orderClause} LIMIT ?`,
  )
    .bind(...vals, ...page.params, params.limit + 1)
    .all<Record<string, unknown>>()
  let data = rows.results ?? []
  let hasMore = false
  if (data.length > params.limit) {
    hasMore = true
    data = data.slice(0, params.limit)
  }
  return ok(c, data.map(telegramAdminOut), { pagination: { limit: params.limit, next_cursor: hasMore ? page.nextCursor(data) : null, has_more: hasMore } })
}

telegramAdmins.get('/', async (c) => tgList(c))

telegramAdmins.post('/', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('FORBIDDEN')
  const { body, issues: bodyIssues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (bodyIssues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', bodyIssues)
  const r = new BodyReader(body as Record<string, unknown>, ['telegram_user_id', 'username', 'note'])
  const telegramUserId = r.str('telegram_user_id', { required: true, min: 1, max: 20, pattern: /^\d{1,20}$/ })
  const username = r.str('username', { max: 64 })
  const note = r.str('note', { max: 256 })
  assertValid(r.issues)
  const now = Math.floor(Date.now() / 1000)
  const id = crypto.randomUUID()
  try {
    await c.env.DB.prepare(
      `INSERT INTO telegram_admins (id, telegram_user_id, username, note, status, added_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
      .bind(id, telegramUserId, username ?? null, note ?? null, ctx.actor.adminId, now, now)
      .run()
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('UNIQUE')) throw new ApiError('CONFLICT', 'telegram_user_id already allowlisted', { issue: 'duplicate_telegram_user_id' })
    throw err
  }
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.adminId, action: 'telegram_admin.create', entity_type: 'telegram_admin', entity_id: id, request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  const row = await c.env.DB.prepare(`SELECT * FROM telegram_admins WHERE id = ?`).bind(id).first<Record<string, unknown>>()
  return ok(c, telegramAdminOut(row ?? {}), undefined, 201)
})

telegramAdmins.patch('/:id', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('FORBIDDEN')
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await c.env.DB.prepare(`SELECT * FROM telegram_admins WHERE id = ? AND deleted_at IS NULL`).bind(id).first<Record<string, unknown>>()
  if (!row) throw new ApiError('NOT_FOUND')
  const { body, issues: bodyIssues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (bodyIssues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', bodyIssues)
  const r = new BodyReader(body as Record<string, unknown>, ['username', 'note', 'status'])
  const username = r.str('username', { max: 64 })
  const note = r.str('note', { max: 256, nullable: true })
  const status = r.enum('status', ['active', 'revoked'])
  assertValid(r.issues)
  await c.env.DB.prepare(`UPDATE telegram_admins SET username = ?, note = ?, status = ? WHERE id = ?`)
    .bind(username ?? (row.username as string | null), note !== undefined ? note : (row.note as string | null), status ?? (row.status as string), id)
    .run()
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.adminId, action: 'telegram_admin.update', entity_type: 'telegram_admin', entity_id: id, request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  const updated = await c.env.DB.prepare(`SELECT * FROM telegram_admins WHERE id = ?`).bind(id).first<Record<string, unknown>>()
  return ok(c, telegramAdminOut(updated ?? {}))
})

telegramAdmins.delete('/:id', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('FORBIDDEN')
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await c.env.DB.prepare(`SELECT id, deleted_at FROM telegram_admins WHERE id = ?`).bind(id).first<{ id: string; deleted_at: number | null }>()
  if (!row) throw new ApiError('NOT_FOUND')
  if (!row.deleted_at) {
    await c.env.DB.prepare(`UPDATE telegram_admins SET deleted_at = strftime('%s','now') WHERE id = ?`).bind(id).run()
    writeAudit(
      c.env.DB,
      { actor_type: 'admin', actor_id: ctx.actor.adminId, action: 'telegram_admin.delete', entity_type: 'telegram_admin', entity_id: id, request_id: ctx.requestId },
      (p) => ctx.waitUntil(p),
    )
  }
  return noContent(c)
})

telegramAdmins.post('/verify', async (c) => {
  const { body, issues: bodyIssues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (bodyIssues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', bodyIssues)
  const r = new BodyReader(body as Record<string, unknown>, ['telegram_user_id'])
  const telegramUserId = r.str('telegram_user_id', { required: true, min: 1, max: 20, pattern: /^\d{1,20}$/ })
  assertValid(r.issues)
  const row = await c.env.DB.prepare(`SELECT id FROM telegram_admins WHERE telegram_user_id = ? AND status = 'active' AND deleted_at IS NULL`)
    .bind(telegramUserId)
    .first<{ id: string }>()
  return ok(c, row ? { allowed: true, admin_id: row.id } : { allowed: false })
})

/* -------------------------------- api clients -------------------------------- */

const AC_PARAMS = ['status', 'q', 'limit', 'cursor'] as const

apiClients.use('*', async (c, next) => {
  if (c.req.method === 'GET' && c.req.path.endsWith('/me')) {
    await authenticateBot(c)
  } else {
    await authenticateAdmin(c)
  }
  await next()
})

apiClients.get('/me', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'bot') throw new ApiError('UNAUTHORIZED')
  const row = await c.env.DB.prepare(`SELECT * FROM api_clients WHERE id = ?`).bind(ctx.actor.clientId).first<Record<string, unknown>>()
  if (!row) throw new ApiError('NOT_FOUND')
  return ok(c, apiClientOut(row))
})

apiClients.get('/', async (c) => {
  const url = new URL(c.req.url)
  const issues = checkQuery(url, AC_PARAMS)
  if (issues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', issues)
  const params = parseListQuery(url, 'api_clients', { deleted: 'false' as const })
  const page = paginate(params)
  const conds = ['deleted_at IS NULL']
  const vals: unknown[] = []
  const status = url.searchParams.get('status')
  if (status) {
    if (status !== 'active' && status !== 'revoked') throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'status', issue: 'must be active|revoked' }])
    conds.push('status = ?')
    vals.push(status)
  }
  if (params.q) {
    conds.push('name LIKE ?')
    vals.push(`%${params.q}%`)
  }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM api_clients WHERE ${conds.join(' AND ')}${page.where} ${page.orderClause} LIMIT ?`,
  )
    .bind(...vals, ...page.params, params.limit + 1)
    .all<Record<string, unknown>>()
  let data = rows.results ?? []
  let hasMore = false
  if (data.length > params.limit) {
    hasMore = true
    data = data.slice(0, params.limit)
  }
  return ok(c, data.map(apiClientOut), { pagination: { limit: params.limit, next_cursor: hasMore ? page.nextCursor(data) : null, has_more: hasMore } })
})

const VALID_SCOPES = [
  'users:read', 'users:write', 'configs:read', 'configs:write', 'upstreams:read', 'upstreams:write',
  'relays:read', 'subscriptions:read', 'subscriptions:write', 'usage:read', 'usage:raw', 'audit:read',
  'dashboard:read', 'settings:read', 'telegram_admins:read', 'telegram:verify',
]

apiClients.post('/', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('FORBIDDEN')
  const { body, issues: bodyIssues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (bodyIssues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', bodyIssues)
  const r = new BodyReader(body as Record<string, unknown>, ['id', 'name', 'scopes'])
  const id = (body as Record<string, unknown>)['id']
  if (id !== undefined && !isUuid(id)) r.issues.push({ location: 'body', field: 'id', issue: 'must be a UUIDv4' })
  const name = r.str('name', { required: true, min: 1, max: 64 })
  const scopes = r.array('scopes', { required: true, min: 1, max: 32 })
  assertValid(r.issues)
  const scopeList = (scopes as unknown[]) ?? []
  if (scopeList.some((s) => typeof s !== 'string' || !VALID_SCOPES.includes(s))) {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'body', field: 'scopes', issue: 'contains invalid scopes' }])
  }
  const { token, hash, prefix } = await generateToken('bot')
  const now = Math.floor(Date.now() / 1000)
  const finalId = (id as string | undefined) ?? crypto.randomUUID()
  try {
    await c.env.DB.prepare(
      `INSERT INTO api_clients (id, name, scopes, status, token_hash, token_prefix, created_by, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    )
      .bind(finalId, name, JSON.stringify(scopeList), hash, prefix, ctx.actor.adminId, now, now)
      .run()
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('UNIQUE')) throw new ApiError('CONFLICT', 'Resource already exists', { issue: 'duplicate_name_or_id' })
    throw err
  }
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.adminId, action: 'api_client.issue', entity_type: 'api_client', entity_id: finalId, metadata: { name }, request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  const row = await c.env.DB.prepare(`SELECT * FROM api_clients WHERE id = ?`).bind(finalId).first<Record<string, unknown>>()
  return ok(c, { ...apiClientOut(row ?? {}), token, issued_at: now }, undefined, 201)
})

apiClients.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await c.env.DB.prepare(`SELECT * FROM api_clients WHERE id = ?`).bind(id).first<Record<string, unknown>>()
  if (!row || row.deleted_at) throw new ApiError('NOT_FOUND')
  return ok(c, apiClientOut(row))
})

apiClients.post('/:id/rotate', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('FORBIDDEN')
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await c.env.DB.prepare(`SELECT * FROM api_clients WHERE id = ? AND deleted_at IS NULL`).bind(id).first<Record<string, unknown>>()
  if (!row) throw new ApiError('NOT_FOUND')
  const { token, hash, prefix } = await generateToken('bot')
  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare(`UPDATE api_clients SET token_hash = ?, token_prefix = ?, updated_at = ? WHERE id = ?`)
    .bind(hash, prefix, now, id)
    .run()
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.adminId, action: 'api_client.rotate', entity_type: 'api_client', entity_id: id, request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  const updated = await c.env.DB.prepare(`SELECT * FROM api_clients WHERE id = ?`).bind(id).first<Record<string, unknown>>()
  return ok(c, { ...apiClientOut(updated ?? {}), token, issued_at: now }, undefined, 201)
})

apiClients.post('/:id/revoke', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('FORBIDDEN')
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await c.env.DB.prepare(`SELECT id, status FROM api_clients WHERE id = ? AND deleted_at IS NULL`).bind(id).first<{ id: string; status: string }>()
  if (!row) throw new ApiError('NOT_FOUND')
  if (row.status !== 'revoked') {
    await c.env.DB.prepare(`UPDATE api_clients SET status = 'revoked' WHERE id = ?`).bind(id).run()
    writeAudit(
      c.env.DB,
      { actor_type: 'admin', actor_id: ctx.actor.adminId, action: 'api_client.revoke', entity_type: 'api_client', entity_id: id, request_id: ctx.requestId },
      (p) => ctx.waitUntil(p),
    )
  }
  return noContent(c)
})

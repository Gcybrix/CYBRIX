/**
 * Configs (Prompt 4 §10.3): XOR path rule (locked), AES-256-GCM credential
 * envelope, reveal is admin-only + audited, protocol immutable on PATCH.
 */
import { Hono } from 'hono'
import type { Env } from '../env'
import type { CybEnv, HelperCtx } from '../ctx'
import { ApiError, noContent, ok, readJsonBody } from '../http'
import { BodyReader, assertValid, checkQuery, isUuid } from '../validate'
import { getCtx, requireAdminOrBot, requireAdminOnly } from '../auth/middleware'
import { deletedClause, paginate, parseListQuery } from '../list'
import { configOut } from '../serialize'
import { writeAudit } from '../audit'
import { CREDENTIAL_KEY_ID, encryptCredential, decryptCredential, normalizeCredential } from '../crypto/credential'

export const userConfigs = new Hono<CybEnv>()
export const configsRoot = new Hono<CybEnv>()

const CFG_LIST_PARAMS = ['protocol', 'upstream_id', 'relay_id', 'deleted', 'sort', 'order', 'limit', 'cursor', 'include_deleted', 'include_credential'] as const
const CFG_FIELDS = ['id', 'protocol', 'upstream_id', 'relay_id', 'credential'] as const

userConfigs.use('*', requireAdminOrBot('configs:read', 'configs:write'))

userConfigs.use('*', async (c, next) => {
  const issues = checkQuery(new URL(c.req.url), CFG_LIST_PARAMS)
  if (issues.length > 0 && c.req.method === 'GET') throw new ApiError('VALIDATION_ERROR', 'Request validation failed', issues)
  await next()
})

async function validatePath(
  db: D1Database,
  upstreamId: string | null | undefined,
  relayId: string | null | undefined,
): Promise<void> {
  if (upstreamId && relayId) {
    throw new ApiError('VALIDATION_ERROR', 'XOR violation', [{ location: 'body', field: 'upstream_id', issue: 'xor_violation: upstream_id and relay_id are mutually exclusive' }], undefined, 422)
  }
  if (upstreamId) {
    const u = await db.prepare(`SELECT status, deleted_at FROM upstreams WHERE id = ?`).bind(upstreamId).first<{ status: string; deleted_at: number | null }>()
    if (!u || u.deleted_at) throw new ApiError('VALIDATION_ERROR', 'Invalid reference', [{ location: 'body', field: 'upstream_id', issue: 'invalid_reference' }], undefined, 422)
  }
  if (relayId) {
    const rl = await db.prepare(`SELECT status, deleted_at FROM relays WHERE id = ?`).bind(relayId).first<{ status: string; deleted_at: number | null }>()
    if (!rl || rl.deleted_at) throw new ApiError('VALIDATION_ERROR', 'Invalid reference', [{ location: 'body', field: 'relay_id', issue: 'invalid_reference' }], undefined, 422)
    if (rl.status !== 'active') throw new ApiError('VALIDATION_ERROR', 'Invalid reference', [{ location: 'body', field: 'relay_id', issue: 'relay_not_active' }], undefined, 422)
  }
}

userConfigs.get('/', async (c) => {
  const userId = c.req.param('userId')!
  if (!isUuid(userId)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'user_id', issue: 'must be a UUIDv4' }])
  const url = new URL(c.req.url)
  const params = parseListQuery(url, 'configs')
  const page = paginate(params)
  const conds = ['user_id = ?', deletedClause(params)]
  const vals: unknown[] = [userId]
  const protocol = url.searchParams.get('protocol')
  if (protocol) {
    conds.push('protocol = ?')
    vals.push(protocol)
  }
  const relayId = url.searchParams.get('relay_id')
  if (relayId) {
    conds.push('relay_id = ?')
    vals.push(relayId)
  }
  const upstreamId = url.searchParams.get('upstream_id')
  if (upstreamId) {
    conds.push('upstream_id = ?')
    vals.push(upstreamId)
  }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM configs WHERE ${conds.join(' AND ')}${page.where} ${page.orderClause} LIMIT ?`,
  )
    .bind(...vals, ...page.params, params.limit + 1)
    .all<Record<string, unknown>>()
  let data = rows.results ?? []
  let hasMore = false
  if (data.length > params.limit) {
    hasMore = true
    data = data.slice(0, params.limit)
  }
  return ok(c, data.map((r) => configOut(r)), { pagination: { limit: params.limit, next_cursor: hasMore ? page.nextCursor(data) : null, has_more: hasMore } })
})

async function createConfig(c: HelperCtx & { req: { raw: Request; url: string; param(k: string): string } }, userId: string, bodyRaw: unknown, bodyIssues: { location: string; field?: string; issue: string }[], requestId: string, waitUntil: (p: Promise<unknown>) => void): Promise<Response> {
  const ctx = getCtx(c as never)
  if (bodyIssues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', bodyIssues)
  const r = new BodyReader(bodyRaw as Record<string, unknown>, [...CFG_FIELDS])
  const id = (bodyRaw as Record<string, unknown>)['id']
  if (id !== undefined && !isUuid(id)) r.issues.push({ location: 'body', field: 'id', issue: 'must be a UUIDv4' })
  const protocol = r.enum('protocol', ['vless', 'vmess', 'trojan', 'ss'], { required: true })
  const upstreamId = r.str('upstream_id', { nullable: true, max: 36, pattern: /^[0-9a-f-]{36}$/ })
  const relayId = r.str('relay_id', { nullable: true, max: 36, pattern: /^[0-9a-f-]{36}$/ })
  const credential = r.object('credential', { nullable: true })
  assertValid(r.issues)
  // user must exist and be live
  const user = await c.env.DB.prepare(`SELECT id, deleted_at FROM users WHERE id = ?`).bind(userId).first<{ id: string; deleted_at: number | null }>()
  if (!user || user.deleted_at) throw new ApiError('NOT_FOUND')
  await validatePath(c.env.DB, upstreamId, relayId)
  const credCheck = normalizeCredential(protocol!, credential ?? null)
  if (!credCheck.ok || !credCheck.normalized) {
    throw new ApiError('VALIDATION_ERROR', 'Credential invalid', [{ location: 'body', field: 'credential', issue: credCheck.issue ?? 'invalid' }])
  }
  const encrypted = await encryptCredential(JSON.stringify(credCheck.normalized), c.env.DATA_ENCRYPTION_KEY)
  const now = Math.floor(Date.now() / 1000)
  const finalId = (id as string | undefined) ?? crypto.randomUUID()
  try {
    await c.env.DB.prepare(
      `INSERT INTO configs (id, user_id, protocol, upstream_id, relay_id, enabled, credential_encrypted, credential_key_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
      .bind(finalId, userId, protocol, upstreamId ?? null, relayId ?? null, encrypted, CREDENTIAL_KEY_ID, now, now)
      .run()
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('UNIQUE')) throw new ApiError('CONFLICT', 'Resource already exists', { issue: 'duplicate_id' })
    if (msg.includes('CHECK')) throw new ApiError('VALIDATION_ERROR', 'XOR violation', [{ location: 'body', field: 'upstream_id', issue: 'xor_violation' }])
    throw err
  }
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.kind === 'admin' ? ctx.actor.adminId : ctx.actor.kind === 'bot' ? ctx.actor.clientId : null, action: 'config.create', entity_type: 'config', entity_id: finalId, request_id: requestId },
    (p) => waitUntil(p),
  )
  const row = await c.env.DB.prepare(`SELECT * FROM configs WHERE id = ?`).bind(finalId).first<Record<string, unknown>>()
  return ok(c, configOut(row ?? {}), undefined, 201)
}

userConfigs.post('/', async (c) => {
  const userId = c.req.param('userId')!
  if (!isUuid(userId)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'user_id', issue: 'must be a UUIDv4' }])
  const { body, issues } = await readJsonBody(c.req.raw, 256 * 1024)
  return createConfig(c, userId, body, issues, c.get('requestId') ?? '', (p) => c.executionCtx.waitUntil(p))
})

userConfigs.get('/:configId', async (c) => {
  const userId = c.req.param('userId')!
  const configId = c.req.param('configId')!
  if (!isUuid(configId)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'config_id', issue: 'must be a UUIDv4' }])
  const includeCredential = new URL(c.req.url).searchParams.get('include_credential') === 'true'
  const ctx = getCtx(c)
  if (includeCredential && ctx.actor.kind !== 'admin') {
    throw new ApiError('FORBIDDEN', 'Credential reveal is admin-only', { reason: 'missing_scope' })
  }
  const row = await c.env.DB.prepare(`SELECT * FROM configs WHERE id = ? AND user_id = ?`).bind(configId, userId).first<Record<string, unknown>>()
  if (!row || row.deleted_at) throw new ApiError('NOT_FOUND')
  if (!includeCredential) return ok(c, configOut(row))
  const encrypted = row.credential_encrypted as string | null
  const credential = encrypted ? JSON.parse(await decryptCredential(encrypted, c.env.DATA_ENCRYPTION_KEY)) as Record<string, unknown> : null
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.kind === 'admin' ? ctx.actor.adminId : null, action: 'config.credential_revealed', entity_type: 'config', entity_id: configId, request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  return ok(c, configOut(row, true, credential))
})

userConfigs.patch('/:configId', async (c) => {
  const ctx = getCtx(c)
  const userId = c.req.param('userId')!
  const configId = c.req.param('configId')!
  if (!isUuid(configId)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'config_id', issue: 'must be a UUIDv4' }])
  const row = await c.env.DB.prepare(`SELECT * FROM configs WHERE id = ? AND user_id = ? AND deleted_at IS NULL`).bind(configId, userId).first<Record<string, unknown>>()
  if (!row) throw new ApiError('NOT_FOUND')
  const { body, issues: bodyIssues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (bodyIssues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', bodyIssues)
  const raw = body as Record<string, unknown>
  const r = new BodyReader(raw, ['upstream_id', 'relay_id', 'credential'])
  const upstreamId = r.str('upstream_id', { nullable: true, max: 36, pattern: /^[0-9a-f-]{36}$/ })
  const relayId = r.str('relay_id', { nullable: true, max: 36, pattern: /^[0-9a-f-]{36}$/ })
  const credential = r.object('credential', { nullable: true })
  if (raw['protocol'] !== undefined && raw['protocol'] !== row.protocol) {
    r.issues.push({ location: 'body', field: 'protocol', issue: 'immutable_field' })
  }
  assertValid(r.issues)
  await validatePath(c.env.DB, upstreamId ?? null, relayId ?? null)
  let encrypted = row.credential_encrypted as string | null
  if (credential !== undefined) {
    if (credential === null) {
      encrypted = null
    } else {
      const credCheck = normalizeCredential(row.protocol as string, credential)
      if (!credCheck.ok || !credCheck.normalized) {
        throw new ApiError('VALIDATION_ERROR', 'Credential invalid', [{ location: 'body', field: 'credential', issue: credCheck.issue ?? 'invalid' }])
      }
      encrypted = await encryptCredential(JSON.stringify(credCheck.normalized), c.env.DATA_ENCRYPTION_KEY)
    }
  }
  const nextUpstream = upstreamId !== undefined ? upstreamId : (row.upstream_id as string | null)
  const nextRelay = relayId !== undefined ? relayId : (row.relay_id as string | null)
  if (nextUpstream && nextRelay) {
    throw new ApiError('VALIDATION_ERROR', 'XOR violation', [{ location: 'body', field: 'upstream_id', issue: 'xor_violation' }])
  }
  await c.env.DB.prepare(`UPDATE configs SET upstream_id = ?, relay_id = ?, credential_encrypted = ?, credential_key_id = ? WHERE id = ?`)
    .bind(nextUpstream, nextRelay, encrypted, encrypted ? CREDENTIAL_KEY_ID : null, configId)
    .run()
  const changed = ['upstream_id', 'relay_id', 'credential'].filter((f) => raw[f] !== undefined)
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.kind === 'admin' ? ctx.actor.adminId : ctx.actor.kind === 'bot' ? ctx.actor.clientId : null, action: 'config.update', entity_type: 'config', entity_id: configId, metadata: { changed }, request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  const updated = await c.env.DB.prepare(`SELECT * FROM configs WHERE id = ?`).bind(configId).first<Record<string, unknown>>()
  return ok(c, configOut(updated ?? {}))
})

userConfigs.delete('/:configId', async (c) => {
  const ctx = getCtx(c)
  const userId = c.req.param('userId')!
  const configId = c.req.param('configId')!
  if (!isUuid(configId)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'config_id', issue: 'must be a UUIDv4' }])
  const row = await c.env.DB.prepare(`SELECT id, deleted_at FROM configs WHERE id = ? AND user_id = ?`).bind(configId, userId).first<{ id: string; deleted_at: number | null }>()
  if (!row) throw new ApiError('NOT_FOUND')
  if (!row.deleted_at) {
    await c.env.DB.prepare(`UPDATE configs SET deleted_at = strftime('%s','now') WHERE id = ?`).bind(configId).run()
    writeAudit(
      c.env.DB,
      { actor_type: 'admin', actor_id: ctx.actor.kind === 'admin' ? ctx.actor.adminId : ctx.actor.kind === 'bot' ? ctx.actor.clientId : null, action: 'config.delete', entity_type: 'config', entity_id: configId, request_id: ctx.requestId },
      (p) => ctx.waitUntil(p),
    )
  }
  return noContent(c)
})

export { createConfig, deletedClause }

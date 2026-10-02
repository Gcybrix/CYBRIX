/**
 * Relays (Prompt 4 §10.5–§10.9): admin registry + token lifecycle + the three
 * data-plane endpoints (sync/heartbeat/usage). Outbound-only contract — the
 * relay authenticates with exactly one active token and is self-scoped.
 */
import { Hono } from 'hono'
import type { Env } from '../env'
import type { CybEnv } from '../ctx'
import { ApiError, noContent, ok, readJsonBody, type Reqish, newRequestId } from '../http'
import { BodyReader, assertValid, checkQuery, isUuid } from '../validate'
import { assertRelaySelf, getCtx, requireAdminOnly, requireAdminOrBot, requireRelay } from '../auth/middleware'
import { paginate, parseListQuery, deletedClause } from '../list'
import { relayOut } from '../serialize'
import { writeAudit } from '../audit'
import { generateToken } from '../auth/tokens'
import { checkRate, rateHeaders } from '../ratelimit'
import { HEALTH_ONLINE_WINDOW_S, HEARTBEAT_INTERVAL_S } from '../env'
import { decryptCredential } from '../crypto/credential'

export const relays = new Hono<CybEnv>()
/** Data-plane endpoints (relay-token domain) — mounted OUTSIDE the admin gate. */
export const relaysDataPlane = new Hono<CybEnv>()

const RELAY_LIST_PARAMS = ['status', 'health', 'q', 'deleted', 'sort', 'order', 'limit', 'cursor'] as const

// Admin registry: reads allow bot(relays:read); writes are admin-only (§4.3).
// The three data-plane subpaths are excluded here — they carry their own
// relay-token domain guard (requireRelay) on relaysDataPlane.
relays.use('*', async (c, next) => {
  const p = c.req.path
  if (p.endsWith('/sync') || p.endsWith('/heartbeat') || p.endsWith('/usage')) {
    await next()
    return
  }
  if (c.req.method === 'GET') {
    await requireAdminOrBot('relays:read')(c, next)
  } else {
    await requireAdminOnly()(c, next)
  }
})

relays.use('*', async (c, next) => {
  const p = c.req.path
  if (p.endsWith('/sync') || p.endsWith('/heartbeat') || p.endsWith('/usage')) {
    await next()
    return
  }
  const issues = checkQuery(new URL(c.req.url), RELAY_LIST_PARAMS)
  if (issues.length > 0 && c.req.method === 'GET') throw new ApiError('VALIDATION_ERROR', 'Request validation failed', issues)
  await next()
})

function actorIdFor(ctx: ReturnType<typeof getCtx>): string | null {
  if (ctx.actor.kind === 'admin') return ctx.actor.adminId
  if (ctx.actor.kind === 'bot') return ctx.actor.clientId
  return null
}

relays.get('/', async (c) => {
  const url = new URL(c.req.url)
  const params = parseListQuery(url, 'relays')
  const page = paginate(params)
  const conds = [deletedClause(params)]
  const vals: unknown[] = []
  const status = url.searchParams.get('status')
  if (status) {
    if (status !== 'active' && status !== 'disabled') throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'status', issue: 'must be active|disabled' }])
    conds.push('status = ?')
    vals.push(status)
  }
  if (params.q) {
    conds.push("name LIKE ? ESCAPE '\\'")
    vals.push(`%${params.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
  }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM relays WHERE ${conds.join(' AND ')}${page.where} ${page.orderClause} LIMIT ?`,
  )
    .bind(...vals, ...page.params, params.limit + 1)
    .all<Record<string, unknown>>()
  let data = rows.results ?? []
  let hasMore = false
  if (data.length > params.limit) {
    hasMore = true
    data = data.slice(0, params.limit)
  }
  const now = Math.floor(Date.now() / 1000)
  let out = data.map((r) => relayOut(r, now))
  const health = url.searchParams.get('health')
  if (health) {
    if (!['online', 'offline', 'unknown'].includes(health)) {
      throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'health', issue: 'must be online|offline|unknown' }])
    }
    out = out.filter((r) => r.health === health)
  }
  return ok(c, out, { pagination: { limit: params.limit, next_cursor: hasMore ? page.nextCursor(data) : null, has_more: hasMore } })
})

relays.post('/', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('FORBIDDEN')
  const { body, issues: bodyIssues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (bodyIssues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', bodyIssues)
  const r = new BodyReader(body as Record<string, unknown>, ['id', 'name', 'provider', 'public_endpoint', 'public_port', 'status'])
  const id = (body as Record<string, unknown>)['id']
  if (id !== undefined && !isUuid(id)) r.issues.push({ location: 'body', field: 'id', issue: 'must be a UUIDv4' })
  const name = r.str('name', { required: true, min: 1, max: 64 })
  const provider = r.str('provider', { max: 64 })
  const publicEndpoint = r.str('public_endpoint', { max: 253, pattern: /^[A-Za-z0-9._-]+$/ })
  const publicPort = r.int('public_port', { min: 1, max: 65535 })
  const status = r.enum('status', ['active', 'disabled']) ?? 'active'
  assertValid(r.issues)
  const now = Math.floor(Date.now() / 1000)
  const finalId = (id as string | undefined) ?? crypto.randomUUID()
  try {
    await c.env.DB.prepare(
      `INSERT INTO relays (id, name, provider, public_endpoint, public_port, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(finalId, name, provider ?? null, publicEndpoint ?? null, publicPort ?? null, status, now, now)
      .run()
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('UNIQUE')) throw new ApiError('CONFLICT', 'Resource already exists', { issue: 'duplicate_name_or_id' })
    throw err
  }
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.adminId, action: 'relay.create', entity_type: 'relay', entity_id: finalId, request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  const row = await c.env.DB.prepare(`SELECT * FROM relays WHERE id = ?`).bind(finalId).first<Record<string, unknown>>()
  return ok(c, relayOut(row ?? {}, now), undefined, 201)
})

relays.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await c.env.DB.prepare(`SELECT * FROM relays WHERE id = ?`).bind(id).first<Record<string, unknown>>()
  if (!row || row.deleted_at) throw new ApiError('NOT_FOUND')
  return ok(c, relayOut(row, Math.floor(Date.now() / 1000)))
})

relays.patch('/:id', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('FORBIDDEN')
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await c.env.DB.prepare(`SELECT * FROM relays WHERE id = ? AND deleted_at IS NULL`).bind(id).first<Record<string, unknown>>()
  if (!row) throw new ApiError('NOT_FOUND')
  const { body, issues: bodyIssues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (bodyIssues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', bodyIssues)
  const r = new BodyReader(body as Record<string, unknown>, ['name', 'provider', 'public_endpoint', 'public_port', 'status'])
  const name = r.str('name', { min: 1, max: 64 })
  const provider = r.str('provider', { max: 64, nullable: true })
  const publicEndpoint = r.str('public_endpoint', { max: 253, nullable: true, pattern: /^[A-Za-z0-9._-]+$/ })
  const publicPort = r.int('public_port', { min: 1, max: 65535, nullable: true })
  const status = r.enum('status', ['active', 'disabled'])
  assertValid(r.issues)
  const next = {
    name: name ?? (row.name as string),
    provider: provider !== undefined ? provider : (row.provider as string | null),
    public_endpoint: publicEndpoint !== undefined ? publicEndpoint : (row.public_endpoint as string | null),
    public_port: publicPort !== undefined ? publicPort : (row.public_port as number | null),
    status: status ?? (row.status as string),
  }
  await c.env.DB.prepare(`UPDATE relays SET name = ?, provider = ?, public_endpoint = ?, public_port = ?, status = ? WHERE id = ?`)
    .bind(next.name, next.provider, next.public_endpoint, next.public_port, next.status, id)
    .run()
  const changed = Object.keys(next).filter((k) => JSON.stringify(next[k as keyof typeof next]) !== JSON.stringify(row[k]))
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.adminId, action: 'relay.update', entity_type: 'relay', entity_id: id, metadata: { changed }, request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  const updated = await c.env.DB.prepare(`SELECT * FROM relays WHERE id = ?`).bind(id).first<Record<string, unknown>>()
  return ok(c, relayOut(updated ?? {}, Math.floor(Date.now() / 1000)))
})

relays.delete('/:id', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('FORBIDDEN')
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await c.env.DB.prepare(`SELECT id, deleted_at FROM relays WHERE id = ?`).bind(id).first<{ id: string; deleted_at: number | null }>()
  if (!row) throw new ApiError('NOT_FOUND')
  if (!row.deleted_at) {
    const ref = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM configs WHERE relay_id = ? AND deleted_at IS NULL`).bind(id).first<{ n: number }>()
    if ((ref?.n ?? 0) > 0) throw new ApiError('CONFLICT', 'Referenced by a live config', { issue: 'referential_guard' })
    const active = await c.env.DB.prepare(`SELECT id FROM relay_tokens WHERE relay_id = ? AND status = 'active'`).bind(id).first<{ id: string }>()
    if (active) {
      await c.env.DB.prepare(`UPDATE relay_tokens SET status = 'revoked', revoked_at = strftime('%s','now') WHERE id = ?`).bind(active.id).run()
      writeAudit(
        c.env.DB,
        { actor_type: 'system', action: 'relay.token.revoke', entity_type: 'relay_token', entity_id: active.id, metadata: { relay_id: id, cause: 'relay_deleted' }, request_id: ctx.requestId },
        (p) => ctx.waitUntil(p),
      )
    }
    await c.env.DB.prepare(`UPDATE relays SET deleted_at = strftime('%s','now') WHERE id = ?`).bind(id).run()
    writeAudit(
      c.env.DB,
      { actor_type: 'admin', actor_id: ctx.actor.adminId, action: 'relay.delete', entity_type: 'relay', entity_id: id, request_id: ctx.requestId },
      (p) => ctx.waitUntil(p),
    )
  }
  return noContent(c)
})

/* ------------------------------ relay tokens ------------------------------ */

async function activeTokenMeta(db: D1Database, relayId: string): Promise<Record<string, unknown> | null> {
  const row = await db
    .prepare(`SELECT id, token_prefix, created_at, issued_by, last_used_at, expires_at FROM relay_tokens WHERE relay_id = ? AND status = 'active'`)
    .bind(relayId)
    .first<Record<string, unknown>>()
  return row
}

relays.get('/:id/token', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('FORBIDDEN')
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const row = await activeTokenMeta(c.env.DB, id)
  if (!row) return ok(c, { has_active: false, token_id: null, token_prefix: null, issued_at: null, issued_by: null, last_used_at: null, expires_at: null })
  return ok(c, {
    has_active: true,
    token_id: row.id,
    token_prefix: row.token_prefix,
    issued_at: row.created_at,
    issued_by: row.issued_by,
    last_used_at: row.last_used_at,
    expires_at: row.expires_at ?? null,
  })
})

async function issueToken(db: D1Database, relayId: string, issuedBy: string, now: number): Promise<{ relay_id: string; token_id: string; token: string; issued_at: number; issued_by: string; expires_at: null }> {
  const { token, hash, prefix } = await generateToken('relay')
  const tokenId = crypto.randomUUID()
  await db.prepare(
    `INSERT INTO relay_tokens (id, relay_id, token_hash, token_prefix, status, issued_by, created_at) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
  )
    .bind(tokenId, relayId, hash, prefix, issuedBy, now)
    .run()
  return { relay_id: relayId, token_id: tokenId, token, issued_at: now, issued_by: issuedBy, expires_at: null }
}

relays.post('/:id/token', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('FORBIDDEN')
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const relay = await c.env.DB.prepare(`SELECT id, deleted_at FROM relays WHERE id = ?`).bind(id).first<{ id: string; deleted_at: number | null }>()
  if (!relay || relay.deleted_at) throw new ApiError('NOT_FOUND')
  const existing = await activeTokenMeta(c.env.DB, id)
  if (existing) throw new ApiError('CONFLICT', 'An active token exists; use rotate', { issue: 'token_active' })
  const now = Math.floor(Date.now() / 1000)
  const issued = await issueToken(c.env.DB, id, ctx.actor.adminId, now)
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.adminId, action: 'relay.token.issue', entity_type: 'relay_token', entity_id: issued.token_id, metadata: { relay_id: id }, request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  return ok(c, issued, undefined, 201)
})

relays.post('/:id/token/rotate', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('FORBIDDEN')
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const relay = await c.env.DB.prepare(`SELECT id, deleted_at FROM relays WHERE id = ?`).bind(id).first<{ id: string; deleted_at: number | null }>()
  if (!relay || relay.deleted_at) throw new ApiError('NOT_FOUND')
  const existing = await activeTokenMeta(c.env.DB, id)
  if (!existing) throw new ApiError('CONFLICT', 'No active token; issue first', { issue: 'no_active_token' })
  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare(`UPDATE relay_tokens SET status = 'revoked', revoked_at = ? WHERE id = ?`).bind(now, existing.id).run()
  const issued = await issueToken(c.env.DB, id, ctx.actor.adminId, now)
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.adminId, action: 'relay.token.rotate', entity_type: 'relay_token', entity_id: issued.token_id, metadata: { relay_id: id, old_token_id: existing.id }, request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  return ok(c, issued, undefined, 201)
})

relays.post('/:id/token/revoke', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('FORBIDDEN')
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const existing = await activeTokenMeta(c.env.DB, id)
  if (existing) {
    const now = Math.floor(Date.now() / 1000)
    await c.env.DB.prepare(`UPDATE relay_tokens SET status = 'revoked', revoked_at = ? WHERE id = ?`).bind(now, existing.id).run()
    writeAudit(
      c.env.DB,
      { actor_type: 'admin', actor_id: ctx.actor.adminId, action: 'relay.token.revoke', entity_type: 'relay_token', entity_id: existing.id as string, metadata: { relay_id: id }, request_id: ctx.requestId },
      (p) => ctx.waitUntil(p),
    )
  }
  return noContent(c)
})

/* ================================ data plane ================================ */

const SYNC_LIMIT_DEFAULT = 200
const SYNC_LIMIT_MAX = 500

interface SyncCursor {
  v: 1
  p: { configs: [number, string] | null; users: [number, string] | null; upstreams: [number, string] | null; relays: [number, string] | null }
}

function decodeSyncCursor(token: string | null): SyncCursor | null {
  if (!token) return null
  let parsed: unknown
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const bin = atob(padded)
    parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
  } catch {
    throw new ApiError('CURSOR_INVALID', 'since cursor is corrupt')
  }
  const c = parsed as SyncCursor | null
  if (!c || typeof c !== 'object' || c.v !== 1 || !c.p || typeof c.p !== 'object') {
    throw new ApiError('CURSOR_INVALID', 'since cursor is corrupt')
  }
  return c
}

function encodeSyncCursor(c: SyncCursor): string {
  const json = JSON.stringify(c)
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

relaysDataPlane.get('/:id/sync', requireRelay, async (c) => {
  const ctx = getCtx(c)
  assertRelaySelf(ctx, c.req.param('id') as string)
  const relayId = ctx.actor.kind === 'relay' ? ctx.actor.relayId : ''
  const verdict = await checkRate(c.env.KV, 'relay_sync', relayId, ctx.now)
  if (!verdict.allowed) return syncError(c, verdict)

  const url = new URL(c.req.url)
  const since = url.searchParams.get('since')
  const cursor = decodeSyncCursor(since)
  const limitRaw = url.searchParams.get('limit')
  let limit = limitRaw === null ? SYNC_LIMIT_DEFAULT : Number(limitRaw)
  if (!Number.isInteger(limit) || limit < 1 || limit > SYNC_LIMIT_MAX) {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'limit', issue: 'must be integer 1..500' }])
  }
  const isFull = cursor === null

  /* ---- configs: FULL for own live configs; delta adds unassign stubs (§12.4) ---- */
  const configs: Record<string, unknown>[] = []
  let configPos: [number, string] | null = cursor ? cursor.p.configs : null
  let configsHasMore = false
  {
    const conds: string[] = []
    const vals: unknown[] = []
    if (isFull) {
      conds.push('c.relay_id = ?', 'c.deleted_at IS NULL', 'u.deleted_at IS NULL')
      vals.push(relayId)
    } else {
      const pos = cursor!.p.configs
      if (pos) {
        // Same-second grace (documented): second-resolution updated_at can collide
        // with the cursor position when a mutation follows a sync within the same
        // second. Tombstones are re-included via deleted_at >= pos — re-delivery is
        // idempotent at the relay (version compare, §12.1).
        conds.push('(c.relay_id IS NOT NULL) AND (c.updated_at > ? OR (c.updated_at = ? AND c.id > ?) OR c.deleted_at >= ? OR EXISTS (SELECT 1 FROM users u2 WHERE u2.id = c.user_id AND u2.deleted_at >= ? AND u2.deleted_at > c.updated_at - 2))')
        vals.push(pos[0], pos[0], pos[1], pos[0], pos[0])
      } else {
        conds.push('c.relay_id IS NOT NULL')
      }
    }
    const rows = await c.env.DB.prepare(
      `SELECT c.*, u.deleted_at AS owner_deleted, u.status AS owner_status FROM configs c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE ${conds.join(' AND ')}
       ORDER BY c.updated_at ASC, c.id ASC LIMIT ?`,
    )
      .bind(...vals, limit + 1)
      .all<Record<string, unknown>>()
    let list = rows.results ?? []
    if (list.length > limit) {
      configsHasMore = true
      list = list.slice(0, limit)
    }
    for (const row of list) {
      const own = row.relay_id === relayId && !row.deleted_at && !row.owner_deleted
      if (own) {
        const encrypted = row.credential_encrypted as string | null
        const credential = encrypted ? (JSON.parse(await decryptCredential(encrypted, c.env.DATA_ENCRYPTION_KEY)) as Record<string, unknown>) : null
        configs.push({
          id: row.id,
          user_id: row.user_id,
          protocol: row.protocol,
          relay_id: row.relay_id,
          upstream_id: row.upstream_id,
          enabled: (row.enabled as number) === 1,
          credential,
          version: row.version,
          updated_at: row.updated_at,
          deleted_at: null,
        })
      } else {
        configs.push({ id: row.id, version: row.version, updated_at: row.updated_at, op: 'unassigned' })
      }
    }
    if (list.length > 0) {
      const last = list[list.length - 1] as Record<string, unknown>
      configPos = [last.updated_at as number, last.id as string]
    }
  }

  /* ---- users: subset derived from this relay's live configs ---- */
  const users: Record<string, unknown>[] = []
  let userPos: [number, string] | null = cursor ? cursor.p.users : null
  let usersHasMore = false
  {
    const conds: string[] = [
      'u.id IN (SELECT user_id FROM configs WHERE relay_id = ? AND deleted_at IS NULL)',
    ]
    const vals: unknown[] = [relayId]
    if (cursor?.p.users) {
      // same-second grace for user tombstones (see configs delta note)
      conds.push('(u.updated_at > ? OR (u.updated_at = ? AND u.id > ?) OR (u.deleted_at IS NOT NULL AND u.deleted_at >= ?))')
      vals.push(cursor.p.users[0], cursor.p.users[0], cursor.p.users[1], cursor.p.users[0])
    }
    const rows = await c.env.DB.prepare(
      `SELECT u.* FROM users u WHERE ${conds.join(' AND ')} ORDER BY u.updated_at ASC, u.id ASC LIMIT ?`,
    )
      .bind(...vals, limit + 1)
      .all<Record<string, unknown>>()
    let list = rows.results ?? []
    if (list.length > limit) {
      usersHasMore = true
      list = list.slice(0, limit)
    }
    for (const u of list) {
      users.push({
        id: u.id,
        status: u.status,
        expires_at: u.expires_at,
        traffic_limit_bytes: u.traffic_limit_bytes === null ? null : String(u.traffic_limit_bytes),
        traffic_used_bytes: String(u.traffic_used_bytes ?? '0'),
        traffic_reset_day: u.traffic_reset_day,
        version: u.version,
        updated_at: u.updated_at,
        deleted_at: u.deleted_at,
      })
    }
    if (list.length > 0) {
      const last = list[list.length - 1] as Record<string, unknown>
      userPos = [last.updated_at as number, last.id as string]
    }
  }

  /* ---- upstreams: always empty under the locked XOR (forward-compat shape) ---- */
  const upstreams: Record<string, unknown>[] = []
  const upstreamPos: [number, string] | null = cursor ? cursor.p.upstreams : null

  /* ---- relays: only self ---- */
  const relayRows: Record<string, unknown>[] = []
  const selfRow = await c.env.DB.prepare(`SELECT * FROM relays WHERE id = ?`).bind(relayId).first<Record<string, unknown>>()
  if (selfRow) {
    const pos = cursor ? cursor.p.relays : null
    if (isFull || !pos || (selfRow.updated_at as number) > pos[0] || ((selfRow.updated_at as number) === pos[0] && (selfRow.id as string) > pos[1])) {
      relayRows.push({
        id: selfRow.id,
        name: selfRow.name,
        provider: selfRow.provider,
        public_endpoint: selfRow.public_endpoint,
        public_port: selfRow.public_port,
        status: selfRow.status,
        version: selfRow.version,
        updated_at: selfRow.updated_at,
        deleted_at: selfRow.deleted_at,
      })
    }
  }
  const relayPos: [number, string] | null = relayRows.length > 0 ? [(selfRow!.updated_at as number), selfRow!.id as string] : cursor ? cursor.p.relays : null

  const nextCursor: SyncCursor = {
    v: 1,
    p: { configs: configPos, users: userPos, upstreams: upstreamPos, relays: relayPos },
  }
  const body = {
    data: { relays: relayRows, upstreams, configs, users },
    meta: {
      cursors: {
        next_cursor: encodeSyncCursor(nextCursor),
        has_more: { configs: configsHasMore, users: usersHasMore, upstreams: false, relays: false },
      },
      server_time: ctx.now,
    },
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Request-Id': ctx.requestId },
  })
})

function syncError(c: Reqish, v: { limit: number; remaining: number; reset: number; retryAfter: number }): Response {
  return new Response(
    JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests', request_id: newRequestId(c) } }),
    { status: 429, headers: { 'Content-Type': 'application/json; charset=utf-8', ...rateHeaders(v), 'X-Request-Id': newRequestId(c) } },
  )
}

relaysDataPlane.post('/:id/heartbeat', requireRelay, async (c) => {
  const ctx = getCtx(c)
  assertRelaySelf(ctx, c.req.param('id') as string)
  const relayId = ctx.actor.kind === 'relay' ? ctx.actor.relayId : ''
  const verdict = await checkRate(c.env.KV, 'relay_heartbeat', relayId, ctx.now)
  if (!verdict.allowed) return syncError(c, verdict)

  const { body, issues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (issues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', issues)
  const r = new BodyReader(body as Record<string, unknown>, ['ts', 'status', 'agent_version', 'uptime_seconds', 'sync_cursor', 'active_configs', 'metadata'])
  r.int('ts', { required: true })
  const status = r.enum('status', ['online', 'degraded', 'error'], { required: true })
  const agentVersion = r.str('agent_version', { required: true, min: 1, max: 32 })
  r.int('uptime_seconds', { required: true, min: 0 })
  r.str('sync_cursor', { min: 1, max: 4096 })
  r.int('active_configs', { required: true, min: 0, max: 1_000_000 })
  const metadata = r.object('metadata', { maxKeys: 16 })
  assertValid(r.issues)
  if (metadata) {
    for (const [k, v] of Object.entries(metadata)) {
      const t = typeof v
      if (t !== 'string' && t !== 'number' && t !== 'boolean') {
        throw new ApiError('VALIDATION_ERROR', 'Metadata must be flat string|int|bool', [{ location: 'body', field: 'metadata', issue: `key ${k} has unsupported type` }])
      }
    }
    if (JSON.stringify(metadata).length > 2048) {
      throw new ApiError('VALIDATION_ERROR', 'Metadata too large', [{ location: 'body', field: 'metadata', issue: 'metadata exceeds 2KB' }], undefined)
    }
  }
  void status
  void agentVersion

  await c.env.DB.prepare(`UPDATE relays SET last_heartbeat_at = ?, last_health_status = ?, agent_version = ? WHERE id = ?`)
    .bind(ctx.now, status, agentVersion, relayId)
    .run()

  // should_sync: MAX(updated_at) of the 4 syncable tables vs the client cursor
  let shouldSync = true
  const rawCursor = (body as Record<string, unknown>)['sync_cursor']
  if (typeof rawCursor === 'string' && rawCursor.length > 0) {
    try {
      const cur = decodeSyncCursor(rawCursor)
      if (cur) {
        shouldSync = false
        for (const table of ['configs', 'users', 'upstreams', 'relays'] as const) {
          const row = await c.env.DB.prepare(`SELECT COALESCE(MAX(updated_at), 0) AS m FROM ${table}`).first<{ m: number }>()
          const pos = cur.p[table]
          if ((row?.m ?? 0) > (pos ? pos[0] : 0)) {
            shouldSync = true
            break
          }
        }
      }
    } catch {
      shouldSync = true // invalid cursor → should_sync true (§10.8)
    }
  }
  const relay = await c.env.DB.prepare(`SELECT status FROM relays WHERE id = ?`).bind(relayId).first<{ status: string }>()
  const last = await c.env.DB.prepare(`SELECT last_heartbeat_at FROM relays WHERE id = ?`).bind(relayId).first<{ last_heartbeat_at: number | null }>()
  const health = last?.last_heartbeat_at === null || last?.last_heartbeat_at === undefined ? 'unknown' : (ctx.now - last.last_heartbeat_at <= HEALTH_ONLINE_WINDOW_S ? 'online' : 'offline')
  return ok(c, {
    server_time: ctx.now,
    heartbeat_interval_seconds: HEARTBEAT_INTERVAL_S,
    should_sync: shouldSync,
    relay: { id: relayId, status: relay?.status ?? 'active', health },
  })
})

/* ---- usage ingestion: atomic pipeline with report_id idempotency (§10.9) ---- */

const DECIMAL_BYTES = /^[0-9]{1,19}$/

relaysDataPlane.post('/:id/usage', requireRelay, async (c) => {
  const ctx = getCtx(c)
  assertRelaySelf(ctx, c.req.param('id') as string)
  const relayId = ctx.actor.kind === 'relay' ? ctx.actor.relayId : ''
  const verdict = await checkRate(c.env.KV, 'relay_usage', relayId, ctx.now)
  if (!verdict.allowed) return syncError(c, verdict)

  const raw = await c.req.raw.text()
  if (raw.length > 1024 * 1024) throw new ApiError('REQUEST_TOO_LARGE')
  if (c.req.header('content-type') && !/application\/json/i.test(c.req.header('content-type') ?? '')) {
    throw new ApiError('UNSUPPORTED_MEDIA_TYPE')
  }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'body', issue: 'invalid JSON' }])
  }
  const b = body as Record<string, unknown>
  for (const key of Object.keys(b)) {
    if (!['report_id', 'generated_at', 'entries'].includes(key)) {
      throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'body', field: key, issue: 'unknown_field' }])
    }
  }
  const reportId = b['report_id']
  if (typeof reportId !== 'string' || !isUuid(reportId)) {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'body', field: 'report_id', issue: 'must be a UUIDv4' }])
  }
  const generatedAt = b['generated_at']
  if (typeof generatedAt !== 'number' || !Number.isInteger(generatedAt)) {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'body', field: 'generated_at', issue: 'must be epoch seconds' }])
  }
  const entries = b['entries']
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 500) {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'body', field: 'entries', issue: 'must be an array of 1..500 entries' }])
  }

  // ---- format validation + semantic reference validation (all-or-nothing) ----
  const details: Record<string, unknown>[] = []
  const parsedEntries: { user_id: string; config_id: string; up: bigint; down: bigint }[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as Record<string, unknown>
    let bad: string | null = null
    let up: unknown
    let down: unknown
    if (!e || typeof e !== 'object') bad = 'must be an object'
    else {
      for (const key of Object.keys(e)) {
        if (!['user_id', 'config_id', 'bytes_up', 'bytes_down', 'window_from', 'window_to'].includes(key)) bad = 'unknown_field'
      }
      if (!isUuid(e['user_id'])) bad = bad ?? 'user_id must be a UUIDv4'
      if (!isUuid(e['config_id'])) bad = bad ?? 'config_id must be a UUIDv4'
      up = e['bytes_up']
      down = e['bytes_down']
      if (typeof up !== 'string' || !DECIMAL_BYTES.test(up)) bad = bad ?? 'bytes_up must be a decimal string'
      if (typeof down !== 'string' || !DECIMAL_BYTES.test(down)) bad = bad ?? 'bytes_down must be a decimal string'
    }
    if (bad) {
      details.push({ location: 'body', field: `entries[${i}]`, issue: bad })
      continue
    }
    parsedEntries.push({ user_id: e['user_id'] as string, config_id: e['config_id'] as string, up: BigInt(up as string), down: BigInt(down as string) })
  }
  if (details.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', details)

  // semantic: config live + owned by this relay + user matches config owner
  const configIds = [...new Set(parsedEntries.map((e) => e.config_id))]
  const configMap = new Map<string, { user_id: string }>()
  for (let i = 0; i < configIds.length; i += 50) {
    const chunk = configIds.slice(i, i + 50)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = await c.env.DB.prepare(
      `SELECT id, user_id FROM configs WHERE relay_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`,
    )
      .bind(relayId, ...chunk)
      .all<{ id: string; user_id: string }>()
    for (const row of rows.results ?? []) configMap.set(row.id, { user_id: row.user_id })
  }
  const semanticIssues: Record<string, unknown>[] = []
  parsedEntries.forEach((e, i) => {
    const cfg = configMap.get(e.config_id)
    if (!cfg) semanticIssues.push({ location: 'body', field: `entries[${i}]`, issue: 'invalid_reference: config not assigned to this relay' })
    else if (cfg.user_id !== e.user_id) semanticIssues.push({ location: 'body', field: `entries[${i}]`, issue: 'invalid_reference: user does not own config' })
  })
  if (semanticIssues.length > 0) {
    throw new ApiError('VALIDATION_ERROR', 'Semantic validation failed', semanticIssues, undefined, 422)
  }

  // ---- idempotency check (UNIQUE(relay_id, report_id)) ----
  const canonical = JSON.stringify(parsedEntries.map((e) => ({ u: e.user_id, c: e.config_id, up: e.up.toString(), dn: e.down.toString() })))
  const payloadHashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  const payloadHash = [...new Uint8Array(payloadHashBuf)].map((x) => x.toString(16).padStart(2, '0')).join('')
  const existing = await c.env.DB.prepare(`SELECT payload_hash, ingested_at FROM usage_reports WHERE relay_id = ? AND report_id = ?`)
    .bind(relayId, reportId)
    .first<{ payload_hash: string; ingested_at: number }>()
  if (existing) {
    if (existing.payload_hash === payloadHash) {
      return ok(c, { status: 'already_processed', report_id: reportId, ingested_at: existing.ingested_at })
    }
    throw new ApiError('IDEMPOTENCY_CONFLICT', 'report_id was already used with a different payload')
  }

  const day = new Date(ctx.now * 1000).toISOString().slice(0, 10)
  const totalUp = parsedEntries.reduce((acc, e) => acc + e.up, 0n)
  const totalDown = parsedEntries.reduce((acc, e) => acc + e.down, 0n)

  // aggregate per (user, config) bucket and per user
  const buckets = new Map<string, { user_id: string; config_id: string; up: bigint; down: bigint }>()
  for (const e of parsedEntries) {
    const key = `${e.user_id}|${e.config_id}`
    const cur = buckets.get(key)
    if (cur) {
      cur.up += e.up
      cur.down += e.down
    } else {
      buckets.set(key, { ...e })
    }
  }
  const statements: D1PreparedStatement[] = []
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO usage_reports (id, relay_id, report_id, payload_hash, entries_json, entry_count, bytes_up_total, bytes_down_total, generated_at, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), relayId, reportId, payloadHash, canonical, parsedEntries.length, totalUp.toString(), totalDown.toString(), generatedAt, ctx.now),
  )
  const bucketList = [...buckets.values()]
  for (let i = 0; i < bucketList.length; i += 15) {
    const chunk = bucketList.slice(i, i + 15)
    const valuesSql = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')
    const params: unknown[] = []
    for (const bk of chunk) {
      params.push(day, relayId, bk.user_id, bk.config_id, bk.up.toString(), bk.down.toString())
    }
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO usage_daily (day, relay_id, user_id, config_id, bytes_up, bytes_down)
         SELECT * FROM (VALUES ${valuesSql}) WHERE true
         ON CONFLICT (day, relay_id, user_id, config_id)
         DO UPDATE SET bytes_up = bytes_up + excluded.bytes_up, bytes_down = bytes_down + excluded.bytes_down`,
      ).bind(...params),
    )
  }
  const entryList = parsedEntries.map((e) => ({ user_id: e.user_id, delta: e.up + e.down }))
  for (let i = 0; i < entryList.length; i += 45) {
    const chunk = entryList.slice(i, i + 45)
    const valuesSql = chunk.map(() => '(?, ?, ?)').join(', ')
    const params: unknown[] = []
    for (const en of chunk) params.push(en.user_id, en.delta.toString(), en.delta.toString())
    statements.push(
      c.env.DB.prepare(
        `UPDATE users SET traffic_used_bytes = traffic_used_bytes + t.d
         FROM (SELECT v.column1 AS uid, SUM(CAST(v.column2 AS INTEGER)) AS d FROM (VALUES ${valuesSql}) AS v GROUP BY v.column1) AS t
         WHERE users.id = t.uid`,
      ).bind(...params),
    )
  }
  try {
    await c.env.DB.batch(statements)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('UNIQUE') && msg.includes('relay_id')) {
      // concurrent duplicate — treat as replay with unknown payload
      throw new ApiError('IDEMPOTENCY_CONFLICT', 'report_id was already used with a different payload')
    }
    throw err
  }
  // per-user resulting counters (contract field `users`)
  const distinctUsers = [...new Set(parsedEntries.map((e) => e.user_id))]
  const usersOut: { user_id: string; traffic_used_bytes: string }[] = []
  for (let i = 0; i < distinctUsers.length; i += 50) {
    const chunk = distinctUsers.slice(i, i + 50)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = await c.env.DB.prepare(`SELECT id, traffic_used_bytes FROM users WHERE id IN (${placeholders})`).bind(...chunk).all<{ id: string; traffic_used_bytes: bigint | number }>()
    for (const row of rows.results ?? []) {
      usersOut.push({ user_id: row.id, traffic_used_bytes: typeof row.traffic_used_bytes === 'bigint' ? row.traffic_used_bytes.toString() : String(row.traffic_used_bytes) })
    }
  }
  return ok(c, { status: 'accepted', report_id: reportId, ingested_at: ctx.now, entries_accepted: parsedEntries.length, users: usersOut })
})


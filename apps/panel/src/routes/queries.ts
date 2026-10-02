/**
 * Usage query (§10.10), audit logs (§10.15), dashboard summary (§10.16).
 */
import { Hono } from 'hono'
import type { Env } from '../env'
import type { CybEnv, HelperCtx } from '../ctx'
import { ApiError, ok } from '../http'
import { checkQuery, isUuid } from '../validate'
import { getCtx, requireAdminOrBot, requireAdminOnly } from '../auth/middleware'
import { decodeCursor, encodeCursor } from '../http'
import { auditOut, bytesStr } from '../serialize'
import { HEALTH_ONLINE_WINDOW_S } from '../env'

export const usageQuery = new Hono<CybEnv>()
export const auditLogs = new Hono<CybEnv>()
export const dashboard = new Hono<CybEnv>()

/* ------------------------------ usage query ------------------------------ */

const USAGE_PARAMS = ['from', 'to', 'user_id', 'config_id', 'relay_id', 'granularity', 'limit', 'cursor', 'include_deleted'] as const

usageQuery.use('*', requireAdminOrBot('usage:read', 'usage:read'))
usageQuery.use('*', async (c, next) => {
  const issues = checkQuery(new URL(c.req.url), USAGE_PARAMS)
  if (issues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', issues)
  await next()
})

async function runUsageQuery(c: HelperCtx, scope: { userId?: string; configId?: string; relayId?: string } = {}): Promise<Response> {
  const url = new URL(c.req.url)
  const granularity = url.searchParams.get('granularity') ?? 'daily'
  if (granularity !== 'daily' && granularity !== 'raw') {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'granularity', issue: "must be 'daily'|'raw'" }])
  }
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !to || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'from', issue: "from/to are REQUIRED as YYYY-MM-DD (UTC, inclusive)" }])
  }
  if (granularity === 'raw') {
    const ctx = getCtx(c as never)
    if (ctx.actor.kind !== 'admin') {
      throw new ApiError('FORBIDDEN', 'Raw usage is admin-only', { reason: 'missing_scope' })
    }
  }
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
  if (days < 1) {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'to', issue: 'range is inverted' }])
  }
  if (granularity === 'daily' && days > 366) {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'to', issue: 'range_too_wide (daily <= 366 days)' }])
  }
  if (granularity === 'raw' && days > 31) {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'to', issue: 'range_too_wide (raw <= 31 days)' }])
  }
  const fromTs = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000)
  const toTs = Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000)

  if (granularity === 'daily') {
    const conds = ['day >= ?', 'day <= ?']
    const vals: unknown[] = [from, to]
    if (scope.userId) {
      conds.push('user_id = ?')
      vals.push(scope.userId)
    }
    if (scope.configId) {
      conds.push('config_id = ?')
      vals.push(scope.configId)
    }
    if (scope.relayId) {
      conds.push('relay_id = ?')
      vals.push(scope.relayId)
    }
    const rows = await c.env.DB.prepare(
      `SELECT day, SUM(bytes_up) AS bu, SUM(bytes_down) AS bd FROM usage_daily WHERE ${conds.join(' AND ')} GROUP BY day ORDER BY day ASC`,
    )
      .bind(...vals)
      .all<Record<string, unknown>>()
    const series = (rows.results ?? []).map((r) => ({ date: r.day, bytes_up: bytesStr(r.bu) ?? '0', bytes_down: bytesStr(r.bd) ?? '0' }))
    const totalsUp = series.reduce((a, s) => a + BigInt(s.bytes_up), 0n)
    const totalsDown = series.reduce((a, s) => a + BigInt(s.bytes_down), 0n)
    return ok(c, {
      granularity: 'daily',
      from,
      to,
      series,
      totals: { bytes_up: totalsUp.toString(), bytes_down: totalsDown.toString() },
    })
  }
  // raw
  const limitRaw = url.searchParams.get('limit')
  let limit = limitRaw === null ? 100 : Number(limitRaw)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'limit', issue: 'must be integer 1..100' }])
  }
  const conds = ['ingested_at >= ?', 'ingested_at <= ?']
  const vals: unknown[] = [fromTs, toTs]
  if (scope.userId) {
    conds.push('user_id = ?')
    vals.push(scope.userId)
  }
  if (scope.configId) {
    conds.push('config_id = ?')
    vals.push(scope.configId)
  }
  if (scope.relayId) {
    conds.push('relay_id = ?')
    vals.push(scope.relayId)
  }
  // raw rows are reconstructed from the append-only reports' entries_json
  const reports = await c.env.DB.prepare(
    `SELECT report_id, relay_id, entries_json, generated_at, ingested_at, entry_count FROM usage_reports WHERE relay_id IN (SELECT id FROM relays) AND ${conds.join(' AND ')} ORDER BY ingested_at ASC LIMIT 500`,
  )
    .bind(...vals)
    .all<Record<string, unknown>>()
  const entries: Record<string, unknown>[] = []
  for (const rep of reports.results ?? []) {
    let list: { user_id?: string; config_id?: string; bytes_up?: string; bytes_down?: string }[] = []
    try {
      list = JSON.parse(rep.entries_json as string) as typeof list
    } catch {
      continue
    }
    for (const e of list) {
      if (scope.userId && e.user_id !== scope.userId) continue
      if (scope.configId && e.config_id !== scope.configId) continue
      entries.push({
        report_id: rep.report_id,
        relay_id: rep.relay_id,
        user_id: e.user_id,
        config_id: e.config_id,
        bytes_up: e.bytes_up,
        bytes_down: e.bytes_down,
        reported_at: rep.generated_at,
        ingested_at: rep.ingested_at,
      })
    }
  }
  const cursor = url.searchParams.get('cursor')
  let start = 0
  if (cursor) {
    try {
      const c2 = decodeCursor(cursor)
      start = Number(c2.s) || 0
    } catch {
      throw new ApiError('CURSOR_INVALID', 'cursor is corrupt')
    }
  }
  const page = entries.slice(start, start + limit)
  const hasMore = start + limit < entries.length
  return ok(c, {
    granularity: 'raw',
    from,
    to,
    entries: page,
  }, { pagination: { limit, next_cursor: hasMore ? encodeCursor(start + limit, 'raw') : null, has_more: hasMore } })
}

usageQuery.get('/', async (c) => runUsageQuery(c))

usageQuery.get('/users/:id/usage', async (c) => {
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<Record<string, unknown>>()
  if (!user) throw new ApiError('NOT_FOUND')
  const res = await runUsageQuery(c, { userId: id })
  if (res.status !== 200) return res
  const body = (await res.json()) as { data: { series: { date: string; bytes_up: string; bytes_down: string }[]; totals: { bytes_up: string; bytes_down: string } } }
  // current_period start from the effective reset day (user override ?? settings default)
  const settingsRow = await c.env.DB.prepare(`SELECT value FROM settings WHERE key = 'traffic_reset_default_day'`).first<{ value: string }>()
  const defaultDay = settingsRow ? Number(JSON.parse(settingsRow.value)) : 1
  const effectiveDay = (user.traffic_reset_day as number | null) ?? defaultDay
  const now = new Date()
  const utcDay = now.getUTCDate()
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  since.setUTCDate(Math.min(effectiveDay, 28))
  if (utcDay < effectiveDay) {
    since.setUTCMonth(since.getUTCMonth() - 1)
  }
  const sinceStr = since.toISOString().slice(0, 10)
  const periodSeries = body.data.series.filter((s) => s.date >= sinceStr)
  const periodUp = periodSeries.reduce((a, s) => a + BigInt(s.bytes_up), 0n)
  const periodDown = periodSeries.reduce((a, s) => a + BigInt(s.bytes_down), 0n)
  const data = {
    ...body.data,
    current_period: {
      since: sinceStr,
      bytes_up: periodUp.toString(),
      bytes_down: periodDown.toString(),
    },
  }
  return ok(c, data)
})

usageQuery.get('/configs/:configId/usage', async (c) => {
  const id = c.req.param('configId')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'config_id', issue: 'must be a UUIDv4' }])
  const cfg = await c.env.DB.prepare(`SELECT id FROM configs WHERE id = ?`).bind(id).first<{ id: string }>()
  if (!cfg) throw new ApiError('NOT_FOUND')
  return runUsageQuery(c, { configId: id })
})

usageQuery.get('/relays/:id/usage', async (c) => {
  const id = c.req.param('id')
  if (!isUuid(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a UUIDv4' }])
  const relay = await c.env.DB.prepare(`SELECT id FROM relays WHERE id = ?`).bind(id).first<{ id: string }>()
  if (!relay) throw new ApiError('NOT_FOUND')
  return runUsageQuery(c, { relayId: id })
})

/* -------------------------------- audit logs -------------------------------- */

const AUDIT_PARAMS = ['actor_type', 'actor_id', 'action', 'entity_type', 'entity_id', 'from', 'to', 'limit', 'cursor'] as const

auditLogs.use('*', requireAdminOrBot('audit:read'))

auditLogs.get('/', async (c) => {
  const url = new URL(c.req.url)
  const issues = checkQuery(url, AUDIT_PARAMS)
  if (issues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', issues)
  let limit = 25
  const limitRaw = url.searchParams.get('limit')
  if (limitRaw !== null) {
    limit = Number(limitRaw)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'limit', issue: 'must be integer 1..100' }])
    }
  }
  const conds: string[] = []
  const vals: unknown[] = []
  const actorType = url.searchParams.get('actor_type')
  if (actorType) {
    if (!['admin', 'bot', 'relay', 'subscription', 'system'].includes(actorType)) {
      throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'actor_type', issue: 'invalid actor_type' }])
    }
    conds.push('actor_type = ?')
    vals.push(actorType)
  }
  const actorId = url.searchParams.get('actor_id')
  if (actorId) {
    conds.push('actor_id = ?')
    vals.push(actorId)
  }
  const action = url.searchParams.get('action')
  if (action) {
    if (action.length < 1 || action.length > 100) {
      throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'action', issue: 'length must be 1..100' }])
    }
    if (action.endsWith('*')) {
      conds.push('action LIKE ?')
      vals.push(`${action.slice(0, -1).replace(/[%_]/g, (m) => `\\${m}`)}%`)
    } else {
      conds.push('action = ?')
      vals.push(action)
    }
  }
  const entityType = url.searchParams.get('entity_type')
  if (entityType) {
    conds.push('entity_type = ?')
    vals.push(entityType)
  }
  const entityId = url.searchParams.get('entity_id')
  if (entityId) {
    conds.push('entity_id = ?')
    vals.push(entityId)
  }
  const from = url.searchParams.get('from')
  if (from) {
    if (!/^\d+$/.test(from)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'from', issue: 'must be epoch seconds' }])
    conds.push('created_at >= ?')
    vals.push(Number(from))
  }
  const to = url.searchParams.get('to')
  if (to) {
    if (!/^\d+$/.test(to)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'query', field: 'to', issue: 'must be epoch seconds' }])
    conds.push('created_at <= ?')
    vals.push(Number(to))
  }
  let cursorPos: { id: number } | null = null
  const cursor = url.searchParams.get('cursor')
  if (cursor) {
    try {
      const c2 = decodeCursor(cursor)
      cursorPos = { id: Number(c2.i) }
    } catch {
      throw new ApiError('CURSOR_INVALID', 'cursor is corrupt')
    }
  }
  if (cursorPos) {
    conds.push('id < ?')
    vals.push(cursorPos.id)
  }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM audit_logs WHERE ${conds.length > 0 ? conds.join(' AND ') : '1=1'} ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
    .bind(...vals, limit + 1)
    .all<Record<string, unknown>>()
  let data = rows.results ?? []
  let hasMore = false
  if (data.length > limit) {
    hasMore = true
    data = data.slice(0, limit)
  }
  const last = data[data.length - 1]
  return ok(c, data.map(auditOut), { pagination: { limit, next_cursor: hasMore && last ? encodeCursor(last.created_at as number, String(last.id)) : null, has_more: hasMore } })
})

auditLogs.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!/^\d+$/.test(id)) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [{ location: 'path', field: 'id', issue: 'must be a numeric audit id' }])
  const row = await c.env.DB.prepare(`SELECT * FROM audit_logs WHERE id = ?`).bind(Number(id)).first<Record<string, unknown>>()
  if (!row) throw new ApiError('NOT_FOUND')
  return ok(c, auditOut(row))
})

/* -------------------------------- dashboard -------------------------------- */

dashboard.use('*', requireAdminOrBot('dashboard:read'))

dashboard.get('/summary', async (c) => {
  const ctx = getCtx(c)
  const now = ctx.now
  const nowMs = now * 1000
  const count = async (sql: string, ...params: unknown[]): Promise<number> => {
    const r = await c.env.DB.prepare(sql).bind(...params).first<{ n: number }>()
    return r?.n ?? 0
  }
  const [
    usersTotal, usersActive, usersDisabled, usersExpired, usersDeleted,
    configsTotal, configsEnabled, configsByProtocolRows,
    upstreamsTotal, upstreamsActive,
    relaysTotal, relaysRows,
    subsTotal, subsActive, subsRevoked,
  ] = await Promise.all([
    count(`SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL`),
    count(`SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL AND status = 'active'`),
    count(`SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL AND status = 'disabled'`),
    count(`SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?`, now),
    count(`SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NOT NULL`),
    count(`SELECT COUNT(*) AS n FROM configs WHERE deleted_at IS NULL`),
    count(`SELECT COUNT(*) AS n FROM configs WHERE deleted_at IS NULL AND enabled = 1`),
    c.env.DB.prepare(`SELECT protocol, COUNT(*) AS n FROM configs WHERE deleted_at IS NULL GROUP BY protocol`).all<{ protocol: string; n: number }>(),
    count(`SELECT COUNT(*) AS n FROM upstreams WHERE deleted_at IS NULL`),
    count(`SELECT COUNT(*) AS n FROM upstreams WHERE deleted_at IS NULL AND status = 'active'`),
    count(`SELECT COUNT(*) AS n FROM relays WHERE deleted_at IS NULL`),
    c.env.DB.prepare(`SELECT id, name, status, last_heartbeat_at FROM relays WHERE deleted_at IS NULL`).all<Record<string, unknown>>(),
    count(`SELECT COUNT(*) AS n FROM subscriptions WHERE deleted_at IS NULL`),
    count(`SELECT COUNT(*) AS n FROM subscriptions WHERE deleted_at IS NULL AND status = 'active'`),
    count(`SELECT COUNT(*) AS n FROM subscriptions WHERE deleted_at IS NULL AND status = 'revoked'`),
  ])
  const byProtocol: Record<string, number> = {}
  for (const r of configsByProtocolRows.results ?? []) byProtocol[r.protocol] = r.n
  const relayList = relaysRows.results ?? []
  let relaysOnline = 0
  let relaysOffline = 0
  let relaysUnknown = 0
  let relaysDisabled = 0
  const relaysHealth = relayList.map((r) => {
    const last = r.last_heartbeat_at as number | null
    let health: string
    if (r.status === 'disabled') health = 'disabled'
    else if (last === null || last === undefined) health = 'unknown'
    else if (now - (last as number) <= HEALTH_ONLINE_WINDOW_S) health = 'online'
    else health = 'offline'
    if (health === 'online') relaysOnline++
    else if (health === 'offline') relaysOffline++
    else if (health === 'disabled') relaysDisabled++
    else relaysUnknown++
    return { id: r.id, name: r.name, status: health, last_seen_at: last === null || last === undefined ? null : new Date((last as number) * 1000).toISOString() }
  })
  // calendar month-to-date usage (UTC)
  const monthStart = new Date(Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), 1))
  const from = monthStart.toISOString().slice(0, 10)
  const to = new Date(nowMs).toISOString().slice(0, 10)
  const usageRows = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(bytes_up), 0) AS bu, COALESCE(SUM(bytes_down), 0) AS bd FROM usage_daily WHERE day >= ? AND day <= ?`,
  )
    .bind(from, to)
    .first<{ bu: bigint | number; bd: bigint | number }>()
  const today = new Date(nowMs).toISOString().slice(0, 10)
  const d7 = new Date(nowMs - 6 * 86400000).toISOString().slice(0, 10)
  const d30 = new Date(nowMs - 29 * 86400000).toISOString().slice(0, 10)
  const trafficToday = await c.env.DB.prepare(`SELECT COALESCE(SUM(bytes_up + bytes_down), 0) AS s FROM usage_daily WHERE day = ?`).bind(today).first<{ s: bigint | number }>()
  const traffic7 = await c.env.DB.prepare(`SELECT COALESCE(SUM(bytes_up + bytes_down), 0) AS s FROM usage_daily WHERE day >= ?`).bind(d7).first<{ s: bigint | number }>()
  const traffic30 = await c.env.DB.prepare(`SELECT COALESCE(SUM(bytes_up + bytes_down), 0) AS s FROM usage_daily WHERE day >= ?`).bind(d30).first<{ s: bigint | number }>()
  const recentAudit = await c.env.DB.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 10`).all<Record<string, unknown>>()
  const bytesUp = typeof usageRows?.bu === 'bigint' ? usageRows.bu.toString() : String(usageRows?.bu ?? 0)
  const bytesDown = typeof usageRows?.bd === 'bigint' ? usageRows.bd.toString() : String(usageRows?.bd ?? 0)
  return ok(c, {
    server_time: now,
    // canonical shape (Prompt 4 §10.16)
    users: { total: usersTotal, active: usersActive, disabled: usersDisabled, expired: usersExpired, deleted: usersDeleted },
    configs: { total: configsTotal, by_protocol: byProtocol },
    upstreams: { total: upstreamsTotal, active: upstreamsActive },
    relays: { total: relaysTotal, online: relaysOnline, offline: relaysOffline, unknown: relaysUnknown, disabled: relaysDisabled },
    subscriptions: { total: subsTotal, active: subsActive, revoked: subsRevoked },
    usage: { window: { from, to }, bytes_up: bytesUp, bytes_down: bytesDown },
    // compat shape (Prompt 6 bot, GAP-C3)
    counts: {
      users: { total: usersTotal, active: usersActive, disabled: usersDisabled, expired: usersExpired },
      configs: { total: configsTotal, enabled: configsEnabled },
      upstreams: { total: upstreamsTotal, enabled: upstreamsActive },
      relays: { total: relaysTotal, online: relaysOnline, offline: relaysOffline },
      subscriptions: { total: subsTotal, active: subsActive },
    },
    traffic: {
      today: bytesStr(trafficToday?.s) ?? '0',
      last_7d: bytesStr(traffic7?.s) ?? '0',
      last_30d: bytesStr(traffic30?.s) ?? '0',
    },
    relays_health: relaysHealth,
    recent_audit: (recentAudit.results ?? []).map(auditOut),
  })
})

/**
 * Auth routes (Prompt 4 §10.1) + first-admin bootstrap.
 *
 * GAP-1 RESOLUTION (Prompt 5 GAP-1, option b): POST /api/v1/setup creates the
 * FIRST owner admin and is hard-refused (409) once any admin row exists.
 * GET /api/v1/setup/status discloses only a boolean (needed or not).
 * This is required because Workers have no CLI provisioning path; documented
 * in the Prompt 8 GAP register.
 */
import { Hono } from 'hono'
import type { Env } from '../env'
import type { CybEnv } from '../ctx'
import {
  ApiError,
  noContent,
  ok,
  readJsonBody,
} from '../http'
import { BodyReader, assertValid } from '../validate'
import { dummyVerify, hashPassword, needsRehash, verifyPassword } from '../auth/password'
import { createSession, csrfCookie, destroyOtherSessions, destroySession, getSession, parseSessionCookie, sessionCookie } from '../auth/session'
import { getCtx, requireAdmin } from '../auth/middleware'
import { checkRate, rateHeaders } from '../ratelimit'
import { writeAudit } from '../audit'

const app = new Hono<CybEnv>()

interface AdminRow {
  id: string
  username: string
  password_hash: string
}

app.get('/setup/status', async (c) => {
  const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM admins`).first<{ n: number }>()
  return ok(c, { needs_setup: (row?.n ?? 0) === 0 })
})

app.post('/setup', async (c) => {
  const { body, issues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (issues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', issues)
  const r = new BodyReader(body as Record<string, unknown>, ['username', 'password'])
  const username = r.str('username', { min: 3, max: 64, pattern: /^[A-Za-z0-9_.@-]+$/ })
  const password = r.str('password', { min: 12, max: 128 })
  assertValid(r.issues)
  const existing = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM admins`).first<{ n: number }>()
  if ((existing?.n ?? 0) > 0) {
    throw new ApiError('CONFLICT', 'An administrator already exists', { issue: 'already_bootstrapped' })
  }
  const now = Math.floor(Date.now() / 1000)
  const id = crypto.randomUUID()
  const hash = await hashPassword(password!, c.env.ADMIN_PEPPER)
  await c.env.DB.prepare(
    `INSERT INTO admins (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, username, hash, now, now)
    .run()
  const sess = await createSession(c.env.KV, id, now)
  writeAudit(
    c.env.DB,
    { actor_type: 'system', action: 'auth.bootstrap', entity_type: 'admin', entity_id: id, request_id: c.get('requestId') },
    (p) => c.executionCtx.waitUntil(p),
  )
  return ok(
    c,
    { admin: { id, username } },
    undefined,
    201,
    { 'Set-Cookie': `${sessionCookie(sess.id, 12 * 3600)}, ${csrfCookie(sess.csrf)}` },
  )
})

app.post('/auth/login', async (c) => {
  const now = Math.floor(Date.now() / 1000)
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const { body, issues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (issues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', issues)
  const r = new BodyReader(body as Record<string, unknown>, ['username', 'password'])
  const username = r.str('username', { required: true, min: 1, max: 64 })
  const password = r.str('password', { required: true, min: 1, max: 128 })
  assertValid(r.issues)

  // rate limits: per-IP 10/min and per-username 5/15min (§3.1)
  const ipVerdict = await checkRate(c.env.KV, 'auth_login_ip', ip, now)
  if (!ipVerdict.allowed) {
    return new Response(
      JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests', request_id: c.get('requestId') ?? '' } }),
      { status: 429, headers: { 'Content-Type': 'application/json; charset=utf-8', ...rateHeaders(ipVerdict) } },
    )
  }
  const userVerdict = await checkRate(c.env.KV, 'auth_login_user', `u:${username}`, now)
  if (!userVerdict.allowed) {
    return new Response(
      JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many attempts; try later', request_id: c.get('requestId') ?? '' } }),
      { status: 429, headers: { 'Content-Type': 'application/json; charset=utf-8', ...rateHeaders(userVerdict) } },
    )
  }
  const lockKey = `lockout:${username}`
  if ((await c.env.KV.get(lockKey)) === '1') {
    return new Response(
      JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Account temporarily locked', request_id: c.get('requestId') ?? '' } }),
      { status: 429, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '900' } },
    )
  }

  const row = await c.env.DB.prepare(`SELECT id, username, password_hash FROM admins WHERE username = ?`)
    .bind(username)
    .first<AdminRow>()

  let valid = false
  let adminId: string | null = null
  if (row) {
    valid = await verifyPassword(password!, c.env.ADMIN_PEPPER, row.password_hash)
    adminId = row.id
  } else {
    await dummyVerify(c.env.ADMIN_PEPPER)
  }

  if (!valid || !adminId) {
    const fails = Number((await c.env.KV.get(`loginfail:${username}`)) ?? '0') + 1
    await c.env.KV.put(`loginfail:${username}`, String(fails), { expirationTtl: 900 })
    if (fails >= 10) await c.env.KV.put(lockKey, '1', { expirationTtl: 900 })
    writeAudit(
      c.env.DB,
      { actor_type: 'admin', action: 'auth.login_failed', metadata: { username }, request_id: c.get('requestId'), ip },
      (p) => c.executionCtx.waitUntil(p),
    )
    // identical message for unknown-user vs wrong-password (no enumeration)
    throw new ApiError('UNAUTHORIZED', 'Invalid credentials')
  }
  await c.env.KV.delete(`loginfail:${username}`)

  // lazy rehash when stored params differ from current policy
  if (row && needsRehash(row.password_hash)) {
    const newHash = await hashPassword(password!, c.env.ADMIN_PEPPER)
    c.executionCtx.waitUntil(
      c.env.DB.prepare(`UPDATE admins SET password_hash = ?, updated_at = ? WHERE id = ?`)
        .bind(newHash, now, adminId)
        .run(),
    )
  }

  const sess = await createSession(c.env.KV, adminId, now)
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: adminId, action: 'auth.login', request_id: c.get('requestId'), ip, user_agent: c.req.header('user-agent') },
    (p) => c.executionCtx.waitUntil(p),
  )
  return ok(c, { csrf: sess.csrf }, undefined, 200, {
    'Set-Cookie': `${sessionCookie(sess.id, 12 * 3600)}, ${csrfCookie(sess.csrf)}`,
  })
})

app.use('/auth/me', requireAdmin)
app.get('/auth/me', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('UNAUTHORIZED')
  const row = await c.env.DB.prepare(`SELECT id, username, created_at FROM admins WHERE id = ?`)
    .bind(ctx.actor.adminId)
    .first<{ id: string; username: string; created_at: number }>()
  if (!row) throw new ApiError('NOT_FOUND')
  return ok(c, {
    admin: { id: row.id, username: row.username, created_at: new Date(row.created_at * 1000).toISOString() },
    csrf: ctx.actor.session.csrf,
  })
})

app.use('/auth/logout', requireAdmin)
app.post('/auth/logout', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('UNAUTHORIZED')
  await destroySession(c.env.KV, ctx.actor.sessionKey)
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.adminId, action: 'auth.logout', request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  return noContent(c, { 'Set-Cookie': 'cybrix_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0' })
})

app.use('/auth/password/change', requireAdmin)
app.post('/auth/password/change', async (c) => {
  const ctx = getCtx(c)
  if (ctx.actor.kind !== 'admin') throw new ApiError('UNAUTHORIZED')
  const { body, issues } = await readJsonBody(c.req.raw, 256 * 1024)
  if (issues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', issues)
  const r = new BodyReader(body as Record<string, unknown>, ['current_password', 'new_password'])
  const current = r.str('current_password', { required: true, min: 1, max: 128 })
  const next = r.str('new_password', { required: true, min: 12, max: 128 })
  assertValid(r.issues)
  const row = await c.env.DB.prepare(`SELECT id, password_hash FROM admins WHERE id = ?`)
    .bind(ctx.actor.adminId)
    .first<{ id: string; password_hash: string }>()
  if (!row || !(await verifyPassword(current!, c.env.ADMIN_PEPPER, row.password_hash))) {
    throw new ApiError('UNAUTHORIZED', 'Invalid credentials')
  }
  const newHash = await hashPassword(next!, c.env.ADMIN_PEPPER)
  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare(`UPDATE admins SET password_hash = ?, updated_at = ? WHERE id = ?`)
    .bind(newHash, now, ctx.actor.adminId)
    .run()
  // invalidate every other session (§3.1)
  await destroyOtherSessions(c.env.KV, ctx.actor.adminId, ctx.actor.sessionKey)
  writeAudit(
    c.env.DB,
    { actor_type: 'admin', actor_id: ctx.actor.adminId, action: 'auth.password_change', request_id: ctx.requestId },
    (p) => ctx.waitUntil(p),
  )
  return noContent(c)
})

export default app

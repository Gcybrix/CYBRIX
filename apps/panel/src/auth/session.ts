/**
 * Admin sessions in KV (Prompt 4 §3.1): key `sess:<id>` → {admin_id, iat, exp, csrf}.
 * Sliding 12h TTL, absolute 24h cap. CSRF token stored in the record; cookie is
 * HttpOnly, the CSRF cookie is readable (SPA reads it, but /auth/me also returns it).
 */
import { SESSION_ABSOLUTE_TTL_S, SESSION_TTL_S } from '../env'
import { timingSafeEqual } from './password'

export interface SessionRecord {
  admin_id: string
  iat: number
  exp: number
  csrf: string
}

const COOKIE_NAME = 'cybrix_session'

function sessionId(): string {
  const raw = crypto.getRandomValues(new Uint8Array(16))
  let bin = ''
  for (const b of raw) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function createSession(kv: KVNamespace, adminId: string, now: number): Promise<{ id: string; csrf: string }> {
  const id = sessionId()
  const csrf = crypto.randomUUID().replace(/-/g, '')
  const record: SessionRecord = { admin_id: adminId, iat: now, exp: now, csrf }
  await kv.put(`sess:${id}`, JSON.stringify(record), { expirationTtl: SESSION_TTL_S })
  return { id, csrf }
}

export async function getSession(kv: KVNamespace, id: string): Promise<SessionRecord | null> {
  const raw = await kv.get(`sess:${id}`)
  if (!raw) return null
  try {
    const rec = JSON.parse(raw) as SessionRecord
    if (!rec || typeof rec.admin_id !== 'string') return null
    return rec
  } catch {
    return null
  }
}

/** Sliding renewal, bounded by the absolute cap (§3.1). */
export async function touchSession(kv: KVNamespace, id: string, rec: SessionRecord, now: number): Promise<void> {
  if (now - rec.iat > SESSION_ABSOLUTE_TTL_S) return // absolute cap reached; do not extend
  rec.exp = now
  await kv.put(`sess:${id}`, JSON.stringify(rec), { expirationTtl: SESSION_TTL_S })
}

export async function destroySession(kv: KVNamespace, id: string): Promise<void> {
  await kv.delete(`sess:${id}`)
}

/** Invalidate every session of an admin except the current one (password change). */
export async function destroyOtherSessions(kv: KVNamespace, adminId: string, keepId: string | null): Promise<void> {
  // KV list by prefix; small admin count in v1 keeps this cheap.
  let cursor: string | undefined
  do {
    const page = await kv.list({ prefix: 'sess:', cursor, limit: 100 })
    for (const key of page.keys) {
      const raw = await kv.get(key.name)
      if (!raw) continue
      try {
        const rec = JSON.parse(raw) as SessionRecord
        if (rec.admin_id === adminId && key.name !== `sess:${keepId ?? ''}`) await kv.delete(key.name)
      } catch {
        await kv.delete(key.name)
      }
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
}

export function parseSessionCookie(header: string | null | undefined): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === COOKIE_NAME) return rest.join('=')
  }
  return null
}

export function sessionCookie(id: string, maxAge: number): string {
  return `${COOKIE_NAME}=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

export function csrfCookie(token: string): string {
  return `cybrix_csrf=${token}; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_S}`
}

export function verifyCsrf(rec: SessionRecord, header: string | null | undefined): boolean {
  if (!header) return false
  return timingSafeEqual(rec.csrf, header)
}

/**
 * Panel unit tests — core security & contract logic (Prompt 8 §7/§21 support).
 * Integration/E2E coverage runs against the real deployment (smoke script).
 */
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, needsRehash, timingSafeEqual } from '../src/auth/password'
import { generateToken, sha256Hex, looksLikeToken } from '../src/auth/tokens'
import { encodeCursor, decodeCursor, ApiError } from '../src/http'
import { decodeSyncCursorTestHook } from './helpers'
import { encryptCredential, decryptCredential, normalizeCredential, randomUuidV4 } from '../src/crypto/credential'
import { userOut, relayOut, auditOut, bytesStr } from '../src/serialize'
import { parseListQuery } from '../src/list'
import { sanitizeMetadata } from '../src/audit'

describe('password hashing (PBKDF2 + pepper)', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery', 'pepper-secret')
    expect(hash.startsWith('$pbkdf2-sha256$i=')).toBe(true)
    expect(await verifyPassword('correct horse battery', 'pepper-secret', hash)).toBe(true)
    expect(await verifyPassword('wrong password', 'pepper-secret', hash)).toBe(false)
  })
  it('pepper changes the hash (pepper is load-bearing)', async () => {
    const h1 = await hashPassword('pw1234567890', 'pepper-A')
    expect(await verifyPassword('pw1234567890', 'pepper-B', h1)).toBe(false)
  })
  it('salt is random per hash', async () => {
    const a = await hashPassword('pw1234567890', 'p')
    const b = await hashPassword('pw1234567890', 'p')
    expect(a).not.toBe(b)
  })
  it('flags old params for lazy rehash', () => {
    expect(needsRehash('$pbkdf2-sha256$i=650000,s=x,p=v1$y')).toBe(true)
    expect(needsRehash('$pbkdf2-sha256$i=100000,s=x,p=v1$y')).toBe(false)
  })
  it('timingSafeEqual behaves', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('token machinery', () => {
  it('generates contract-format tokens (prefix + 43 base64url chars)', async () => {
    for (const kind of ['bot', 'relay', 'subscription'] as const) {
      const { token, hash, prefix } = await generateToken(kind)
      expect(looksLikeToken(token)).toBe(true)
      expect(token.startsWith('cbx_' + (kind === 'bot' ? 'bot' : kind === 'relay' ? 'rl' : 'sub') + '_')).toBe(true)
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
      expect(prefix).toBe(token.slice(0, 12))
      expect(hash).toBe(await sha256Hex(token))
    }
  })
  it('two tokens never collide', async () => {
    const a = await generateToken('relay')
    const b = await generateToken('relay')
    expect(a.token).not.toBe(b.token)
    expect(a.hash).not.toBe(b.hash)
  })
})

describe('pagination cursor codec', () => {
  it('round-trips (sort value + id tiebreaker)', () => {
    const cur = encodeCursor(1758700800, 'abc-123')
    const dec = decodeCursor(cur)
    expect(dec).toEqual({ v: 1, s: 1758700800, i: 'abc-123' })
  })
  it('rejects corrupt cursors with CURSOR_INVALID', () => {
    expect(() => decodeCursor('!!!not-base64!!!')).toThrow(ApiError)
    const bad = btoa(JSON.stringify({ v: 2 }))
    expect(() => decodeCursor(bad)).toThrow(/corrupt/)
  })
})

describe('relay sync cursor codec', () => {
  it('round-trips the composite per-type cursor', () => {
    const cur = { v: 1 as const, p: { configs: [100, 'c1'], users: null, upstreams: null, relays: [5, 'r'] } }
    const enc = Buffer.from(JSON.stringify(cur)).toString('base64url')
    const dec = decodeSyncCursorTestHook(enc)
    expect(dec).toEqual(cur)
  })
  it('rejects corrupt composite cursors', () => {
    expect(() => decodeSyncCursorTestHook('garbage!!')).toThrow(/corrupt/)
  })
})

describe('AES-256-GCM credential envelope', () => {
  const keyB64 = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
  it('round-trips plaintext', async () => {
    const pt = JSON.stringify({ uuid: randomUuidV4() })
    const env = await encryptCredential(pt, keyB64)
    expect(env.startsWith('v1:')).toBe(true)
    expect(env).not.toContain('uuid')
    expect(await decryptCredential(env, keyB64)).toBe(pt)
  })
  it('wrong key fails to decrypt', async () => {
    const other = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
    const env = await encryptCredential('secret', keyB64)
    await expect(decryptCredential(env, other)).rejects.toThrow()
  })
  it('normalizes per-protocol credentials and auto-generates', () => {
    expect(normalizeCredential('vless', { uuid: randomUuidV4() }).ok).toBe(true)
    expect(normalizeCredential('vless', { uuid: 'not-a-uuid' }).ok).toBe(false)
    const gen = normalizeCredential('trojan', null)
    expect(gen.ok).toBe(true)
    expect((gen.normalized as { password: string }).password.length).toBeGreaterThanOrEqual(8)
    const ss = normalizeCredential('ss', { password: 'longenoughpw', method: 'bogus' })
    expect(ss.ok).toBe(false)
  })
})

describe('serialization (admin plane + compat aliases)', () => {
  it('users carry both canonical and compat fields', () => {
    const out = userOut({ id: 'u1', contact: '@alice', status: 'active', expires_at: 1798761600, traffic_used_bytes: 536870912, traffic_limit_bytes: 1099511627776n, traffic_reset_day: 5, created_at: 1756000000, updated_at: 1758700000, deleted_at: null, version: 3 })
    expect(out.contact).toBe('@alice')
    expect(out.username).toBe('@alice')
    expect(out.enabled).toBe(true)
    expect(out.traffic_limit_bytes).toBe('1099511627776')
    expect(out.traffic_used_bytes).toBe('536870912')
    expect(String(out.expires_at)).toContain('T')
  })
  it('relay health derives from heartbeat window', () => {
    const now = 1758700900
    expect(relayOut({ id: 'r', name: 'x', last_heartbeat_at: now - 60, created_at: 0, updated_at: 0, version: 1 }, now).health).toBe('online')
    expect(relayOut({ id: 'r', name: 'x', last_heartbeat_at: now - 600, created_at: 0, updated_at: 0, version: 1 }, now).health).toBe('offline')
    expect(relayOut({ id: 'r', name: 'x', last_heartbeat_at: null, created_at: 0, updated_at: 0, version: 1 }, now).health).toBe('unknown')
  })
  it('audit rows expose entity_* and resource_* aliases', () => {
    const out = auditOut({ id: 1n, created_at: 1758700000, actor_type: 'admin', actor_id: 'a', action: 'user.create', entity_type: 'user', entity_id: 'e', metadata: '{"changed":["status"]}' })
    expect(out.entity_type).toBe('user')
    expect(out.resource_type).toBe('user')
    expect(out.details).toEqual({ changed: ['status'] })
  })
  it('bytesStr handles bigint and null', () => {
    expect(bytesStr(42n)).toBe('42')
    expect(bytesStr(null)).toBe(null)
  })
})

describe('list query validation', () => {
  it('rejects bad limits and sort fields', () => {
    const url = new URL('https://x/api/v1/users?limit=1000')
    expect(() => parseListQuery(url, 'users')).toThrow(ApiError)
    const url2 = new URL('https://x/api/v1/users?sort=hack')
    expect(() => parseListQuery(url2, 'users')).toThrow()
  })
  it('accepts the documented defaults', () => {
    const p = parseListQuery(new URL('https://x/api/v1/users'), 'users')
    expect(p.limit).toBe(25)
    expect(p.sort).toBe('created_at')
    expect(p.order).toBe('desc')
  })
})

describe('audit metadata sanitizer', () => {
  it('strips secret-looking keys, keeps safe ones', () => {
    const out = JSON.parse(sanitizeMetadata({ changed: ['status'], token: 'cbx_rl_XXX', password_hint: 'x', relay_id: 'r1' })!)
    expect(out.changed).toEqual(['status'])
    expect(out.relay_id).toBe('r1')
    expect(out.token).toBeUndefined()
    expect(out.password_hint).toBeUndefined()
  })
})

describe('sync list param whitelist', () => {
  it('unknown query params are rejected (400 contract)', async () => {
    const { checkQuery } = await import('../src/validate')
    const issues = checkQuery(new URL('https://x/api/v1/users?foo=1'), ['limit'])
    expect(issues).toEqual([{ location: 'query', field: 'foo', issue: 'unknown_parameter' }])
  })
})

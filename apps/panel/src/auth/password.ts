/**
 * Admin password hashing — PBKDF2-SHA256 with pepper pre-hash (Prompt 3).
 *
 * PHC format:  $pbkdf2-sha256$i=<iter>,s=<salt_b64>,p=<pepper_ver>$<hash_b64>
 * Lazy rehash: login recomputes with current params when stored params differ.
 *
 * NOTE (GAP-S1): Cloudflare Workers WebCrypto caps PBKDF2 iterations at 100,000.
 * The Prompt 3 parameter 650k is therefore not implementable with the native
 * runtime primitive; the default here is the platform maximum (100k) with a
 * 16-byte random salt AND a secret pepper pre-hash (server-side secret the
 * attacker never sees), registered as GAP-S1 in the Prompt 8 report. Iterations
 * are stored per-hash so a future bump rehashes transparently on next login.
 */

const ITERATIONS = 100_000 // platform max (native WebCrypto), see GAP-S1
const KEYLEN_BITS = 256
const PEPPER_VER = 'v1'

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (const b of arr) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    keyMaterial,
    KEYLEN_BITS,
  )
}

/** Constant-time string compare. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // still compare to keep timing flat-ish
    let r = 1
    for (let i = 0; i < Math.max(a.length, b.length); i++) r &= (a.charCodeAt(i % a.length) || 0) ^ (b.charCodeAt(i % b.length) || 0)
    return r === 0 && false
  }
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

export async function hashPassword(password: string, pepper: string, iterations = ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  // Pre-hash with pepper: the stored hash never depends on the password alone.
  const pre = await pbkdf2(password, new TextEncoder().encode(`cybrix-pepper:${pepper}`), 1)
  const derived = await pbkdf2(b64url(pre), salt, iterations)
  return `$pbkdf2-sha256$i=${iterations},s=${b64url(salt)},p=${PEPPER_VER}$${b64url(derived)}`
}

export async function verifyPassword(password: string, pepper: string, phc: string): Promise<boolean> {
  const m = /^\$pbkdf2-sha256\$i=(\d+),s=([A-Za-z0-9_-]+),p=([A-Za-z0-9]+)\$([A-Za-z0-9_-]+)$/.exec(phc)
  if (!m) return false
  const iterations = Number(m[1] ?? '100000')
  const salt = b64urlDecode(m[2] ?? '')
  const expected = m[4] ?? ''
  const pre = await pbkdf2(password, new TextEncoder().encode(`cybrix-pepper:${pepper}`), 1)
  const derived = await pbkdf2(b64url(pre), salt, iterations)
  return timingSafeEqual(b64url(derived), expected)
}

/** True when the stored hash uses different params than the current policy. */
export function needsRehash(phc: string): boolean {
  const m = /^\$pbkdf2-sha256\$i=(\d+),/.exec(phc)
  return !m || Number(m[1]) !== ITERATIONS
}

/** Dummy verify used for non-existent usernames (timing uniformity, §3.1). */
export async function dummyVerify(pepper: string): Promise<void> {
  const salt = new Uint8Array(16)
  const pre = await pbkdf2('cybrix-dummy', new TextEncoder().encode(`cybrix-pepper:${pepper}`), 1)
  await pbkdf2(b64url(pre), salt, ITERATIONS)
}

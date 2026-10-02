/**
 * AES-256-GCM credential envelope (Prompt 3): DATA_ENCRYPTION_KEY is a
 * base64 (or hex) 32-byte secret bound as a CF Secret — it NEVER appears in
 * API responses, logs, or the D1 plaintext. Format:
 *   "v1:" + base64(12-byte IV) + ":" + base64(ciphertext+tag)
 * credential_key_id identifies the key version for future rotation.
 */

export const CREDENTIAL_KEY_ID = 'k1'

function decodeKey(secret: string): Uint8Array {
  let raw: Uint8Array
  if (/^[0-9a-f]{64}$/i.test(secret)) {
    raw = new Uint8Array(32)
    for (let i = 0; i < 32; i++) raw[i] = parseInt(secret.slice(i * 2, i * 2 + 2), 16)
  } else {
    const b64 = secret.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const bin = atob(padded)
    raw = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  }
  if (raw.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must decode to 32 bytes')
  return raw
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', decodeKey(secret) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptCredential(plaintext: string, dekSecret: string): Promise<string> {
  const key = await importKey(dekSecret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  let ivb = ''
  for (const b of iv) ivb += String.fromCharCode(b)
  const ctb = new Uint8Array(ct)
  let cts = ''
  for (const b of ctb) cts += String.fromCharCode(b)
  return `v1:${btoa(ivb)}:${btoa(cts)}`
}

export async function decryptCredential(envelope: string, dekSecret: string): Promise<string> {
  const parts = envelope.split(':')
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('bad credential envelope')
  const iv = Uint8Array.from(atob(parts[1] ?? ''), (c) => c.charCodeAt(0))
  const ct = Uint8Array.from(atob(parts[2] ?? ''), (c) => c.charCodeAt(0))
  const key = await importKey(dekSecret)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource)
  return new TextDecoder().decode(pt)
}

/* ---------- per-protocol credential generation (Prompt 4 §10.3) ---------- */

export function randomUuidV4(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function randomPassword(len = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]!
  return out
}

export interface CredentialCheck {
  ok: boolean
  normalized?: Record<string, unknown>
  issue?: string
}

/** Validate/normalize an input credential object, or generate one. */
export function normalizeCredential(protocol: string, input: Record<string, unknown> | null | undefined): CredentialCheck {
  if (!input || Object.keys(input).length === 0) {
    switch (protocol) {
      case 'vless':
      case 'vmess':
        return { ok: true, normalized: { uuid: randomUuidV4() } }
      case 'trojan':
        return { ok: true, normalized: { password: randomPassword() } }
      case 'ss':
        return { ok: true, normalized: { password: randomPassword(), method: 'aes-256-gcm' } }
      default:
        return { ok: false, issue: 'unsupported protocol' }
    }
  }
  switch (protocol) {
    case 'vless':
    case 'vmess': {
      const uuid = input['uuid']
      if (typeof uuid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
        return { ok: false, issue: 'credential.uuid must be a UUID' }
      }
      return { ok: true, normalized: { uuid } }
    }
    case 'trojan':
    case 'ss': {
      const password = input['password']
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        return { ok: false, issue: 'credential.password must be 8..128 chars' }
      }
      if (protocol === 'trojan') return { ok: true, normalized: { password } }
      const method = input['method'] ?? 'aes-256-gcm'
      if (method !== 'aes-256-gcm' && method !== 'chacha20-ietf-poly1305') {
        return { ok: false, issue: 'credential.method invalid' }
      }
      return { ok: true, normalized: { password, method } }
    }
    default:
      return { ok: false, issue: 'unsupported protocol' }
  }
}

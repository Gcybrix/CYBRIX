/**
 * Token machinery (Prompt 4 §3.0): prefix + 43-char base64url of 32 random
 * bytes; stored as SHA-256 hex; raw token returned exactly once.
 */

const PREFIXES = { bot: 'cbx_bot_', relay: 'cbx_rl_', subscription: 'cbx_sub_' } as const
export type TokenKind = keyof typeof PREFIXES

export async function generateToken(kind: TokenKind): Promise<{ token: string; hash: string; prefix: string }> {
  const raw = new Uint8Array(32)
  crypto.getRandomValues(raw)
  let bin = ''
  for (const b of raw) bin += String.fromCharCode(b)
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const token = PREFIXES[kind] + b64
  const prefix = token.slice(0, 12)
  return { token, hash: await sha256Hex(token), prefix }
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function looksLikeToken(v: string): boolean {
  return /^cbx_(bot|rl|sub)_[A-Za-z0-9_-]{43}$/.test(v)
}

/**
 * Secret redaction — Prompt 7 §28 / Prompt 6 §18 parity.
 *
 * EVERY log line, error message, health payload and queue artifact passes
 * through here. Patterns cover every credential family CYBRIX has:
 *   relay tokens, api-client tokens, subscription tokens, Telegram bot tokens,
 *   bearer/auth headers, credentials in URLs, long hex (keys/hashes) and
 *   long base64url blobs (tokens, cursors).
 */

const SENSITIVE_KEYS = new Set([
  'token',
  'tokens',
  'relay_token',
  'relaytoken',
  'password',
  'passphrase',
  'secret',
  'secrets',
  'authorization',
  'auth',
  'cookie',
  'set-cookie',
  'credential',
  'credentials',
  'credential_encrypted',
  'telegram_bot_token',
  'bot_token',
  'api_key',
  'apikey',
  'private_key',
  'data_encryption_key',
  'pepper',
])

const PATTERNS: RegExp[] = [
  // Authorization header
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // Telegram bot token shape "1234567890:AA..."
  /\b\d{6,12}:[A-Za-z0-9_-]{25,}\b/g,
  // CYBRIX token families (both OD-8 drafts seen in Prompt 4 samples)
  /\bcbx_(?:rl|apc|sub)_[A-Za-z0-9_-]{4,}/g,
  /\bcyb_(?:rly|apc|sub)_[A-Za-z0-9_-]{4,}/g,
  // credentials in query strings
  /([?&](?:token|secret|password|key|api_key)=)[^&\s"']+/gi,
  // long hex (keys / hashes / digests) — 64+ chars avoids UUID false positives
  /\b[0-9a-f]{64,}\b/gi,
  // long base64url-ish blobs (raw tokens, opaque cursors)
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43,}(?![A-Za-z0-9_-])/g,
]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REDACTED = '[REDACTED]'
const MAX_DEPTH = 6
const MAX_ARRAY = 100

export function redactString(input: string): string {
  let out = input
  for (const p of PATTERNS) {
    out = out.replace(p, (match) => {
      // UUIDs never look like secrets; keep them for traceability
      if (UUID_RE.test(match)) return match
      if (/^([?&](?:token|secret|password|key|api_key)=)/i.test(match)) {
        return match.replace(/=.*$/, '=[REDACTED]')
      }
      return REDACTED
    })
  }
  return out
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase())
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  const t = typeof value
  if (t === 'string') return redactString(value as string)
  if (t === 'number' || t === 'boolean' || t === 'bigint') return value
  if (depth >= MAX_DEPTH) return '[TRUNCATED]'
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((v) => redactValue(v, depth + 1))
  }
  if (t === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(src)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redactValue(v, depth + 1)
    }
    return out
  }
  return '[UNSERIALIZABLE]'
}

export function redactErrorMessage(message: unknown): string {
  return redactString(String(message ?? ''))
}

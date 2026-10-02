/**
 * Redaction rules (Prompt 6 §12/§18 — deliverable 18).
 *
 * Applied at EVERY outbound chokepoint: Telegram messages (user replies AND
 * operator reports) and structured logs. This is defense-in-depth: handlers
 * must already avoid secret values; the scrubber guarantees they never
 * survive formatting accidents.
 *
 * NEVER-SEND LIST (Prompt 6 §12):
 *   TELEGRAM_BOT_TOKEN, CYBRIX_BOT_API_TOKEN, relay tokens, subscription
 *   tokens, admin passwords, credential_encrypted, DATA_ENCRYPTION_KEY,
 *   any Cloudflare Secret.
 */

const SENSITIVE_KEY_RE =
  /(token|password|passwd|secret|credential|authorization|api[_-]?key|private[_-]?key|pepper|encryption[_-]?key|cookie|session)/i

export interface RedactionRule {
  name: string
  pattern: RegExp
  replacement: string
}

export const REDACTION_RULES: RedactionRule[] = [
  // Authorization headers FIRST (before the generic key=value rule eats the scheme)
  {
    name: 'auth-header',
    pattern: /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi,
    replacement: 'Bearer [REDACTED]',
  },
  // Telegram bot token shape: <bot-id>:<35+ chars>
  {
    name: 'telegram-bot-token',
    pattern: /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g,
    replacement: '[REDACTED:BOT_TOKEN]',
  },
  // CYBRIX token prefixes (OD-8 draft prefixes: relay / api-client / subscription)
  {
    name: 'cybrix-token',
    pattern: /\bcyb_(?:rly|apc|sub)_[A-Za-z0-9_-]{8,}\b/g,
    replacement: '[REDACTED:CYBRIX_TOKEN]',
  },
  // key=value / key: value pairs with sensitive keys
  {
    name: 'sensitive-kv',
    pattern: new RegExp(
      `([A-Za-z0-9_.-]*(?:${SENSITIVE_KEY_RE.source})[A-Za-z0-9_.-]*)\\s*[=:]\\s*("[^"\\s]*"|'[^'\\s]*'|[^\\s,;&}"]+)`,
      'gi',
    ),
    replacement: '$1=[REDACTED]',
  },
  // long hex blobs (hashes, keys)
  {
    name: 'hex-secret',
    pattern: /\b[a-f0-9]{32,128}\b/gi,
    replacement: '[REDACTED:HEX]',
  },
  // long base64url blobs (raw tokens without prefix, opaque secrets)
  {
    name: 'base64url-secret',
    pattern: /\b[A-Za-z0-9_-]{43,171}\b/g,
    replacement: '[REDACTED:B64]',
  },
]

/** Redact every rule, repeatedly until stable (nested patterns). */
export function redact(input: string): string {
  let out = input
  for (let pass = 0; pass < 3; pass++) {
    let changed = false
    for (const rule of REDACTION_RULES) {
      const next = out.replace(rule.pattern, rule.replacement)
      if (next !== out) changed = true
      out = next
    }
    if (!changed) break
  }
  return out
}

/** True when the text contains nothing that looks like a secret. */
export function isClean(input: string): boolean {
  return redact(input) === input
}

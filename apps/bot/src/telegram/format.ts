/**
 * Telegram-safe formatting helpers (Prompt 6 §12).
 * Every dynamic value rendered into a message goes through esc().
 * Byte counters (decimal strings per Prompt 4) are humanized WITHOUT
 * losing the exact value — exact string is available via exactBytes().
 */

/** HTML escaping for Telegram parse_mode=HTML */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const

/** "1099511627776" → "1.00 TiB"; null → "Unlimited"; exact value preserved in strings */
export function bytesHuman(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'Unlimited'
  try {
    let n = BigInt(value)
    if (n < 0n) n = 0n
    if (n < 1024n) return `${n} B`
    let u = 0
    let tmp = n
    while (tmp >= 1024n && u < UNITS.length - 1) {
      tmp /= 1024n
      u++
    }
    const scale = 1024n ** BigInt(u)
    const whole = n / scale
    const frac = Number((n % scale) * 100n / scale)
    return `${whole}.${String(frac).padStart(2, '0')} ${UNITS[u]}`
  } catch {
    return '? B'
  }
}

/** percentage used of limit, clamped 0..100; null limit → null */
export function usedPercent(used: string, limit: string | null | undefined): number | null {
  if (!limit) return null
  try {
    const u = BigInt(used)
    const l = BigInt(limit)
    if (l === 0n) return null
    const pct = Number((u * 10000n) / l) / 100
    return Math.max(0, Math.min(100, Math.round(pct * 100) / 100))
  } catch {
    return null
  }
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 'unknown'
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function shortId(id: string | null | undefined): string {
  if (!id) return '—'
  return id.length <= 8 ? id : id.slice(0, 8)
}

export function truncate(text: string, max = 60): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

/** clamp any outgoing message to Telegram's limit (Prompt 6 §17) */
export function clampMessage(text: string, max = 3900): string {
  if (text.length <= max) return text
  return text.slice(0, max - 20) + '\n… <i>truncated</i>'
}

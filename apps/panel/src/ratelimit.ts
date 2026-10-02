/**
 * KV fixed-window rate limiting (Prompt 4 §8). Eventually-consistent by design
 * (documented); 429 always carries Retry-After + X-RateLimit-* headers.
 */
import { RATE_LIMIT_DEFAULTS } from './env'

export interface RateVerdict {
  allowed: boolean
  limit: number
  remaining: number
  reset: number // epoch seconds
  retryAfter: number
}

export async function checkRate(kv: KVNamespace, domain: string, identity: string, now: number): Promise<RateVerdict> {
  const cfg = RATE_LIMIT_DEFAULTS[domain] ?? { limit: 120, window_s: 60 }
  const windowIndex = Math.floor(now / cfg.window_s)
  const reset = (windowIndex + 1) * cfg.window_s
  const key = `rl:${domain}:${identity}:${windowIndex}`
  const current = Number((await kv.get(key)) ?? '0')
  const allowed = current < cfg.limit
  if (allowed) {
    // TTL keeps counters self-cleaning; +2s margin over the window
    await kv.put(key, String(current + 1), { expirationTtl: cfg.window_s + 2 })
  }
  return {
    allowed,
    limit: cfg.limit,
    remaining: Math.max(0, cfg.limit - current - (allowed ? 1 : 0)),
    reset,
    retryAfter: Math.max(1, reset - now),
  }
}

export function rateHeaders(v: Omit<RateVerdict, 'allowed'> & { allowed?: boolean }): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(v.limit),
    'X-RateLimit-Remaining': String(v.remaining),
    'X-RateLimit-Reset': String(v.reset),
    ...(v.allowed ? {} : { 'Retry-After': String(v.retryAfter) }),
  }
}

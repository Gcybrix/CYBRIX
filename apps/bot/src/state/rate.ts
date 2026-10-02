/**
 * Per-user anti-spam throttle (Prompt 6 §14).
 * Best-effort KV counter — mirrors the panel's KV-based rate limiting nature.
 */

import { KV_PREFIX, LIMITS } from '../config'

export async function checkRateLimit(env: { KV: KVNamespace }, userId: number): Promise<boolean> {
  const key = KV_PREFIX.rate + userId
  const current = Number((await env.KV.get(key)) ?? '0')
  if (current >= LIMITS.RATE_LIMIT_PER_MIN) return false
  await env.KV.put(key, String(current + 1), { expirationTtl: 60 })
  return true
}

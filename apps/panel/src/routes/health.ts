/**
 * Health endpoints (§10.17) — public, no auth, CORS *, no internal detail.
 */
import { Hono } from 'hono'
import type { Env } from '../env'
import type { CybEnv } from '../ctx'
import { newRequestId, secureHeaders } from '../http'

export const health = new Hono<CybEnv>()

health.get('/healthz', (c) => {
  const body = {
    status: 'ok',
    service: 'cybrix-panel',
    version: (c.env.PANEL_VERSION as string) ?? 'panel-0.1.0',
    server_time: Math.floor(Date.now() / 1000),
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: secureHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'X-Request-Id': newRequestId(c.req.raw),
    }),
  })
})

health.get('/readyz', async (c) => {
  const checks: Record<string, string> = {}
  let okAll = true
  try {
    await c.env.DB.prepare(`SELECT 1 AS one`).first()
    checks['d1'] = 'ok'
  } catch {
    checks['d1'] = 'fail'
    okAll = false
  }
  try {
    const probeKey = `readyz:${Math.floor(Date.now() / 10000)}`
    await c.env.KV.put(probeKey, '1', { expirationTtl: 60 }) // KV minimum TTL is 60s
    await c.env.KV.get(probeKey)
    checks['kv'] = 'ok'
  } catch {
    checks['kv'] = 'fail'
    okAll = false
  }
  const body = {
    status: okAll ? 'ready' : 'unavailable',
    checks,
    server_time: Math.floor(Date.now() / 1000),
  }
  return new Response(JSON.stringify(body), {
    status: okAll ? 200 : 503,
    headers: secureHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'X-Request-Id': newRequestId(c.req.raw),
    }),
  })
})

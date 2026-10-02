/**
 * CYBRIX Panel Worker — assembly (Prompt 4 §2/§9): one Worker serving
 *   /api/v1/**   REST API (four isolated auth domains)
 *   /healthz     /readyz
 *   /*           Web Admin SPA (static assets, same origin)
 * Cross-cutting: request ids, secure headers, rate limits, error envelope.
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { CybEnv } from './ctx'
import type { Env } from './env'
import { ApiError, errorResponse, internalError, newRequestId } from './http'
import authRoutes from './routes/auth'
import { users, upstreams } from './routes/resources'
import { userConfigs } from './routes/configs'
import { userSubscriptions, subscriptionPublic } from './routes/subscriptions'
import { relays, relaysDataPlane } from './routes/relays'
import { settings, telegramAdmins, apiClients } from './routes/admin'
import { usageQuery, auditLogs, dashboard } from './routes/queries'
import { health } from './routes/health'
import { runTrafficReset } from './cron'

type AppEnv = { Bindings: Env }

const app = new Hono<AppEnv>()

/* ---------- request id + top-level error mapping ---------- */
// NOTE: parent-app try/catch middleware does NOT catch errors thrown inside
// route() mounted sub-apps (Hono compose semantics) — app.onError is the
// reliable top-level handler.
app.onError((err, c) => {
  if (err instanceof ApiError) return errorResponse(c.req.raw, err)
  return internalError(c.req.raw, err)
})
app.use('/api/v1/*', async (c: Context<CybEnv>, next) => {
  c.set('requestId', newRequestId(c.req.raw))
  await next()
})

/* ---------- health (public, CORS *) ---------- */
app.route('/', health)

/* ---------- API v1 ---------- */
const api = new Hono<AppEnv>()

api.route('/', authRoutes) // /setup/status, /setup, /auth/*

// user plane (admin session or bot scope)
api.route('/users', users) // '/', '/:id'
api.route('/users/:userId/subscriptions', userSubscriptions)
api.route('/users/:userId/configs', userConfigs)
api.route('/upstreams', upstreams)

// relay registry (admin plane)
api.route('/relays', relays)

// relay data plane (relay-token domain, self-scoped)
api.route('/relays', relaysDataPlane)

// settings / telegram allowlist (dual-path) / api clients
api.route('/settings', settings)
api.route('/telegram/admins', telegramAdmins)
api.route('/telegram-admins', telegramAdmins) // compat path consumed by cybrix-bot (GAP-B1 alias)
api.route('/api-clients', apiClients)

// queries
api.route('/usage', usageQuery)
api.route('/users', usageQuery) // /users/:id/usage (method+path-distinct from the users plane)
api.route('/configs', usageQuery) // /configs/:config_id/usage
api.route('/relays', usageQuery) // /relays/:id/usage (GET; distinct from POST data-plane)
api.route('/audit-logs', auditLogs)
api.route('/dashboard', dashboard)

// subscription public plane
api.route('/subscription', subscriptionPublic)

app.route('/api/v1', api)

/* ---------- default: serve the SPA ---------- */
app.get('*', async (c) => {
  const url = new URL(c.req.url)
  const assetPath = url.pathname === '/' ? '/index.html' : url.pathname
  const UI_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  const asset = await c.env.ASSETS.fetch(new URL(assetPath, url.origin).toString())
  if (asset.status !== 404) {
    const headers = new Headers(asset.headers)
    headers.set('Content-Security-Policy', UI_CSP)
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('X-Frame-Options', 'DENY')
    headers.set('Referrer-Policy', 'no-referrer')
    if (url.pathname.startsWith('/assets/')) headers.set('Cache-Control', 'public, max-age=3600')
    return new Response(asset.body, { status: asset.status, headers })
  }
  const index = await c.env.ASSETS.fetch(new URL('/index.html', url.origin).toString())
  const ih = new Headers(index.headers)
  ih.set('Content-Security-Policy', UI_CSP)
  ih.set('X-Content-Type-Options', 'nosniff')
  ih.set('X-Frame-Options', 'DENY')
  ih.set('Referrer-Policy', 'no-referrer')
  ih.set('Cache-Control', 'no-store')
  return new Response(index.body, { status: index.status, headers: ih })
})

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runTrafficReset(env, Math.floor(Date.now() / 1000))
        .then((r) => {
          console.log(JSON.stringify({ event: 'traffic_reset_completed', reset: r.reset, scanned: r.scanned }))
        })
        .catch((err) => {
          console.error(JSON.stringify({ event: 'traffic_reset_failed', message: err instanceof Error ? err.message : 'unknown' }))
        }),
    )
  },
} as ExportedHandler<Env>

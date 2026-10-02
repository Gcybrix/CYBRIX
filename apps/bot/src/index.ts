/**
 * cybrix-bot — Cloudflare Worker entry (Prompt 6 §1/§21).
 *
 * Public surface:
 *   GET  /healthz   liveness probe — no sensitive information
 *   POST /webhook   Telegram updates, guarded by secret_token header
 *
 * The webhook validates `X-Telegram-Bot-Api-Secret-Token` in constant time,
 * then returns 200 immediately and processes the update via waitUntil so
 * Telegram never times out on slow panel API calls.
 */

import { Hono } from 'hono'
import { timingSafeEqual } from './telegram/security'
import { handleUpdate } from './handlers/update'
import { describeError, makeLogger } from './log'
import { fireReport } from './reporting/reporter'
import type { Env } from './types'
import type { TgUpdate } from './telegram/types'

const app = new Hono<{ Bindings: Env }>()

app.get('/healthz', (c) => {
  return c.json({ ok: true, service: 'cybrix-bot' })
})

app.post('/webhook', async (c) => {
  const log = makeLogger(c.env)

  // ---- secret_token gate (Prompt 6 §15) — reject before reading body ----
  const provided = c.req.header('X-Telegram-Bot-Api-Secret-Token')
  if (!provided || !timingSafeEqual(provided, c.env.TELEGRAM_WEBHOOK_SECRET)) {
    log.warn('webhook_rejected', { reason: provided ? 'bad_secret' : 'missing_secret' })
    return c.text('Unauthorized', 401)
  }

  // ---- parse ----
  let update: TgUpdate
  try {
    update = (await c.req.json()) as TgUpdate
  } catch {
    return c.text('Bad Request', 400)
  }

  // ---- process async; never block the Telegram handshake ----
  c.executionCtx.waitUntil(
    handleUpdate(update, c.env, c.executionCtx).catch((err) => {
      log.error('webhook_processing_uncaught', describeError(err))
      fireReport(c.env, c.executionCtx, {
        severity: 'ERROR',
        title: 'Webhook Processing Failed',
        component: 'webhook',
        dedupeKey: 'webhook-processing-failed',
        fields: [{ label: 'Action Required', value: 'Inspect worker logs (redacted).' }],
      })
    }),
  )

  return c.json({ ok: true })
})

app.notFound((c) => c.text('Not Found', 404))

app.onError((err, c) => {
  makeLogger(c.env).error('worker_unhandled_error', describeError(err))
  return c.text('Internal Server Error', 500)
})

export default app

/**
 * Webhook security (Prompt 6 §15/§22): valid / invalid / missing secret,
 * plus end-to-end update processing through the Hono worker.
 */

import { describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { callbackUpdate, createHarness, messageUpdate, webhookRequest } from './helpers'
import type { TgUpdate } from '../src/telegram/types'

const SECRET = 'whsec-test-abc123'

/** Drives the worker with global fetch stubbed to the harness mock. */
async function driveWorker(update: TgUpdate | Request, secret?: string) {
  const harness = createHarness()
  vi.stubGlobal('fetch', harness.fetchProxy)
  const req = update instanceof Request ? update : webhookRequest(update, secret)
  const res = await worker.fetch(req, harness.env, harness.ctx)
  await harness.ctx.drain()
  vi.unstubAllGlobals()
  return { res, harness }
}

describe('webhook secret_token gate', () => {
  it('accepts a valid secret, returns 200, processes the update', async () => {
    const { res, harness } = await driveWorker(messageUpdate('/help'), SECRET)
    expect(res.status).toBe(200)
    expect(harness.telegramMessages().some((m) => m.method === 'sendMessage')).toBe(true)
  })

  it('rejects an invalid secret with 401 and never processes the update', async () => {
    const { res, harness } = await driveWorker(messageUpdate('/help'), 'wrong-secret')
    expect(res.status).toBe(401)
    expect(harness.telegramMessages()).toHaveLength(0)
  })

  it('rejects a missing secret with 401', async () => {
    const { res, harness } = await driveWorker(messageUpdate('/help'), undefined)
    expect(res.status).toBe(401)
    expect(harness.telegramMessages()).toHaveLength(0)
  })

  it('returns 400 for a malformed JSON body even with a valid secret', async () => {
    const { res } = await driveWorker(
      new Request('https://bot.example/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
        body: 'not-json',
      }),
    )
    expect(res.status).toBe(400)
  })

  it('healthz exposes no sensitive information', async () => {
    const { res } = await driveWorker(new Request('https://bot.example/healthz'))
    const body = (await res.json()) as Record<string, unknown>
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, service: 'cybrix-bot' })
    expect(JSON.stringify(body)).not.toContain('TESTTOKEN')
  })

  it('unknown routes return 404', async () => {
    const { res } = await driveWorker(new Request('https://bot.example/nope'))
    expect(res.status).toBe(404)
  })

  it('processes callback updates end-to-end (dashboard view)', async () => {
    const { harness } = await driveWorker(callbackUpdate('v:dash'), SECRET)
    const texts = harness.telegramMessages().map((m) => JSON.stringify(m.payload))
    expect(texts.some((t) => t.includes('CYBRIX Status'))).toBe(true)
  })
})

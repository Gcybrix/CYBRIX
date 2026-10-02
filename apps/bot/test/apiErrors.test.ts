/**
 * API error → Telegram UX mapping (Prompt 6 §16/§22).
 * 401 / 403 / 404 / 409 / 422 / 429 / 500 — each mapped to a safe message;
 * raw backend text never reaches the user; 401 raises a CRITICAL report.
 */

import { describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { ADMIN_USER_ID, apiFail, createHarness, envelope, messageUpdate, REPORT_CHAT_ID, webhookRequest } from './helpers'
import type { PanelHandler } from './helpers'

const SECRET = 'whsec-test-abc123'

async function driveWithPanelFailure(status: number, code: string) {
  const handler: PanelHandler = (url) => {
    if (url.includes('/telegram-admins')) {
      return envelope([{ id: 'a-1', telegram_user_id: ADMIN_USER_ID, note: null, created_at: '2026-01-01T00:00:00Z' }])
    }
    if (url.includes('/dashboard/summary')) return apiFail(status, code)
    return undefined
  }
  const harness = createHarness({ panelHandlers: [handler] })
  vi.stubGlobal('fetch', harness.fetchProxy)
  await worker.fetch(webhookRequest(messageUpdate('/status'), SECRET), harness.env, harness.ctx)
  await harness.ctx.drain()
  vi.unstubAllGlobals()
  const userText = harness
    .telegramMessages()
    .filter((m) => m.payload.chat_id === ADMIN_USER_ID)
    .map((m) => String(m.payload.text))
    .join('\n')
  const reportText = harness
    .telegramMessages()
    .filter((m) => m.payload.chat_id === REPORT_CHAT_ID)
    .map((m) => String(m.payload.text))
    .join('\n')
  return { userText, reportText }
}

describe('API error mapping', () => {
  const cases: [number, string, string][] = [
    [401, 'UNAUTHORIZED', 'Panel authentication failed'],
    [403, 'FORBIDDEN', 'not permitted'],
    [404, 'NOT_FOUND', 'Not found'],
    [409, 'CONFLICT', 'Conflict'],
    [422, 'VALIDATION_ERROR', 'Invalid request'],
    [429, 'RATE_LIMITED', 'rate limit'],
    [500, 'INTERNAL_ERROR', 'Upstream error'],
  ]

  for (const [status, code, expected] of cases) {
    it(`maps ${status} ${code} → safe message`, async () => {
      const { userText } = await driveWithPanelFailure(status, code)
      expect(userText).toContain(expected)
      // never leak the raw backend message or internals
      expect(userText).not.toContain('DO-NOT-LEAK')
      expect(userText).not.toContain('panel.example')
    })
  }

  it('401 raises a CRITICAL operator report (token rotate hint)', async () => {
    const { reportText } = await driveWithPanelFailure(401, 'UNAUTHORIZED')
    expect(reportText).toContain('Bot API Authentication Failed')
    expect(reportText).toContain('Rotate CYBRIX_BOT_API_TOKEN')
  })

  it('429 retries the GET once (client-side policy)', async () => {
    const handler: PanelHandler = (url) => {
      if (url.includes('/telegram-admins')) {
        return envelope([{ id: 'a-1', telegram_user_id: ADMIN_USER_ID, note: null, created_at: '2026-01-01T00:00:00Z' }])
      }
      if (url.includes('/dashboard/summary')) {
        return { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'slow down', request_id: 'r' } }, headers: { 'Retry-After': '0' } }
      }
      return undefined
    }
    const harness = createHarness({ panelHandlers: [handler] })
    vi.stubGlobal('fetch', harness.fetchProxy)
    await worker.fetch(webhookRequest(messageUpdate('/status'), SECRET), harness.env, harness.ctx)
    await harness.ctx.drain()
    vi.unstubAllGlobals()
    const summaryCalls = harness.panelCalls().filter((u) => u.includes('/dashboard/summary')).length
    expect(summaryCalls).toBe(2) // 1 initial + 1 retry
  })

  it('network-level failure maps to the fail-closed denial', async () => {
    const harness = createHarness()
    // panel unreachable, Telegram still reachable → observable denial
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('api.telegram.org')) return harness.fetchProxy(input, init)
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch)
    await worker.fetch(webhookRequest(messageUpdate('/status'), SECRET), harness.env, harness.ctx)
    await harness.ctx.drain()
    vi.unstubAllGlobals()
    const text = harness
      .telegramMessages()
      .filter((m) => m.payload.chat_id === ADMIN_USER_ID)
      .map((m) => String(m.payload.text))
      .join('\n')
    // allowlist fetch also fails → fail-closed denial is the observable outcome
    expect(text).toContain('not authorized')
  })
})

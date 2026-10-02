/**
 * Allowlist authorization (Prompt 6 §4/§22):
 *  - authorized telegram user → commands execute
 *  - unauthorized user → generic denial, zero system info
 *  - backend failure → FAIL-CLOSED + CRITICAL report
 */

import { describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import {
  ADMIN_USER_ID,
  STRANGER_USER_ID,
  apiFail,
  createHarness,
  messageUpdate,
  REPORT_CHAT_ID,
  webhookRequest,
} from './helpers'

async function drive(update: ReturnType<typeof messageUpdate>, handlers?: Parameters<typeof createHarness>[0]) {
  const harness = createHarness(handlers)
  vi.stubGlobal('fetch', harness.fetchProxy)
  await worker.fetch(webhookRequest(update, 'whsec-test-abc123'), harness.env, harness.ctx)
  await harness.ctx.drain()
  vi.unstubAllGlobals()
  return harness
}

describe('allowlist authorization', () => {
  it('authorized user can execute commands', async () => {
    const harness = await drive(messageUpdate('/status'))
    const texts = harness.telegramMessages().map((m) => JSON.stringify(m.payload))
    expect(texts.some((t) => t.includes('CYBRIX Status'))).toBe(true)
  })

  it('unauthorized user gets ONLY a generic denial (no system info)', async () => {
    const harness = await drive(messageUpdate('/status', STRANGER_USER_ID))
    const userChats = harness
      .telegramMessages()
      .filter((m) => m.payload.chat_id === STRANGER_USER_ID)
    expect(userChats).toHaveLength(1)
    const text = String(userChats[0].payload.text)
    expect(text).toContain('not authorized')
    // must not leak anything operational
    expect(text).not.toContain('CYBRIX Status')
    expect(text).not.toContain('panel.example')
    expect(text).not.toContain('req-')
    // still reported as a security event to the operator chat
    const reports = harness.telegramMessages().filter((m) => m.payload.chat_id === REPORT_CHAT_ID)
    expect(reports.some((r) => String(r.payload.text).includes('Security Event'))).toBe(true)
  })

  it('unauthorized /start gets the generic denial (limited response)', async () => {
    const harness = await drive(messageUpdate('/start', STRANGER_USER_ID))
    const userChats = harness
      .telegramMessages()
      .filter((m) => m.payload.chat_id === STRANGER_USER_ID)
    expect(String(userChats[0].payload.text)).toContain('not authorized')
  })

  it('allowlist backend failure FAILS CLOSED (403 → denial + CRITICAL report)', async () => {
    const handlers = [(url: string) => (url.includes('/telegram-admins') ? apiFail(403, 'FORBIDDEN') : undefined)]
    const harness = await drive(messageUpdate('/status', ADMIN_USER_ID), { panelHandlers: handlers })
    const userChats = harness.telegramMessages().filter((m) => m.payload.chat_id === ADMIN_USER_ID)
    expect(String(userChats[0].payload.text)).toContain('not authorized')
    const reports = harness.telegramMessages().filter((m) => m.payload.chat_id === REPORT_CHAT_ID)
    expect(reports.some((r) => String(r.payload.text).includes('Authorization Backend Error'))).toBe(true)
  })

  it('allowlist backend failure FAILS CLOSED (network error path)', async () => {
    const handlers = [
      (url: string) => (url.includes('/telegram-admins') ? apiFail(500, 'INTERNAL_ERROR') : undefined),
    ]
    const harness = await drive(messageUpdate('/status', ADMIN_USER_ID), { panelHandlers: handlers })
    const reports = harness.telegramMessages().filter((m) => m.payload.chat_id === REPORT_CHAT_ID)
    expect(reports.some((r) => String(r.payload.text).includes('Authorization Backend Error'))).toBe(true)
  })

  it('caches the allowlist (second command = zero extra panel calls)', async () => {
    const harness = createHarness()
    vi.stubGlobal('fetch', harness.fetchProxy)
    const res1 = await worker.fetch(webhookRequest(messageUpdate('/help'), 'whsec-test-abc123'), harness.env, harness.ctx)
    await harness.ctx.drain() // ensure the first command finished before the second
    const res2 = await worker.fetch(webhookRequest(messageUpdate('/help'), 'whsec-test-abc123'), harness.env, harness.ctx)
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    await harness.ctx.drain()
    vi.unstubAllGlobals()
    const adminFetches = harness.panelCalls().filter((u) => u.includes('/telegram-admins')).length
    expect(adminFetches).toBe(1)
  })
})

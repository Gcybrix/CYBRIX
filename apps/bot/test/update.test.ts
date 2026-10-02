/**
 * Update-router behaviors: duplicate suppression, anti-spam throttle,
 * session store TTL contract (Prompt 6 §7/§14).
 */

import { describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import {
  ADMIN_USER_ID,
  createHarness,
  messageUpdate,
  webhookRequest,
  KVMock,
} from './helpers'
import { KV_PREFIX, LIMITS } from '../src/config'
import { getSession, setSession } from '../src/state/session'

const SECRET = 'whsec-test-abc123'

async function driveUpdate(update: ReturnType<typeof messageUpdate>, kv?: KVMock) {
  const harness = createHarness()
  if (kv) harness.env.KV = kv as unknown as KVNamespace
  vi.stubGlobal('fetch', harness.fetchProxy)
  await worker.fetch(webhookRequest(update, SECRET), harness.env, harness.ctx)
  await harness.ctx.drain()
  vi.unstubAllGlobals()
  return harness
}

describe('update router', () => {
  it('suppresses duplicate update_id deliveries (Telegram retries)', async () => {
    const harness = createHarness()
    vi.stubGlobal('fetch', harness.fetchProxy)
    const update = messageUpdate('/help', ADMIN_USER_ID, ADMIN_USER_ID)
    update.update_id = 424242
    await worker.fetch(webhookRequest(update, SECRET), harness.env, harness.ctx)
    await harness.ctx.drain()
    const afterFirst = harness.telegramMessages().length
    // replay the exact same update (fresh Request, identical update_id)
    await worker.fetch(webhookRequest(update, SECRET), harness.env, harness.ctx)
    await harness.ctx.drain()
    vi.unstubAllGlobals()
    expect(harness.telegramMessages().length).toBe(afterFirst)
  })

  it('throttles users exceeding the per-minute command budget', async () => {
    const kv = new KVMock({ [KV_PREFIX.rate + ADMIN_USER_ID]: String(LIMITS.RATE_LIMIT_PER_MIN) })
    const harness = await driveUpdate(messageUpdate('/status'), kv)
    const text = harness
      .telegramMessages()
      .filter((m) => m.payload.chat_id === ADMIN_USER_ID)
      .map((m) => String(m.payload.text))
      .join('\n')
    expect(text).toContain('Slow down')
  })
})

describe('conversation state (KV, TTL)', () => {
  it('stores and returns session data under telegram:session:{user_id}', async () => {
    const kv = new KVMock()
    const env = { KV: kv } as unknown as Parameters<typeof setSession>[0]
    await setSession(env, ADMIN_USER_ID, 'users', 'cur-1')
    const key = KV_PREFIX.session + ADMIN_USER_ID
    expect(kv.store.has(key)).toBe(true)
    const raw = JSON.parse(kv.store.get(key)!.value)
    expect(raw.view).toBe('users')
    expect(raw.cursor).toBe('cur-1')
    const session = await getSession(env, ADMIN_USER_ID)
    expect(session?.view).toBe('users')
  })

  it('writes sessions with an expirationTtl', async () => {
    const kv = new KVMock()
    const env = { KV: kv } as unknown as Parameters<typeof setSession>[0]
    await setSession(env, 7, 'dash')
    // KVMock records expiresAt — assert it was set (TTL contract)
    const entry = kv.store.get(KV_PREFIX.session + 7)!
    expect(entry.expiresAt).toBeDefined()
    expect(entry.expiresAt!).toBeGreaterThan(Date.now())
  })

  it('never stores secret-shaped content in sessions', async () => {
    const kv = new KVMock()
    const env = { KV: kv } as unknown as Parameters<typeof setSession>[0]
    await setSession(env, 8, 'cfg', 'opaque-cursor')
    const stored = kv.store.get(KV_PREFIX.session + 8)!.value
    expect(stored).not.toMatch(/token|password|secret|cyb_/i)
  })
})

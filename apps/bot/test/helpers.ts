/**
 * Test harness — mock KV, mock fetch (panel + Telegram), sample updates.
 * No Workers runtime required; everything runs in plain Node via Vitest.
 */

import type { Env } from '../src/types'
import type { TgUpdate } from '../src/telegram/types'

/* ---------------- KV mock ---------------- */

export class KVMock {
  store = new Map<string, { value: string; expiresAt?: number }>()
  constructor(initial?: Record<string, string>) {
    if (initial) for (const [k, v] of Object.entries(initial)) this.store.set(k, { value: v })
  }
  async get(key: string, type?: string | unknown): Promise<unknown> {
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return null
    }
    if (type === 'json') {
      try {
        return JSON.parse(entry.value)
      } catch {
        return null
      }
    }
    return entry.value
  }
  async put(
    key: string,
    value: string,
    opts?: { expirationTtl?: number },
  ): Promise<void> {
    this.store.set(key, {
      value: typeof value === 'string' ? value : JSON.stringify(value),
      expiresAt: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined,
    })
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
}

/* ---------------- fetch mock ---------------- */

export interface FetchCall {
  url: string
  init?: RequestInit
}

export interface MockResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
}

export type PanelHandler = (url: string, init: RequestInit) => MockResponse | undefined

export interface Harness {
  env: Env
  fetchProxy: typeof fetch
  ctx: {
    promises: Promise<unknown>[]
    props: Record<string, unknown>
    waitUntil(p: Promise<unknown>): void
    passThroughOnException(): void
    drain(): Promise<void>
  }
  calls: FetchCall[]
  telegramMessages(): { method: string; payload: Record<string, unknown> }[]
  panelCalls(): string[]
}

export const ADMIN_USER_ID = 1001
export const STRANGER_USER_ID = 9999
export const REPORT_CHAT_ID = 555000111

export const envelope = (data: unknown, meta: Record<string, unknown> = {}): MockResponse => ({
  status: 200,
  body: {
    data,
    meta: { request_id: 'req-1', pagination: { next_cursor: null, has_more: false, limit: 5 }, ...meta },
  },
})

export const apiFail = (status: number, code: string): MockResponse => ({
  status,
  body: { error: { code, message: 'backend raw message DO-NOT-LEAK', request_id: 'req-err' } },
})

export function samplePanelData() {
  return {
    telegramAdmins: [
      { id: 'a-1', telegram_user_id: ADMIN_USER_ID, note: 'owner', created_at: '2026-01-01T00:00:00Z' },
    ],
    dashboard: {
      counts: {
        users: { total: 12, active: 10, disabled: 2 },
        configs: { total: 30, enabled: 28 },
        upstreams: { total: 3, enabled: 3 },
        relays: { total: 2, online: 1, offline: 1 },
        subscriptions: { total: 15, active: 12 },
      },
      traffic: { today: '1073741824', last_7d: '10737418240', last_30d: '53687091200' },
      relays_health: [
        { id: 'r-1', name: 'fra-01', status: 'online', last_seen_at: new Date().toISOString() },
        { id: 'r-2', name: 'sgp-01', status: 'offline', last_seen_at: '2026-09-20T00:00:00Z' },
      ],
      recent_audit: [],
    },
    users: [
      {
        id: 'u-1',
        username: 'alice',
        note: null,
        enabled: true,
        traffic_limit_bytes: '1099511627776',
        traffic_used_bytes: '536870912',
        traffic_reset_day: 1,
        traffic_last_reset_at: '2026-09-01T00:00:00Z',
        expiry_at: '2027-01-01T00:00:00Z',
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
      },
    ],
    relays: [
      {
        id: 'r-1',
        name: 'fra-01',
        enabled: true,
        status: 'online',
        last_seen_at: new Date().toISOString(),
        agent_version: '1.0.0',
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
      },
    ],
    configs: [
      {
        id: 'c-1',
        user_id: 'u-1',
        name: 'alice-main',
        upstream_id: null,
        relay_id: 'r-1',
        enabled: true,
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
      },
    ],
    subscriptions: [
      { id: 's-1', user_id: 'u-1', name: 'main', enabled: true, created_at: '2026-06-01T00:00:00Z' },
    ],
    audit: [
      {
        id: '1',
        created_at: '2026-09-24T08:00:00Z',
        actor_type: 'admin',
        actor_id: 'owner',
        action: 'user.created',
        resource_type: 'user',
        resource_id: 'u-1',
      },
    ],
    settings: {
      editable: { traffic_reset_default_day: 1 },
      read_only: { deployment: 'self-hosted' },
      internal_only: [{ key: 'DATA_ENCRYPTION_KEY' }, { key: 'PEPPER' }],
    },
  }
}

export function defaultPanelHandlers(data = samplePanelData()): PanelHandler[] {
  return [
    (url) => {
      if (url.includes('/telegram-admins')) return envelope(data.telegramAdmins)
      return undefined
    },
    (url) => {
      if (url.includes('/dashboard/summary')) return envelope(data.dashboard)
      return undefined
    },
    (url) => {
      if (url.includes('/audit-logs')) return envelope(data.audit)
      return undefined
    },
    (url) => {
      if (url.includes('/settings')) return envelope(data.settings)
      return undefined
    },
    (url) => {
      if (url.includes('/configs')) return envelope(data.configs)
      return undefined
    },
    (url) => {
      if (url.includes('/subscriptions')) return envelope(data.subscriptions)
      return undefined
    },
    (url) => {
      if (url.includes('/relays')) return envelope(data.relays)
      return undefined
    },
    (url) => {
      if (url.includes('/users')) return envelope(data.users)
      return undefined
    },
  ]
}

export function createHarness(opts?: {
  env?: Partial<Env>
  panelHandlers?: PanelHandler[]
  telegramStatus?: number
}): Harness {
  const calls: FetchCall[] = []
  const handlers = opts?.panelHandlers ?? defaultPanelHandlers()
  const telegramStatus = opts?.telegramStatus ?? 200

  const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    calls.push({ url, init })
    if (url.includes('api.telegram.org')) {
      return new Response(JSON.stringify({ ok: telegramStatus === 200 }), {
        status: telegramStatus,
        headers: { 'content-type': 'application/json' },
      })
    }
    for (const handler of handlers) {
      const res = handler(url, init ?? {})
      if (res) {
        return new Response(JSON.stringify(res.body), {
          status: res.status,
          headers: { 'content-type': 'application/json', ...(res.headers ?? {}) },
        })
      }
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no handler' } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch

  const promises: Promise<unknown>[] = []
  const ctx = {
    promises,
    props: {} as Record<string, unknown>,
    waitUntil(p: Promise<unknown>): void {
      promises.push(p)
    },
    passThroughOnException(): void {},
    async drain(): Promise<void> {
      await Promise.allSettled(promises)
    },
  }

  const env: Env = {
    KV: new KVMock() as unknown as KVNamespace,
    TELEGRAM_BOT_TOKEN: '111222333:TESTTOKEN_testtoken_TESTTOKEN',
    TELEGRAM_WEBHOOK_SECRET: 'whsec-test-abc123',
    CYBRIX_BOT_API_TOKEN: 'test-panel-bot-token',
    CYBRIX_API_BASE_URL: 'https://panel.example/api/v1',
    TELEGRAM_REPORT_CHAT_ID: String(REPORT_CHAT_ID),
    LOG_LEVEL: 'error',
    ...opts?.env,
  }

  return {
    env,
    fetchProxy: fetchMock,
    ctx,
    calls,
    telegramMessages(): { method: string; payload: Record<string, unknown> }[] {
      return calls
        .filter((c) => c.url.includes('api.telegram.org'))
        .map((c) => {
          const method = c.url.split('/').pop() ?? ''
          let payload: Record<string, unknown> = {}
          try {
            payload = JSON.parse(String(c.init?.body ?? '{}'))
          } catch {
            /* ignore */
          }
          return { method, payload }
        })
    },
    panelCalls(): string[] {
      return calls.filter((c) => !c.url.includes('api.telegram.org')).map((c) => c.url)
    },
  }
}

/* ---------------- updates ---------------- */

let updateSeq = 1

export function messageUpdate(text: string, userId = ADMIN_USER_ID, chatId = userId): TgUpdate {
  return {
    update_id: updateSeq++,
    message: {
      message_id: updateSeq,
      from: { id: userId, username: 'tester' },
      chat: { id: chatId, type: 'private' },
      text,
    },
  }
}

export function callbackUpdate(data: string, userId = ADMIN_USER_ID): TgUpdate {
  return {
    update_id: updateSeq++,
    callback_query: {
      id: `cb-${updateSeq}`,
      from: { id: userId, username: 'tester' },
      message: { message_id: 77, chat: { id: userId, type: 'private' } },
      data,
    },
  }
}

export function webhookRequest(update: TgUpdate, secret?: string): Request {
  return new Request('https://bot.example/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret !== undefined ? { 'x-telegram-bot-api-secret-token': secret } : {}),
    },
    body: JSON.stringify(update),
  })
}

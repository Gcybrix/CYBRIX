import { describe, expect, it, vi } from 'vitest'
import { IntervalTrigger } from '../../src/core/scheduler'
import { RelayApiClient, RelayApiError } from '../../src/api/client'
import { waitFor } from '../helpers'

describe('IntervalTrigger (loops, Prompt 7 §14)', () => {
  it('runs immediately on start(true) and resets failures on success', async () => {
    const fn = vi.fn(async () => {})
    const t = new IntervalTrigger('t', fn, { intervalMs: 50 })
    t.start(true)
    await waitFor(() => fn.mock.calls.length >= 1)
    t.stop()
    expect(fn).toHaveBeenCalled()
  })

  it('backs off exponentially on failure and resets on success', async () => {
    let fail = true
    let runs = 0
    const t = new IntervalTrigger(
      't',
      async () => {
        runs++
        if (fail) throw new Error('boom')
      },
      { intervalMs: 10, backoffMultiplier: 2, maxBackoffMs: 50 },
    )
    t.start(true)
    await waitFor(() => runs >= 3, 2000) // failure chain
    fail = false
    const before = runs
    await waitFor(() => runs > before, 2000)
    t.stop()
    expect(runs).toBeGreaterThan(before)
  })

  it('updateInterval adopts server-suggested intervals', () => {
    const t = new IntervalTrigger('t', async () => {}, { intervalMs: 60_000 })
    t.updateInterval(30_000)
    t.stop()
  })

  it('triggerNow coalesces while a tick is running, fires when idle', async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>((r) => (release = r))
    let runs = 0
    const t = new IntervalTrigger('t', async () => {
      runs++
      if (runs === 1) await gate
    }, { intervalMs: 10_000 })
    t.start(true)
    await waitFor(() => runs === 1)
    t.triggerNow() // must be IGNORED while the first tick is in flight
    release?.()
    await new Promise((r) => setTimeout(r, 60))
    expect(runs).toBe(1) // coalesced, not queued twice
    t.triggerNow() // idle now → fires promptly
    await waitFor(() => runs >= 2, 2000)
    t.stop()
  })
})

describe('RelayApiClient retry matrix (Prompt 7 §18)', () => {
  const optsBase = {
    apiUrl: 'https://panel.example',
    tokenProvider: () => 'tok',
    timeoutMs: 5_000,
    maxAttempts: 3,
    baseMs: 1,
    maxBackoffMs: 10,
  }

  function clientWith(statuses: number[], bodies: unknown[] = []): { client: RelayApiClient; attempts: number[] } {
    const attempts: number[] = []
    const client = new RelayApiClient({
      ...optsBase,
      fetchImpl: (async (_input, init) => {
        attempts.push(init?.method === 'POST' ? 2 : 1)
        const status = statuses[Math.min(attempts.length - 1, statuses.length - 1)] ?? 500
        return new Response(JSON.stringify(bodies[attempts.length - 1] ?? {}), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      }) as typeof fetch,
      sleepImpl: async () => {},
    })
    return { client, attempts }
  }

  it('retries 5xx up to max attempts, then throws a retryable error', async () => {
    const { client, attempts } = clientWith([503, 503, 503])
    await expect(client.request('GET', '/x')).rejects.toMatchObject({ kind: 'server' })
    expect(attempts).toHaveLength(3)
  })

  it('retries 429 and respects Retry-After when present', async () => {
    const attempts: number[] = []
    const waits: number[] = []
    const client = new RelayApiClient({
      ...optsBase,
      fetchImpl: (async () => {
        attempts.push(1)
        return new Response('{}', {
          status: attempts.length === 1 ? 429 : 200,
          headers: { 'Retry-After': '7', 'Content-Type': 'application/json' },
        })
      }) as typeof fetch,
      sleepImpl: async (ms) => void waits.push(ms),
    })
    await client.request('GET', '/x')
    expect(attempts).toHaveLength(2)
    expect(waits[0]).toBe(7000)
  })

  it('NEVER retries 401/403/404/409/410/422', async () => {
    for (const status of [401, 403, 404, 409, 410, 422]) {
      const { client, attempts } = clientWith([status])
      await expect(client.request('GET', '/x')).rejects.toBeInstanceOf(RelayApiError)
      expect(attempts).toHaveLength(1)
    }
  })

  it('classifies timeouts as retryable network errors', async () => {
    const client = new RelayApiClient({
      ...optsBase,
      fetchImpl: (async () => {
        const e = new Error('aborted due to timeout')
        e.name = 'TimeoutError'
        throw e
      }) as typeof fetch,
      sleepImpl: async () => {},
    })
    await expect(client.request('GET', '/x')).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('unwraps the {data} envelope and never logs the token', async () => {
    const client = new RelayApiClient({
      ...optsBase,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ data: { hello: 'world' }, meta: { request_id: 'r1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch,
    })
    await expect(client.request('GET', '/x')).resolves.toEqual({ hello: 'world' })
  })

  it('keeps error messages free of secrets', async () => {
    const client = new RelayApiClient({
      ...optsBase,
      tokenProvider: () => 'supersecretvalue42',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'bad token supplied' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch,
    })
    try {
      await client.request('GET', '/x')
    } catch (err) {
      expect((err as Error).message).not.toContain('supersecretvalue42')
    }
  })
})

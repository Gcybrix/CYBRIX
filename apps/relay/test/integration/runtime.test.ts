/**
 * RelayRuntime integration tests — Prompt 7 §33 (Sync/Heartbeat/Usage/Reliability)
 * using a scripted fetch (no real network). Real-HTTP end-to-end lives in
 * integration/http.test.ts.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RelayRuntime } from '../../src/runtime'

import {
  CONFIG2_ID,
  CONFIG_ID,
  OTHER_RELAY_ID,
  RELAY_ID,
  USER2_ID,
  USER_ID,
  configFixture,
  createScriptedFetch,
  fakeToken,
  quietLogger,
  syncEnvelope,
  testConfig,
  userFixture,
  waitFor,
  writeTokenFile,
  type ScriptStep,
} from '../helpers'

let cleanupFns: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanupFns) fn()
  cleanupFns = []
})

function boot(
  script: ScriptStep[] | ((call: { url: string; method: string; body: unknown }) => ScriptStep),
  envOverrides: Record<string, string> = {},
) {
  const { config, dataDir, cleanup } = testConfig(envOverrides)
  cleanupFns.push(cleanup)
  const sf = createScriptedFetch(script as never)
  const runtime = new RelayRuntime({
    config,
    log: quietLogger(),
    fetchImpl: sf.fetchImpl,
    sleepImpl: async () => {},
  })
  return { runtime, sf, dataDir, config }
}

const fullSyncStep = (): ScriptStep => ({
  status: 200,
  body: syncEnvelope({
    relays: [{ id: RELAY_ID, name: 'relay-fra-1', status: 'active', version: 1, updated_at: 1, deleted_at: null }],
    configs: [configFixture()],
    users: [userFixture()],
  }),
})

const heartbeatStep = (shouldSync = false): ScriptStep => ({
  status: 200,
  body: {
    server_time: 1758700900,
    heartbeat_interval_seconds: 60,
    should_sync: shouldSync,
    relay: { id: RELAY_ID, status: 'active', health: 'online' },
  },
})

const usageAck = (): ScriptStep => ({
  status: 200,
  // 'ECHO_REQUEST_REPORT_ID' is substituted by the scripted fetch with the
  // request's report_id — mirroring Prompt 4 §10.9 (server echoes the key)
  body: {
    status: 'accepted',
    report_id: 'ECHO_REQUEST_REPORT_ID',
    ingested_at: 1758700901,
    entries_accepted: 1,
  },
})

describe('Prompt 7 §33 — Sync', () => {
  it('performs the initial FULL sync without a cursor and applies assignments', async () => {
    const { runtime, sf } = boot([fullSyncStep()])
    await runtime.start(false)

    expect(sf.calls).toHaveLength(1)
    expect(sf.calls[0]!.url).toContain(`/api/v1/relays/${RELAY_ID}/sync`)
    expect(sf.calls[0]!.url).not.toContain('since=')
    expect(sf.calls[0]!.headers['authorization']).toBe(`Bearer ${fakeToken()}`)
    expect(runtime.managerRef().configCount()).toBe(1)
    expect(runtime.state).toBe('running')
    expect(runtime.localState().last_sync_cursor).toBe('CUR-1')
    await runtime.shutdown('test')
  })

  it('follows the server cursor for INCREMENTAL sync (no full re-pull)', async () => {
    const { runtime, sf } = boot([
      fullSyncStep(),
      // delta: version update + second config
      {
        status: 200,
        body: syncEnvelope({
          configs: [configFixture({ version: 2, updated_at: 2 }), configFixture({ id: CONFIG2_ID, user_id: USER2_ID })],
          users: [userFixture({ version: 2, updated_at: 2 }), userFixture({ id: USER2_ID })],
        }, { cursors: { next_cursor: 'CUR-2', has_more: { configs: false, users: false, upstreams: false, relays: false }, }, server_time: 2 } as never),
      },
    ])
    await runtime.start(false)
    await runtime.runLoopOnce('sync')

    const second = sf.calls[1]!
    expect(second.url).toContain('since=CUR-1')
    expect(runtime.managerRef().configCount()).toBe(2)
    expect(runtime.localState().last_sync_cursor).toBe('CUR-2')
    await runtime.shutdown('test')
  })

  it('applies TOMBSTONES (unassign stubs) from deltas', async () => {
    const { runtime, sf } = boot([
      fullSyncStep(),
      { status: 200, body: syncEnvelope({ configs: [{ id: CONFIG_ID, version: 3, updated_at: 3, op: 'unassigned' }] }) },
    ])
    await runtime.start(false)
    expect(runtime.managerRef().configCount()).toBe(1)
    await runtime.runLoopOnce('sync')
    expect(runtime.managerRef().configCount()).toBe(0)
    expect(sf.calls).toHaveLength(2)
    await runtime.shutdown('test')
  })

  it('performs a SAFE RESYNC when the cursor is rejected (400 CURSOR_INVALID)', async () => {
    const { runtime, sf } = boot([
      fullSyncStep(),
      { status: 400, body: { error: { code: 'CURSOR_INVALID', message: 'bad cursor' } } },
      fullSyncStep(),
    ])
    await runtime.start(false)
    await runtime.runLoopOnce('sync')

    expect(sf.calls).toHaveLength(3)
    expect(sf.calls[1]!.url).toContain('since=CUR-1')
    expect(sf.calls[2]!.url).not.toContain('since=')
    expect(runtime.state).toBe('running')
    await runtime.shutdown('test')
  })

  it('REFUSES assignments for another relay (isolation, Prompt 7 §26)', async () => {
    const { runtime } = boot([
      {
        status: 200,
        body: syncEnvelope({
          relays: [{ id: RELAY_ID, name: 'r', status: 'active', version: 1, updated_at: 1, deleted_at: null }],
          configs: [configFixture({ id: CONFIG2_ID, relay_id: OTHER_RELAY_ID, user_id: USER2_ID })],
        }),
      },
    ])
    await runtime.start(false)
    expect(runtime.managerRef().configCount()).toBe(0)
    expect(runtime.recentEvents().some((e) => e.code === 'isolation.cross_relay_rejected')).toBe(true)
    await runtime.shutdown('test')
  })

  it('treats a foreign relay identity in the sync response as fatal misconfig', async () => {
    const { runtime } = boot([
      {
        status: 200,
        body: syncEnvelope({
          relays: [{ id: OTHER_RELAY_ID, name: 'other', status: 'active', version: 1, updated_at: 1, deleted_at: null }],
        }),
      },
    ])
    await runtime.start(false)
    expect(runtime.state).not.toBe('running')
    expect(runtime.managerRef().configCount()).toBe(0)
    await runtime.shutdown('test')
  })
})

describe('Prompt 7 §33 — Heartbeat', () => {
  it('sends minimal fields + bounded metadata, never secrets', async () => {
    const { runtime, sf } = boot([fullSyncStep(), heartbeatStep()])
    await runtime.start(false)
    await runtime.runLoopOnce('heartbeat')

    const hb = sf.calls[1]!
    expect(hb.url).toContain('/heartbeat')
    const body = hb.body as Record<string, unknown>
    expect(body['ts']).toBeTypeOf('number')
    expect(body['status']).toBe('online')
    expect(body['agent_version']).toBeTypeOf('string')
    expect(body['uptime_seconds']).toBeTypeOf('number')
    expect(body['active_configs']).toBe(1)
    expect(body['sync_cursor']).toBe('CUR-1')
    // Prompt 4 §10.8: unknown fields are rejected → payload stays minimal
    expect(Object.keys(body).sort()).toEqual(
      ['active_configs', 'agent_version', 'metadata', 'status', 'sync_cursor', 'ts', 'uptime_seconds'].sort(),
    )
    const meta = body['metadata'] as Record<string, unknown>
    expect(Object.keys(meta).length).toBeLessThanOrEqual(16)
    expect(JSON.stringify(meta).length).toBeLessThanOrEqual(2048)
    expect(JSON.stringify(hb.body)).not.toContain('cbx_rl_')
    await runtime.shutdown('test')
  })

  it('triggers a catch-up sync when the server says should_sync', async () => {
    const { runtime, sf } = boot([fullSyncStep(), heartbeatStep(true), fullSyncStep()])
    await runtime.start(false)
    await runtime.runLoopOnce('heartbeat')
    await waitFor(() => sf.calls.length >= 3, 3000)
    expect(sf.calls[2]!.url).toContain('/sync')
    await runtime.shutdown('test')
  })

  it('degrades after repeated heartbeat failures and reports the error code', async () => {
    const { runtime } = boot([
      fullSyncStep(),
      { status: 503, body: { error: { code: 'INTERNAL_ERROR', message: 'down' } } },
      { status: 503, body: { error: { code: 'INTERNAL_ERROR', message: 'down' } } },
      { status: 503, body: { error: { code: 'INTERNAL_ERROR', message: 'down' } } },
    ])
    await runtime.start(false)
    expect(runtime.state).toBe('running')
    for (let i = 0; i < 3; i++) await runtime.runLoopOnce('heartbeat')
    expect(runtime.failureCounters().heartbeat).toBeGreaterThanOrEqual(3)
    expect(runtime.computeHeartbeatStatus()).toBe('degraded')
    expect(runtime.lastError?.code).toBe('INTERNAL_ERROR')
    await runtime.shutdown('test')
  })
})

describe('Prompt 7 §33 — Usage', () => {
  it('collects → enqueues → POSTs → removes ONLY after ACK', async () => {
    const { runtime, sf } = boot([fullSyncStep(), usageAck()])
    await runtime.start(false)
    runtime.collectorRef().add(CONFIG_ID, 1048576n, 15728640n)

    const before = runtime.queueRef().metrics().depth
    expect(before).toBe(0) // not enqueued until the flush window drains it
    await runtime.runLoopOnce('usage')

    const usageCall = sf.calls[1]!
    expect(usageCall.url).toContain(`/api/v1/relays/${RELAY_ID}/usage`)
    const body = usageCall.body as { report_id: string; entries: Array<Record<string, unknown>> }
    expect(body.report_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0]!.bytes_up).toBe('1048576') // DECIMAL STRING (Prompt 4)
    expect(body.entries[0]!.bytes_down).toBe('15728640')
    expect(body.entries[0]!.user_id).toBe(USER_ID)
    expect(runtime.queueRef().metrics().depth).toBe(0) // ACK → removed
    expect(runtime.localState().last_usage_ack_at).not.toBeNull()
    await runtime.shutdown('test')
  })

  it('keeps the report and retries after network/5xx failure (offline buffer)', async () => {
    let apiDown = true
    const { runtime, sf } = boot((call) => {
      if (call.url.includes('/usage')) return apiDown ? { throwNetwork: true } : usageAck()
      if (call.url.includes('/sync')) return fullSyncStep()
      return heartbeatStep()
    })
    await runtime.start(false)
    runtime.collectorRef().add(CONFIG_ID, 10n, 20n)
    await runtime.runLoopOnce('usage')
    expect(runtime.queueRef().metrics().depth).toBe(1) // buffered, NOT removed
    expect(runtime.state).toBe('degraded')

    // API is back → next flush delivers the SAME report (persist-before-send)
    apiDown = false
    await runtime.runLoopOnce('usage')
    expect(runtime.queueRef().metrics().depth).toBe(0)
    expect(sf.attempts()).toBeGreaterThanOrEqual(4) // retries happened, then ACK
    await runtime.shutdown('test')
  })

  it('handles duplicate delivery as already_processed (idempotent, §15)', async () => {
    const { runtime, sf } = boot([
      fullSyncStep(),
      { status: 200, body: { status: 'already_processed', report_id: 'ECHO_REQUEST_REPORT_ID', ingested_at: 1 } },
    ])
    await runtime.start(false)
    runtime.collectorRef().add(CONFIG_ID, 1n, 1n)
    await runtime.runLoopOnce('usage')
    expect(runtime.queueRef().metrics().depth).toBe(0) // duplicate ACK → removed
    expect(runtime.lastError).toBeNull()
    await runtime.shutdown('test')
  })

  it('handles 422 all-or-nothing rejection: dead-letter + requeue valid entries under a NEW report_id', async () => {
    const { runtime, sf, dataDir } = boot([
      fullSyncStep(),
      {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'invalid entries',
            details: [{ config_id: CONFIG_ID }],
          },
        },
      },
      usageAck(),
    ])
    await runtime.start(false)
    runtime.collectorRef().add(CONFIG_ID, 1n, 1n)
    runtime.collectorRef().add(CONFIG2_ID, 2n, 2n)
    runtime.managerRef().applyDelta(
      syncEnvelope({ configs: [configFixture({ id: CONFIG2_ID, user_id: USER2_ID })], users: [userFixture({ id: USER2_ID })] }).data,
    )

    await runtime.runLoopOnce('usage') // → 422 → drop CONFIG_ID entry, requeue CONFIG2_ID
    expect(existsSync(join(dataDir, 'usage-dead.json'))).toBe(true)
    expect(sf.calls).toHaveLength(3)
    const second = sf.calls[2]!.body as { report_id: string; entries: Array<Record<string, unknown>> }
    expect(second.entries).toHaveLength(1)
    expect(second.entries[0]!.config_id).toBe(CONFIG2_ID)
    expect(runtime.queueRef().metrics().depth).toBe(0)
    await runtime.shutdown('test')
  })

  it('recovers deterministically from 409 IDEMPOTENCY_CONFLICT (fresh report_id)', async () => {
    const { runtime, sf } = boot([
      fullSyncStep(),
      { status: 409, body: { error: { code: 'IDEMPOTENCY_CONFLICT', message: 'payload hash mismatch' } } },
      usageAck(),
    ])
    await runtime.start(false)
    runtime.collectorRef().add(CONFIG_ID, 1n, 1n)
    await runtime.runLoopOnce('usage')

    const first = sf.calls[1]!.body as { report_id: string }
    const second = sf.calls[2]!.body as { report_id: string }
    expect(second.report_id).not.toBe(first.report_id)
    expect(runtime.queueRef().metrics().depth).toBe(0)
    await runtime.shutdown('test')
  })

  it('enforces the queue cap deterministically (drop-oldest + CRITICAL event)', async () => {
    const { runtime } = boot([fullSyncStep(), { throwNetwork: true }], {
      QUEUE_MAX_REPORTS: '1',
    })
    await runtime.start(false)
    // seed the second config mapping so its usage entry is attributable
    runtime.managerRef().applyDelta(
      syncEnvelope({ configs: [configFixture({ id: CONFIG2_ID, user_id: USER2_ID })], users: [userFixture({ id: USER2_ID })] }).data,
    )
    runtime.collectorRef().add(CONFIG_ID, 1n, 1n)
    await runtime.runLoopOnce('usage') // fills queue, delivery fails → stays
    expect(runtime.queueRef().metrics().depth).toBe(1)

    runtime.collectorRef().add(CONFIG2_ID, 1n, 1n)
    await runtime.runLoopOnce('usage') // second report → drop-oldest
    expect(runtime.queueRef().metrics().depth).toBe(1)
    expect(runtime.recentEvents().some((e) => e.code === 'queue.dropped')).toBe(true)
    await runtime.shutdown('test')
  })
})

describe('Prompt 7 §30/§33 — Authentication', () => {
  it('401 → AUTH_FAILED, NO retry storm, signals reportable', async () => {
    const { runtime, sf } = boot([
      { status: 401, body: { error: { code: 'TOKEN_REVOKED', message: 'revoked' } } },
    ])
    await runtime.start(false)
    expect(runtime.state).toBe('auth_failed')
    expect(sf.calls).toHaveLength(1) // no retry storm (maxAttempts=1 effect on non-retryable)

    // loops self-guard while auth_failed → zero further requests
    await runtime.runLoopOnce('heartbeat')
    await runtime.runLoopOnce('sync')
    await runtime.runLoopOnce('usage')
    expect(sf.calls).toHaveLength(1)

    expect(runtime.recentEvents().some((e) => e.code === 'auth.failed')).toBe(true)
    await runtime.shutdown('test')
  })

  it('403 (relay_disabled) → AUTH_FAILED path as well', async () => {
    const { runtime } = boot([
      { status: 403, body: { error: { code: 'FORBIDDEN', message: 'relay_disabled' } } },
    ])
    await runtime.start(false)
    expect(runtime.state).toBe('auth_failed')
    await runtime.shutdown('test')
  })

  it('token rotation via RELAY_TOKEN_FILE + reload recovers without restart', async () => {
    const os = await import('node:os')
    const { mkdirSync } = await import('node:fs')
    const dir = join(os.tmpdir(), `tok-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const tokenFile = writeTokenFile(dir, fakeToken())
    const { config, cleanup } = testConfig({ RELAY_TOKEN_FILE: tokenFile, RELAY_TOKEN: '' })
    cleanupFns.push(cleanup)

    const script: ScriptStep[] = [
      { status: 401, body: { error: { code: 'TOKEN_REVOKED', message: 'old token revoked' } } },
      fullSyncStep(),
      heartbeatStep(),
    ]
    const rf = createScriptedFetch(script)
    const rt = new RelayRuntime({
      config,
      log: quietLogger(),
      fetchImpl: rf.fetchImpl,
      sleepImpl: async () => {},
    })
    await rt.start(false)
    expect(rt.state).toBe('auth_failed')
    expect(rf.calls).toHaveLength(1)

    // admin rotates in the Panel → new token written to the file → SIGHUP
    const newToken = 'cbx_rl_' + 'n'.repeat(43)
    writeFileSync(tokenFile, newToken + '\n', 'utf8')
    expect(rt.reloadToken()).toBe(true)
    expect(rt.state).toBe('syncing')

    await rt.runLoopOnce('sync')
    expect(rt.state).toBe('running')
    const second = rf.calls[1]!
    expect(second.headers['authorization']).toBe(`Bearer ${newToken}`)
    await rt.shutdown('test')
  })
})

describe('Prompt 7 §33 — Reliability', () => {
  it('survives a restart: cursor + queue recovered from disk', async () => {
    const { runtime, sf, dataDir, config } = boot([
      fullSyncStep(),
      { throwNetwork: true },
    ])
    await runtime.start(false)
    runtime.collectorRef().add(CONFIG_ID, 5n, 5n)
    await runtime.runLoopOnce('usage') // buffered (network down)
    await runtime.shutdown('test')
    expect(runtime.localState().last_sync_cursor).toBe('CUR-1')

    // "restart": fresh runtime on the SAME dataDir
    const rf = createScriptedFetch([fullSyncStep(), usageAck()])
    const rt2 = new RelayRuntime({
      config,
      log: quietLogger(),
      fetchImpl: rf.fetchImpl,
      sleepImpl: async () => {},
    })
    await rt2.start(false)
    expect(rt2.localState().last_sync_cursor).toBe('CUR-1') // cursor survived
    await rt2.runLoopOnce('usage')
    expect(rt2.queueRef().metrics().depth).toBe(0) // buffered report delivered
    void sf
    void dataDir
    await rt2.shutdown('test')
  })

  it('graceful shutdown flushes pending usage and persists state', async () => {
    const { runtime, sf, dataDir } = boot([fullSyncStep(), usageAck()])
    await runtime.start(false)
    runtime.collectorRef().add(CONFIG_ID, 9n, 9n) // traffic NOT yet flushed
    expect(runtime.collectorRef().pendingConfigCount()).toBe(1)

    const code = await runtime.shutdown('SIGTERM-test')
    expect(code).toBe(0)
    expect(runtime.state).toBe('stopped')
    expect(sf.calls).toHaveLength(2) // final flush happened during shutdown
    expect(runtime.queueRef().metrics().depth).toBe(0)
    expect(existsSync(join(dataDir, 'state.json'))).toBe(true)
    expect(existsSync(join(dataDir, 'usage-queue.json'))).toBe(true)
    const raw = readFileSync(join(dataDir, 'state.json'), 'utf8')
    expect(raw).not.toContain('cbx_rl_')
  })

  it('classifies API timeouts as degraded (network kind), not auth', async () => {
    const { runtime } = boot([
      { throwTimeout: true },
      { throwTimeout: true },
      { throwTimeout: true },
    ])
    await runtime.start(false)
    expect(runtime.state).toBe('degraded')
    expect(runtime.lastError?.code).toBe('TIMEOUT')
    await runtime.shutdown('test')
  })

  it('classifies 410 (deleted relay) as AUTH_FAILED-family stop state', async () => {
    const { runtime } = boot([
      { status: 410, body: { error: { code: 'RESOURCE_DELETED', message: 'relay deleted' } } },
    ])
    await runtime.start(false)
    expect(runtime.state).toBe('auth_failed')
    expect(runtime.recentEvents().some((e) => e.code === 'auth.failed')).toBe(true)
    await runtime.shutdown('test')
  })
})

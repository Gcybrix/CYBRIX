/**
 * Test helpers — fixtures + scripted fetch + config builder.
 * NOTE: token values here are constructed dynamically (never literal) and
 * live under test/ which the secret-scan excludes by design.
 */

import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, type RelayConfig } from '../src/config'
import { Logger } from '../src/log'
import type {
  RelayConfigRecord,
  RelaySyncEnvelope,
  RelayUserRecord,
} from '@cybrix/shared-types'

export const RELAY_ID = '9f1c1111-2222-4333-8444-555566667777'
export const OTHER_RELAY_ID = 'aa000000-0000-4000-8000-000000000001'
export const USER_ID = 'aaaa1111-2222-4333-8444-555566667777'
export const USER2_ID = 'aaaa1111-2222-4333-8444-555566667778'
export const CONFIG_ID = 'bbbb1111-2222-4333-8444-555566667777'
export const CONFIG2_ID = 'bbbb1111-2222-4333-8444-555566667778'

/** obviously-fake token, built dynamically so no literal token ever exists */
export const fakeToken = (): string => 'cbx_rl_' + 'x'.repeat(43)

/** logger that swallows output — keeps test stdout readable */
export const quietLogger = (relayId: string = RELAY_ID): Logger =>
  new Logger('error', { component: 'relay', relay_id: relayId }, () => {})

export function userFixture(overrides: Partial<RelayUserRecord> = {}): RelayUserRecord {
  return {
    id: USER_ID,
    status: 'active',
    expires_at: null,
    traffic_limit_bytes: null,
    traffic_used_bytes: '0',
    traffic_reset_day: null,
    version: 1,
    updated_at: 1758700000,
    deleted_at: null,
    ...overrides,
  }
}

export function configFixture(overrides: Partial<RelayConfigRecord> = {}): RelayConfigRecord {
  return {
    id: CONFIG_ID,
    user_id: USER_ID,
    // default: a protocol NO adapter handles → hermetic unit tests (no ports)
    protocol: 'no-such-protocol',
    relay_id: RELAY_ID,
    upstream_id: null,
    credential: null,
    parameters: {},
    version: 1,
    updated_at: 1758700000,
    deleted_at: null,
    ...overrides,
  }
}

export function syncEnvelope(
  data: Partial<RelaySyncEnvelope['data']> = {},
  meta: Partial<RelaySyncEnvelope['meta']> = {},
): RelaySyncEnvelope {
  return {
    data: {
      relays: [],
      upstreams: [],
      configs: [],
      users: [],
      ...data,
    },
    meta: {
      cursors: {
        next_cursor: 'CUR-1',
        has_more: { configs: false, users: false, upstreams: false, relays: false },
      },
      server_time: 1758700900,
      ...meta,
    },
  }
}

/* ---------- scripted fetch ---------- */

export interface FetchCall {
  url: string
  method: string
  body: unknown
  headers: Record<string, string>
}

export interface ScriptStep {
  status?: number
  body?: unknown
  headers?: Record<string, string>
  throwNetwork?: boolean
  throwTimeout?: boolean
  delayMs?: number
}

export interface ScriptedFetch {
  fetchImpl: typeof fetch
  calls: FetchCall[]
  /** number of HTTP attempts actually performed */
  attempts: () => number
}

export function createScriptedFetch(script: ScriptStep[] | ((call: FetchCall) => ScriptStep)): ScriptedFetch {
  const calls: FetchCall[] = []
  let httpAttempts = 0
  let stepIndex = 0
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    )
    const call: FetchCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? (JSON.parse(init.body as string) as unknown) : undefined,
      headers,
    }
    calls.push(call)
    const step = typeof script === 'function' ? script(call) : (script[stepIndex++] ?? { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'script exhausted' } } })
    httpAttempts++
    if (step.throwNetwork) throw new Error('ECONNREFUSED: scripted network failure')
    if (step.throwTimeout) {
      const e = new Error('The operation was aborted due to timeout')
      e.name = 'TimeoutError'
      throw e
    }
    if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs))
    let body = step.body
    // Prompt 4 §10.9: the ACK echoes the request's report_id — substitute the placeholder
    if (
      body &&
      typeof body === 'object' &&
      (body as Record<string, unknown>)['report_id'] === 'ECHO_REQUEST_REPORT_ID'
    ) {
      body = {
        ...(body as Record<string, unknown>),
        report_id: (call.body as { report_id?: string } | undefined)?.report_id ?? 'unknown',
      }
    }
    return new Response(JSON.stringify(body ?? {}), {
      status: step.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...(step.headers ?? {}) },
    })
  }
  return { fetchImpl, calls, attempts: () => httpAttempts }
}

/* ---------- config builder ---------- */

export interface TestConfigOverrides extends Record<string, string | undefined> {
  DATA_DIR?: string
}

export function relayEnv(overrides: TestConfigOverrides = {}): Record<string, string> {
  return {
    RELAY_ID,
    RELAY_TOKEN: fakeToken(),
    CYBRIX_API_URL: 'https://panel.example',
    NODE_ENV: 'test',
    PORT: '0',
    HEARTBEAT_INTERVAL_S: '60',
    SYNC_INTERVAL_S: '30',
    USAGE_FLUSH_INTERVAL_S: '60',
    RETRY_MAX_ATTEMPTS: '3',
    RETRY_BASE_MS: '50',
    RETRY_MAX_BACKOFF_MS: '500',
    ...overrides,
  }
}

export function testConfig(overrides: TestConfigOverrides = {}): { config: RelayConfig; dataDir: string; cleanup: () => void } {
  const dataDir = overrides.DATA_DIR ?? mkdtempSync(join(tmpdir(), 'cybrix-relay-test-'))
  const config = loadConfig(relayEnv({ ...overrides, DATA_DIR: dataDir }))
  return {
    config,
    dataDir,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  }
}

/** writes a fake token file for RELAY_TOKEN_FILE tests */
export function writeTokenFile(dir: string, token: string): string {
  const p = join(dir, 'relay_token')
  writeFileSync(p, token + '\n', 'utf8')
  chmodSync(p, 0o600)
  return p
}

/** wait until cond() or timeout */
export async function waitFor(cond: () => boolean, timeoutMs = 3000, stepMs = 10): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met in time')
    await new Promise((r) => setTimeout(r, stepMs))
  }
}

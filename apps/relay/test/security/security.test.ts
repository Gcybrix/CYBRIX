/**
 * Security tests — Prompt 7 §28/§33 + §36.21.
 *  1. structured logs NEVER contain secrets (even when errors do)
 *  2. heartbeat payloads / queue files / state files are secret-free
 *  3. repo-wide secret scan over relay source + docs + shared-types
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Logger } from '../../src/log'
import { RelayRuntime } from '../../src/runtime'
import {
  CONFIG_ID,
  RELAY_ID,
  configFixture,
  createScriptedFetch,
  fakeToken,
  quietLogger,
  syncEnvelope,
  testConfig,
  userFixture,
} from '../helpers'

function captureLogs(level: 'error' | 'info' = 'error'): { lines: string[]; logger: Logger } {
  const lines: string[] = []
  const logger = new Logger(level, { component: 'relay', relay_id: RELAY_ID }, (l) => lines.push(l))
  return { lines, logger }
}

describe('log redaction (Prompt 7 §28)', () => {
  it('never emits the relay token, even when it appears in error details', () => {
    const { lines, logger } = captureLogs()
    logger.error('auth.failed', { token: fakeToken(), detail: `bearer ${fakeToken()} rejected` })
    const all = lines.join('\n')
    expect(all).not.toContain(fakeToken())
    expect(all).toContain('[REDACTED]')
    expect(all).toContain('"relay_id":"' + RELAY_ID + '"')
  })

  it('redacts telegram bot token shapes relay-side too (defense in depth)', () => {
    const { lines, logger } = captureLogs()
    const botShape = '1234567890:' + 'A'.repeat(34)
    logger.warn('config.note', { note: 'found ' + botShape })
    expect(lines.join('\n')).not.toContain(botShape)
  })

  it('keeps required structured fields (ts/level/component/event)', () => {
    const { lines, logger } = captureLogs('info')
    logger.info('heartbeat.ok', { status: 'online' })
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(parsed['ts']).toBeTypeOf('string')
    expect(parsed['level']).toBe('info')
    expect(parsed['component']).toBe('relay')
    expect(parsed['event']).toBe('heartbeat.ok')
  })
})

describe('runtime artifacts stay secret-free (Prompt 7 §11/§28)', () => {
  it('heartbeat body + queue + state files contain NO token/credential material', async () => {
    const { config, dataDir, cleanup } = testConfig()
    const sf = createScriptedFetch([
      {
        status: 200,
        body: syncEnvelope({
          relays: [{ id: RELAY_ID, name: 'r', status: 'active', version: 1, updated_at: 1, deleted_at: null }],
          // credential material MUST stay in memory only
          configs: [configFixture({ credential: { uuid: 'cred-uuid-value' } })],
          users: [userFixture()],
        }),
      },
      { status: 200, body: { server_time: 1, heartbeat_interval_seconds: 60, should_sync: false, relay: { id: RELAY_ID, status: 'active', health: 'online' } } },
    ])
    const runtime = new RelayRuntime({
      config,
      log: quietLogger(),
      fetchImpl: sf.fetchImpl,
      sleepImpl: async () => {},
    })
    await runtime.start(false)
    await runtime.runLoopOnce('heartbeat')

    // heartbeat request: no credential, no token
    const hbRaw = JSON.stringify(sf.calls[1]!.body)
    expect(hbRaw).not.toContain('cred-uuid-value')
    expect(hbRaw).not.toContain(fakeToken())

    // disk artifacts: state + queue + dead-letter
    runtime.collectorRef().add(CONFIG_ID, 1n, 1n)
    await runtime.runLoopOnce('usage')
    for (const f of ['state.json', 'usage-queue.json']) {
      const p = join(dataDir, f)
      if (existsSync(p)) {
        const raw = readFileSync(p, 'utf8')
        expect(raw).not.toContain(fakeToken())
        expect(raw).not.toContain('cred-uuid-value')
      }
    }
    await runtime.shutdown('test')
    cleanup()
  })
})

describe('repo secret scan (Prompt 7 §33 Security)', () => {
  // resolve from this test file: test/security → apps/relay (two up)
  const RELAY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const PROJECT_ROOT = join(RELAY_ROOT, '..')
  const SCAN_DIRS = [
    join(RELAY_ROOT, 'src'),
    join(RELAY_ROOT, 'docs'),
    join(RELAY_ROOT, 'scripts'),
    join(PROJECT_ROOT, 'packages', 'shared-types', 'src'),
  ]
  const SCAN_FILES = [
    join(RELAY_ROOT, 'README.md'),
    join(RELAY_ROOT, '.env.example'),
    join(RELAY_ROOT, 'Dockerfile'),
    join(PROJECT_ROOT, 'railway.json'),
  ]

  const SECRET_PATTERNS: Array<[string, RegExp]> = [
    ['CYBRIX relay token literal', /\bcbx_(?:rl|apc|sub)_[A-Za-z0-9]{16,}\b/],
    ['Telegram bot token literal', /\b\d{6,12}:[A-Za-z0-9_-]{25,}\b/],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['hardcoded secret assignment', /\b(?:RELAY_TOKEN|TELEGRAM_BOT_TOKEN|DATA_ENCRYPTION_KEY)\s*=\s*['"][^'"]{20,}['"]/],
  ]

  function walk(dir: string, acc: string[] = []): string[] {
    if (!existsSync(dir)) return acc
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const s = statSync(p)
      if (s.isDirectory()) walk(p, acc)
      else acc.push(p)
    }
    return acc
  }

  it('finds NO hardcoded secrets in relay source, docs, scripts or shared-types', () => {
    const files = [
      ...SCAN_DIRS.flatMap((d) => walk(d)),
      ...SCAN_FILES.filter((f) => existsSync(f)),
    ]
    expect(files.length).toBeGreaterThan(10)
    const violations: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      for (const [label, re] of SECRET_PATTERNS) {
        if (re.test(content)) violations.push(`${label}: ${file}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('the scan itself would catch a leaked token (negative control)', () => {
    const leaked = 'cbx_rl_' + 'Ab0Cd1Ef2Gh3Ij4Kl5Mn6Op7Qr8St9Uv1' // 32 chars after prefix
    const re = /\bcbx_(?:rl|apc|sub)_[A-Za-z0-9]{16,}\b/
    expect(re.test('token = "' + leaked + '"')).toBe(true)
  })
})

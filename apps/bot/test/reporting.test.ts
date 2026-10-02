/**
 * Reporting system (Prompt 6 §8–§14/§22): severity styling, dedup +
 * aggregation, CRITICAL never dropped, bounded retry on Telegram outage,
 * redaction, and fire-and-forget safety.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deliverReport,
  fireReport,
  formatReport,
  reportDeployment,
  reportRelayHealth,
  reportSecurity,
  reportStageCompleted,
  reportStageFailed,
  reportStageStarted,
  reportUsage,
} from '../src/reporting/reporter'
import { createHarness } from './helpers'
import type { Env } from '../src/types'
import type { Harness } from './helpers'

afterEach(() => vi.unstubAllGlobals())

/** stub global fetch so deliverReport's Telegram transport hits the mock */
function stub(harness: Harness): void {
  vi.stubGlobal('fetch', harness.fetchProxy)
}

function reportEnv(harness: ReturnType<typeof createHarness>): Env {
  return harness.env
}

describe('report formatting & severity', () => {
  it('renders each severity with its emoji', () => {
    expect(formatReport({ severity: 'INFO', title: 'T', fields: [] })).toContain('ℹ️')
    expect(formatReport({ severity: 'SUCCESS', title: 'T', fields: [] })).toContain('✅')
    expect(formatReport({ severity: 'WARNING', title: 'T', fields: [] })).toContain('⚠️')
    expect(formatReport({ severity: 'ERROR', title: 'T', fields: [] })).toContain('❌')
    expect(formatReport({ severity: 'CRITICAL', title: 'T', fields: [] })).toContain('🚨')
  })

  it('includes component, fields, time and request id', () => {
    const text = formatReport({
      severity: 'INFO',
      title: 'Stage Update',
      component: 'cybrix-bot',
      requestId: 'req-abc12345',
      fields: [{ label: 'Stage', value: 'Prompt 6 — Telegram Bot' }],
    })
    expect(text).toContain('Component:')
    expect(text).toContain('Stage:')
    expect(text).toContain('Time:')
    expect(text).toContain('req-abc12')
  })
})

describe('report domain helpers', () => {
  it('stage / deployment / relay / usage / security reports format correctly', () => {
    expect(formatReport({ severity: 'INFO', title: 'Stage Update', fields: [{ label: 'Status', value: 'STARTED' }] })).toContain('STARTED')
    expect(formatReport({ severity: 'SUCCESS', title: 'Stage Completed', fields: [{ label: 'Status', value: 'SUCCESS' }] })).toContain('SUCCESS')
    expect(formatReport({ severity: 'CRITICAL', title: 'Stage Failed', fields: [{ label: 'Error Code', value: 'E1' }] })).toContain('E1')
    expect(formatReport({ severity: 'SUCCESS', title: 'Deployment', fields: [{ label: 'Service', value: 'cybrix-bot' }] })).toContain('cybrix-bot')
    expect(formatReport({ severity: 'ERROR', title: 'Relay Health', fields: [{ label: 'Status', value: 'OFFLINE' }] })).toContain('OFFLINE')
    expect(formatReport({ severity: 'INFO', title: 'Usage Report', fields: [{ label: 'Traffic', value: '1 GiB' }] })).toContain('Traffic')
    expect(formatReport({ severity: 'WARNING', title: 'Security Event', fields: [{ label: 'Type', value: 'probe' }] })).toContain('probe')
  })

  it('fire* wrappers schedule delivery via waitUntil without throwing', async () => {
    const harness = createHarness()
    stub(harness)
    const ctx = { waitUntil: harness.ctx.waitUntil }
    expect(() => reportStageStarted(reportEnv(harness), ctx, { stage: 'Prompt 6 — Telegram Bot', component: 'cybrix-bot' })).not.toThrow()
    expect(() => reportStageCompleted(reportEnv(harness), ctx, { stage: 'Telegram Bot', components: ['Webhook', 'Reporting'] })).not.toThrow()
    expect(() => reportStageFailed(reportEnv(harness), ctx, { stage: 'Telegram Bot', errorCode: 'DEPLOY_500' })).not.toThrow()
    expect(() => reportDeployment(reportEnv(harness), ctx, { service: 'cybrix-bot', version: '0.1.0', environment: 'production', status: 'SUCCESS' })).not.toThrow()
    expect(() => reportRelayHealth(reportEnv(harness), ctx, { relay: 'fra-01', status: 'OFFLINE' })).not.toThrow()
    expect(() => reportUsage(reportEnv(harness), ctx, { period: '2026-09-25', users: '12', configs: '30', traffic: '10 GiB', activeRelays: '1' })).not.toThrow()
    expect(() => reportSecurity(reportEnv(harness), ctx, { type: 'probe', actor: 'anon', action: '/x' })).not.toThrow()
    await harness.ctx.drain()
    expect(harness.telegramMessages().length).toBeGreaterThanOrEqual(7)
  })
})

describe('dedup & aggregation (Prompt 6 §14)', () => {
  it('deduplicates identical reports within the window', async () => {
    const harness = createHarness()
    stub(harness)
    const env = reportEnv(harness)
    const report = { severity: 'WARNING' as const, title: 'Relay Health', dedupeKey: 'relay|x|OFFLINE', fields: [] }
    expect(await deliverReport(env, report)).toBe('sent')
    expect(await deliverReport(env, report)).toBe('deduped')
    expect(await deliverReport(env, report)).toBe('deduped')
  })

  it('aggregates the 5th occurrence into a summary message', async () => {
    const harness = createHarness()
    stub(harness)
    const env = reportEnv(harness)
    const report = { severity: 'WARNING' as const, title: 'Relay Health', dedupeKey: 'relay|y|OFFLINE', fields: [] }
    expect(await deliverReport(env, report)).toBe('sent')
    expect(await deliverReport(env, report)).toBe('deduped')
    expect(await deliverReport(env, report)).toBe('deduped')
    expect(await deliverReport(env, report)).toBe('deduped')
    expect(await deliverReport(env, report)).toBe('aggregated')
    const texts = harness.telegramMessages().map((m) => JSON.stringify(m.payload))
    expect(texts.some((t) => t.includes('Occurrences'))).toBe(true)
  })

  it('CRITICAL reports are never deduplicated', async () => {
    const harness = createHarness()
    stub(harness)
    const env = reportEnv(harness)
    const report = { severity: 'CRITICAL' as const, title: 'Stage Failed', dedupeKey: 'same-key', fields: [] }
    expect(await deliverReport(env, report)).toBe('sent')
    expect(await deliverReport(env, report)).toBe('sent')
    expect(await deliverReport(env, report)).toBe('sent')
  })

  it('no destination configured → failed (logged), never thrown', async () => {
    const harness = createHarness({ env: { TELEGRAM_REPORT_CHAT_ID: '' } })
    stub(harness)
    const result = await deliverReport(reportEnv(harness), { severity: 'INFO', title: 'X', fields: [] })
    expect(result).toBe('failed')
  })
})

describe('Telegram API outage (Prompt 6 §13)', () => {
  it('retries bounded times, then gives up WITHOUT throwing', async () => {
    const harness = createHarness({ telegramStatus: 500 })
    stub(harness)
    const result = await deliverReport(reportEnv(harness), { severity: 'INFO', title: 'X', fields: [] })
    expect(result).toBe('failed')
    const tgCalls = harness.calls.filter((c) => c.url.includes('api.telegram.org')).length
    expect(tgCalls).toBe(3) // bounded — no infinite loop
  })

  it('fireReport swallows KV failures (notification failure != core failure)', async () => {
    const harness = createHarness()
    stub(harness)
    const brokenKV = {
      get: async () => {
        throw new Error('kv down')
      },
      put: async () => {
        throw new Error('kv down')
      },
      delete: async () => {},
    } as unknown as KVNamespace
    const env = { ...harness.env, KV: brokenKV } as Env
    expect(() => fireReport(env, harness.ctx, { severity: 'INFO', title: 'X', fields: [] })).not.toThrow()
    await harness.ctx.drain()
    expect(harness.telegramMessages().length).toBeGreaterThanOrEqual(1)
  })
})

describe('report redaction (Prompt 6 §12)', () => {
  it('never ships secret-shaped values to Telegram', async () => {
    const harness = createHarness()
    stub(harness)
    await deliverReport(reportEnv(harness), {
      severity: 'ERROR',
      title: 'Leaky Report',
      fields: [
        { label: 'Token', value: 'cyb_rly_ABCDEFGHIJKLMNOP1234567890' },
        { label: 'Auth', value: 'Bearer sk-abcdefghijklmnop' },
        { label: 'password', value: 'hunter2-secret' },
      ],
    })
    const text = harness.telegramMessages().map((m) => JSON.stringify(m.payload)).join('\n')
    expect(text).not.toContain('cyb_rly_ABCDEFGHIJKLMNOP1234567890')
    expect(text).not.toContain('sk-abcdefghijklmnop')
    expect(text).not.toContain('hunter2-secret')
    expect(text).toContain('[REDACTED')
  })
})

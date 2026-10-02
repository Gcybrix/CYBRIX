import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OfflineUsageQueue } from '../../src/queue/offline-buffer'
import { CONFIG_ID, USER_ID } from '../helpers'
import type { RelayUsageEntry } from '@cybrix/shared-types'

function entry(configId = CONFIG_ID, up = '1000', down = '2000'): RelayUsageEntry {
  return { user_id: USER_ID, config_id: configId, bytes_up: up, bytes_down: down }
}

describe('offline usage queue (Prompt 7 §16/§17/§20)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'q-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('persists on enqueue and reloads after restart', () => {
    const q1 = new OfflineUsageQueue(dir, 10, 1 << 20)
    q1.enqueue([entry()], 1758700000, 100)
    expect(q1.metrics().depth).toBe(1)
    expect(existsSync(join(dir, 'usage-queue.json'))).toBe(true)

    const q2 = new OfflineUsageQueue(dir, 10, 1 << 20)
    expect(q2.load()).toBe(false)
    expect(q2.pending()).toHaveLength(1)
    expect(q2.pending()[0]?.entries[0]?.bytes_up).toBe('1000')
  })

  it('enforces the count cap with DETERMINISTIC drop-oldest', () => {
    const q = new OfflineUsageQueue(dir, 3, 1 << 30)
    for (let i = 0; i < 5; i++) q.enqueue([entry(CONFIG_ID, String(i), '0')], 1758700000 + i, 100 + i)
    const m = q.metrics()
    expect(m.depth).toBe(3)
    const pending = q.pending()
    expect(pending[0]?.entries[0]?.bytes_up).toBe('2') // oldest two dropped
    expect(pending[2]?.entries[0]?.bytes_up).toBe('4')
  })

  it('enforces the byte cap with drop-oldest', () => {
    const q = new OfflineUsageQueue(dir, 100, 300) // tiny byte cap
    q.enqueue([entry(CONFIG_ID, '1'.repeat(80), '0')], 1758700000, 100)
    q.enqueue([entry(CONFIG_ID, '2'.repeat(80), '0')], 1758700000, 101)
    expect(q.metrics().depth).toBe(1)
    expect(q.metrics().bytes).toBeLessThanOrEqual(300)
  })

  it('removes reports only after ACK (accepted | already_processed)', () => {
    const q = new OfflineUsageQueue(dir, 10, 1 << 20)
    q.enqueue([entry()], 1758700000, 100)
    q.enqueue([entry(CONFIG_ID, '5', '5')], 1758700000, 101)
    const firstId = q.pending()[0]?.report_id as string
    expect(q.ackAccepted([firstId])).toBe(1)
    expect(q.metrics().depth).toBe(1)
    expect(q.ackAccepted([firstId])).toBe(0) // idempotent
  })

  it('moves rejected reports to a bounded dead-letter file', () => {
    const q = new OfflineUsageQueue(dir, 10, 1 << 20)
    q.enqueue([entry()], 1758700000, 100)
    const id = q.pending()[0]?.report_id as string
    q.reject(id, 'validation_error')
    expect(q.metrics().depth).toBe(0)
    const dead = JSON.parse(readFileSync(join(dir, 'usage-dead.json'), 'utf8')) as unknown[]
    expect(dead).toHaveLength(1)
    expect((dead[0] as Record<string, unknown>)['reject_reason']).toBe('validation_error')
  })

  it('quarantines a corrupt snapshot instead of crashing (deterministic recovery)', () => {
    const q1 = new OfflineUsageQueue(dir, 10, 1 << 20)
    q1.enqueue([entry()], 1758700000, 100)
    // simulate a torn write
    const { writeFileSync } = require('node:fs')
    writeFileSync(join(dir, 'usage-queue.json'), '{"schema":1,"items":[{"report_id":"x"', 'utf8')

    const q2 = new OfflineUsageQueue(dir, 10, 1 << 20)
    const corrupt = q2.load()
    expect(corrupt).toBe(true)
    expect(q2.metrics().depth).toBe(0)
    const quarantined = (require('node:fs') as typeof import('node:fs'))
      .readdirSync(dir)
      .filter((f) => f.startsWith('usage-queue.json.corrupt'))
    expect(quarantined).toHaveLength(1)
  })

  it('never persists token-like material (reports only)', () => {
    const q = new OfflineUsageQueue(dir, 10, 1 << 20)
    q.enqueue([entry()], 1758700000, 100)
    const raw = readFileSync(join(dir, 'usage-queue.json'), 'utf8')
    expect(raw).not.toContain('cbx_rl_')
    expect(raw).not.toContain('token')
  })
})

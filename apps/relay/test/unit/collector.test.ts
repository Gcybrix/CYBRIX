import { describe, expect, it } from 'vitest'
import { UsageCollector } from '../../src/usage/collector'
import { CONFIG_ID, USER_ID } from '../helpers'

describe('usage collector (Prompt 7 §15)', () => {
  it('accumulates BigInt counters and emits DECIMAL STRINGS', () => {
    const c = new UsageCollector()
    c.add(CONFIG_ID, 1000n, 2000n)
    c.add(CONFIG_ID, 500n, 250n)
    const reports = c.drain(100, 200, 250, () => USER_ID)
    expect(reports).toHaveLength(1)
    const e = reports[0]!.entries[0]!
    expect(e.bytes_up).toBe('1500')
    expect(e.bytes_down).toBe('2250')
    expect(e.user_id).toBe(USER_ID)
    expect(e.config_id).toBe(CONFIG_ID)
    expect(e.window_from).toBe(100)
    expect(e.window_to).toBe(200)
    expect(/^[0-9]{1,19}$/.test(e.bytes_up)).toBe(true)
  })

  it('skips zero-traffic configs and drains atomically', () => {
    const c = new UsageCollector()
    c.add(CONFIG_ID, 0n, 0n)
    expect(c.drain(0, 1, 1, () => USER_ID)).toHaveLength(0)
    c.add(CONFIG_ID, 1n, 1n)
    expect(c.drain(0, 1, 1, () => USER_ID)).toHaveLength(1)
    expect(c.drain(0, 1, 1, () => USER_ID)).toHaveLength(0) // emptied
  })

  it('splits >500 entries into multiple reports with FRESH report_ids', () => {
    const c = new UsageCollector()
    const ids = Array.from({ length: 501 }, (_, i) => `c${String(i).padStart(3, '0')}`)
    for (const id of ids) c.add(id, 1n, 1n)
    const reports = c.drain(0, 1, 1, (cfg) => `u-${cfg}`)
    expect(reports).toHaveLength(2)
    expect(reports[0]!.entries).toHaveLength(500)
    expect(reports[1]!.entries).toHaveLength(1)
    expect(reports[0]!.report_id).not.toBe(reports[1]!.report_id)
    for (const r of reports) {
      expect(r.report_id).toMatch(/^[0-9a-f-]{36}$/)
      expect(r.entries.length).toBeLessThanOrEqual(500)
    }
  })

  it('drops entries without a user mapping (counted, never crashes)', () => {
    const c = new UsageCollector()
    c.add('orphan-config', 10n, 10n)
    const reports = c.drain(0, 1, 1, () => undefined)
    expect(reports).toHaveLength(0)
    expect(c.droppedNoUser).toBe(1)
  })

  it('handles huge counters beyond 2^53 via BigInt', () => {
    const c = new UsageCollector()
    c.add(CONFIG_ID, 9_000_000_000_000n, 0n)
    c.add(CONFIG_ID, 9_000_000_000_000n, 0n)
    const e = c.drain(0, 1, 1, () => USER_ID)[0]!.entries[0]!
    expect(e.bytes_up).toBe('18000000000000')
  })
})

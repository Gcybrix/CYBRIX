/**
 * Usage collector — Prompt 7 §15/§16.
 *
 * BigInt per-config byte counters fed by the data plane (ProtocolAdapters).
 * `drain()` converts counters into Prompt 4 §10.9 reports:
 *  - decimal-string bytes (^[0-9]{1,19}$)
 *  - per-config user resolution comes from the AssignmentManager (relay does
 *    NOT decide anything about users — it only echoes the mapping it received)
 *  - > 500 entries → split into multiple reports, each with a fresh report_id
 */

import { randomUUID } from 'node:crypto'
import type { RelayUsageEntry, RelayUsageReportRequest } from '@cybrix/shared-types'

const MAX_ENTRIES_PER_REPORT = 500

export class UsageCollector {
  /** config_id → [up, down] */
  private counters = new Map<string, [bigint, bigint]>()
  /** configs that had traffic but no user mapping at drain time (defensive) */
  droppedNoUser = 0

  add(configId: string, bytesUp: bigint, bytesDown: bigint): void {
    if (bytesUp <= 0n && bytesDown <= 0n) return
    const cur = this.counters.get(configId) ?? [0n, 0n]
    cur[0] += bytesUp
    cur[1] += bytesDown
    this.counters.set(configId, cur)
  }

  pendingConfigCount(): number {
    return this.counters.size
  }

  /**
   * Atomically drain all counters into reports.
   * @param resolveUser config_id → user_id (from the last accepted sync)
   */
  drain(
    windowFrom: number,
    windowTo: number,
    generatedAt: number,
    resolveUser: (configId: string) => string | undefined,
  ): RelayUsageReportRequest[] {
    const entries: RelayUsageEntry[] = []
    for (const [configId, pair] of this.counters) {
      this.counters.delete(configId)
      const [up, down] = pair
      if (up === 0n && down === 0n) continue
      const userId = resolveUser(configId)
      if (!userId) {
        // mapping vanished (config unassigned between traffic and flush):
        // deterministic, counted, never crashes the relay
        this.droppedNoUser++
        continue
      }
      entries.push({
        user_id: userId,
        config_id: configId,
        bytes_up: up.toString(),
        bytes_down: down.toString(),
        window_from: windowFrom,
        window_to: windowTo,
      })
    }
    if (entries.length === 0) return []

    const reports: RelayUsageReportRequest[] = []
    for (let i = 0; i < entries.length; i += MAX_ENTRIES_PER_REPORT) {
      reports.push({
        report_id: randomUUID(),
        generated_at: generatedAt,
        entries: entries.slice(i, i + MAX_ENTRIES_PER_REPORT),
      })
    }
    return reports
  }
}

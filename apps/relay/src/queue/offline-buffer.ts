/**
 * Offline Buffer — Prompt 7 §16/§17.
 *
 * Bounded, disk-backed, FIFO queue of usage reports awaiting ACK.
 *  - a report is enqueued BEFORE any send attempt (persist-before-send) and
 *    removed ONLY after the API ACKs it (accepted | already_processed).
 *  - caps: max count + max bytes; overflow is DETERMINISTIC (drop-oldest)
 *    and raises a CRITICAL `queue.full` / `queue.dropped` event (§17).
 *  - persistence: whole-queue atomic snapshot (tmp + rename) after every
 *    mutation → shutdown/crash can never corrupt the file (§20).
 *  - a corrupt snapshot is quarantined (renamed), never crashes boot; the
 *    loss is reported as a CRITICAL data-loss event.
 *
 * The queue stores usage reports ONLY — never tokens or credentials (§28).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RelayUsageEntry, RelayUsageReportRequest } from '@cybrix/shared-types'
import { randomUUID } from 'node:crypto'

export interface QueuedReport {
  report_id: string
  generated_at: number
  enqueued_at: number
  attempts: number
  bytes: number
  entries: RelayUsageEntry[]
}

export interface QueueMetrics {
  depth: number
  bytes: number
  full: boolean
  nearLimit: boolean
}

export interface EnqueueResult {
  droppedOldest: number
}

const DEADLETTER_MAX = 500

export class OfflineUsageQueue {
  private items: QueuedReport[] = []
  private totalBytes = 0
  private readonly filePath: string
  private readonly deadLetterPath: string

  constructor(
    dataDir: string,
    private readonly maxReports: number,
    private readonly maxBytes: number,
    private readonly nearLimitRatio = 0.8,
  ) {
    this.filePath = join(dataDir, 'usage-queue.json')
    this.deadLetterPath = join(dataDir, 'usage-dead.json')
  }

  /** Returns recoveredCorrupt (previous snapshot quarantined). */
  load(): boolean {
    if (!existsSync(this.filePath)) return false
    let recoveredCorrupt = false
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as { items?: QueuedReport[] }
      if (Array.isArray(raw.items)) {
        this.items = raw.items.filter(
          (it) =>
            it &&
            typeof it.report_id === 'string' &&
            Array.isArray(it.entries) &&
            it.entries.length > 0,
        )
        this.totalBytes = this.items.reduce((acc, it) => acc + (it.bytes || 0), 0)
      }
    } catch {
      recoveredCorrupt = true
      try {
        renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`)
      } catch {
        /* best effort */
      }
      this.items = []
      this.totalBytes = 0
    }
    return recoveredCorrupt
  }

  /**
   * Build a report from entries (fresh report_id, UUIDv4) and enqueue it.
   * Deterministic overflow: drop-oldest until the item fits BOTH caps.
   */
  enqueue(entries: RelayUsageEntry[], generatedAt: number, nowS: number): EnqueueResult {
    const bytes = Buffer.byteLength(JSON.stringify(entries), 'utf8')
    const item: QueuedReport = {
      report_id: randomUUID(),
      generated_at: generatedAt,
      enqueued_at: nowS,
      attempts: 0,
      bytes,
      entries,
    }
    const dropped: string[] = []
    while (
      this.items.length >= this.maxReports ||
      (this.items.length > 0 && this.totalBytes + bytes > this.maxBytes)
    ) {
      const oldest = this.items.shift()
      if (!oldest) break
      this.totalBytes -= oldest.bytes
      dropped.push(oldest.report_id)
    }
    if (bytes <= this.maxBytes) {
      this.items.push(item)
      this.totalBytes += bytes
    } // else: single report larger than the whole cap → refuse deterministically
    this.persist()
    return { droppedOldest: dropped.length }
  }

  /** Remove ACKed reports (accepted | already_processed). Returns removed count. */
  ackAccepted(reportIds: string[]): number {
    const set = new Set(reportIds)
    const before = this.items.length
    this.items = this.items.filter((it) => {
      if (set.has(it.report_id)) {
        this.totalBytes -= it.bytes
        return false
      }
      return true
    })
    const removed = before - this.items.length
    if (removed > 0) this.persist()
    return removed
  }

  /**
   * 422 (validation) / permanent rejection: move to bounded dead-letter file
   * for post-mortem; never retried as-is (Prompt 4 §10.9: new report_id needed).
   */
  reject(reportId: string, reason: string): void {
    const idx = this.items.findIndex((it) => it.report_id === reportId)
    if (idx === -1) return
    const [item] = this.items.splice(idx, 1)
    this.totalBytes -= item?.bytes ?? 0
    try {
      mkdirSync(dirname(this.deadLetterPath), { recursive: true })
      let dead: unknown[] = []
      if (existsSync(this.deadLetterPath)) {
        try {
          dead = (JSON.parse(readFileSync(this.deadLetterPath, 'utf8')) as unknown[]) ?? []
        } catch {
          dead = []
        }
      }
      dead.push({ ...item, reject_reason: reason })
      if (dead.length > DEADLETTER_MAX) dead = dead.slice(dead.length - DEADLETTER_MAX)
      const tmp = `${this.deadLetterPath}.tmp`
      writeFileSync(tmp, JSON.stringify(dead), 'utf8')
      renameSync(tmp, this.deadLetterPath)
    } catch {
      /* dead-lettering is best-effort; the queue itself stays consistent */
    }
    this.persist()
  }

  bumpAttempts(reportId: string): void {
    const it = this.items.find((i) => i.report_id === reportId)
    if (it) it.attempts++
  }

  oldest(): QueuedReport | undefined {
    return this.items[0]
  }

  pending(): QueuedReport[] {
    return [...this.items]
  }

  metrics(): QueueMetrics {
    return {
      depth: this.items.length,
      bytes: this.totalBytes,
      full: this.items.length >= this.maxReports || this.totalBytes >= this.maxBytes,
      nearLimit:
        this.items.length >= Math.floor(this.maxReports * this.nearLimitRatio) ||
        this.totalBytes >= Math.floor(this.maxBytes * this.nearLimitRatio),
    }
  }

  persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify({ schema: 1, items: this.items }), 'utf8')
    try {
      renameSync(tmp, this.filePath)
    } catch (err) {
      try {
        unlinkSync(tmp)
      } catch {
        /* ignore */
      }
      throw err
    }
  }
}

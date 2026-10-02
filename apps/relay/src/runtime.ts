/**
 * RelayRuntime — the relay's state machine + loop orchestration (Prompt 7).
 *
 * Lifecycle (§20/§30):
 *   booting → syncing → running ⇄ degraded → auth_failed
 *                                     ↘ shutting_down → stopped
 *
 * Loops (outbound-only, §2):
 *   sync      GET  /api/v1/relays/:id/sync       (cursor-based, §8/§9)
 *   heartbeat POST /api/v1/relays/:id/heartbeat  (minimal fields, §14)
 *   usage     POST /api/v1/relays/:id/usage      (report_id idempotent, §15/§16)
 *
 * Telegram reporting integration (§29): the relay NEVER holds a bot token.
 * Operational signals ride INSIDE the heartbeat `metadata` (flat, ≤16 keys,
 * ≤2KB, no secrets — Prompt 4 §10.8) and the Control Plane maps them onto
 * the Prompt 6 TelegramReporter. GAP-R2 proposes a dedicated events endpoint
 * for later — nothing outside the Prompt 4 contract is used.
 */

import type {
  RelayHeartbeatRequest,
  RelayHeartbeatResponseData,
  RelaySyncEnvelope,
  RelayUsageAckData,
  RelayUsageReportRequest,
} from '@cybrix/shared-types'
// VALUE import (endpoint constants) must be RELATIVE: the alias would leak
// into the emitted JS where it cannot be resolved (zero-dependency runtime).
// tsc rewrites relative specifiers 1:1 into dist/ — structure matches there.
import { API } from '../../../packages/shared-types/src/endpoints'
import type { RelayConfigRecord } from '@cybrix/shared-types'
import type { RelayConfig } from './config'
import { readTokenFromFile } from './config'
import { RelayApiClient, RelayApiError } from './api/client'
import { AssignmentManager } from './assignments/manager'
import { AdapterRegistry, type ProtocolAdapter } from './protocols/adapter'
import { TcpForwardAdapter } from './protocols/tcp-forward'
import { HealthServer, type LocalHealthSnapshot } from './health/server'
import { Logger } from './log'
import { IntervalTrigger } from './core/scheduler'
import { LocalStateStore, type RelayLocalState } from './core/state'
import { OfflineUsageQueue } from './queue/offline-buffer'
import { UsageCollector } from './usage/collector'

export type RelayRuntimeState =
  | 'booting'
  | 'syncing'
  | 'running'
  | 'degraded'
  | 'auth_failed'
  | 'shutting_down'
  | 'stopped'

const HEARTBEAT_METADATA_MAX_BYTES = 2048
const HEARTBEAT_METADATA_MAX_KEYS = 16
const EVENT_THROTTLE_MS = 300_000
const EVENT_RING_SIZE = 20
const CRITICAL_EVENT_MAX_PER_MIN = 10

export interface RelayRuntimeOptions {
  config: RelayConfig
  log: Logger
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
  nowS?: () => number
}

interface RelayEvent {
  code: string
  at: number
  severity: 'info' | 'warning' | 'error' | 'critical'
}

const CRITICAL_CODES = new Set(['auth.failed', 'queue.full', 'queue.dropped', 'data.loss'])

export class RelayRuntime {
  readonly relayId: string
  state: RelayRuntimeState = 'booting'
  lastError: { kind: string; code: string; at: number } | null = null
  startedAtMs = Date.now()

  private readonly log: Logger
  private readonly config: RelayConfig
  private readonly nowS: () => number
  private readonly sleep: (ms: number) => Promise<void>

  private currentToken: string
  private readonly client: RelayApiClient
  private readonly store: LocalStateStore
  private stateData: RelayLocalState
  private readonly manager: AssignmentManager
  private readonly registry = new AdapterRegistry()
  private readonly collector = new UsageCollector()
  private readonly queue: OfflineUsageQueue
  private healthServer: HealthServer | null = null

  private syncTrigger!: IntervalTrigger
  private heartbeatTrigger!: IntervalTrigger
  private usageTrigger!: IntervalTrigger
  private loopsStarted = false

  private syncing = false
  private hearting = false
  private delivering = false

  private syncFailures = 0
  private hbFailures = 0
  private usageFailures = 0
  private skippedConfigs = 0
  private events: RelayEvent[] = []
  private eventThrottle = new Map<string, number>()
  private criticalEventTimestamps: number[] = []

  constructor(opts: RelayRuntimeOptions) {
    this.config = opts.config
    this.log = opts.log
    this.nowS = opts.nowS ?? (() => Math.floor(Date.now() / 1000))
    this.sleep = opts.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.relayId = opts.config.relayId
    this.currentToken = opts.config.token

    this.client = new RelayApiClient({
      apiUrl: this.config.apiUrl,
      tokenProvider: () => this.currentToken,
      timeoutMs: this.config.httpTimeoutMs,
      maxAttempts: this.config.retryMaxAttempts,
      baseMs: this.config.retryBaseMs,
      maxBackoffMs: this.config.retryMaxBackoffMs,
      fetchImpl: opts.fetchImpl,
    })

    this.store = new LocalStateStore(this.config.dataDir, this.nowS)
    const loaded = this.store.load()
    this.stateData = loaded.state

    this.manager = new AssignmentManager(this.relayId)
    this.queue = new OfflineUsageQueue(
      this.config.dataDir,
      this.config.queueMaxReports,
      this.config.queueMaxBytes,
      this.config.queueNearLimitRatio,
    )

    // v1 adapter set — extend by registering, never by editing the runtime
    this.registry.register(new TcpForwardAdapter())

    if (loaded.recoveredCorrupt) {
      this.log.warn('state.corrupt_recovered', { file: 'state.json' })
      this.recordEvent('data.loss', 'critical', 'local state snapshot was corrupt; cursors reset')
    }
  }

  /* ---------- boot / shutdown ---------- */

  async start(startLoops = true): Promise<void> {
    let apiHost = this.config.apiUrl
    try {
      apiHost = new URL(this.config.apiUrl).host
    } catch {
      /* validated at boot — never happens */
    }
    this.log.info('relay.boot', {
      relay_id: this.relayId,
      api_host: apiHost,
      software_version: this.config.softwareVersion,
    })

    const queueCorrupt = this.queue.load()
    if (queueCorrupt) {
      this.log.error('queue.corrupt_recovered', { detail: 'pending usage reports were lost' })
      this.recordEvent('data.loss', 'critical', 'offline queue snapshot was corrupt; pending reports lost')
    }

    this.healthServer = new HealthServer(
      this.config.healthBind,
      this.config.port,
      () => this.healthSnapshot(),
      this.log,
    )
    await this.healthServer.start()

    this.buildTriggers()

    // initial sync (Prompt 7 §8) — transient failures degrade, auth failures halt
    this.state = 'syncing'
    try {
      await this.syncOnce()
    } catch (err) {
      this.handleLoopError('sync', err)
    }

    if (startLoops) {
      // loop fns self-guard while auth_failed/degraded — no infinite retry (§30)
      this.syncTrigger.start()
      this.heartbeatTrigger.start(true)
      this.usageTrigger.start()
      this.loopsStarted = true
    }
    this.log.info('relay.ready', { state: this.state, active_configs: this.manager.configCount() })
  }

  async shutdown(reason: string): Promise<number> {
    if (this.state === 'shutting_down' || this.state === 'stopped') return 0
    this.state = 'shutting_down'
    this.log.info('relay.shutdown_begin', { reason })

    this.syncTrigger?.stop()
    this.heartbeatTrigger?.stop()
    this.usageTrigger?.stop()

    // 1) stop accepting data-plane work (§20)
    for (const adapter of this.registry.all()) {
      try {
        await adapter.stopAll()
      } catch (err) {
        this.log.warn('adapter.stop_failed', { adapter: adapter.name, detail: msg(err) })
      }
    }

    // 2) final usage drain → enqueue (best effort)
    try {
      this.drainCollectorIntoQueue()
    } catch (err) {
      this.log.warn('shutdown.drain_failed', { detail: msg(err) })
    }

    // 3) flush pending reports until ACK or budget (§20)
    const deadline = Date.now() + this.config.shutdownFlushTimeoutMs
    while (Date.now() < deadline && this.state === 'shutting_down') {
      try {
        const progressed = await this.deliverOldestReport()
        if (!progressed) break
      } catch {
        break // auth/gone/permanent errors stop the flush loop
      }
    }

    // 4) persist operational state atomically (§20)
    try {
      this.store.save(this.stateData)
    } catch (err) {
      this.log.warn('shutdown.persist_failed', { detail: msg(err) })
    }

    await this.healthServer?.stop()
    this.state = 'stopped'
    this.log.info('relay.shutdown_complete', { reason })
    return 0
  }

  /* ---------- SIGHUP token hot reload (Prompt 7 §19) ---------- */

  reloadToken(): boolean {
    if (!this.config.tokenFilePath) {
      this.log.warn('token.reload_unsupported', {
        detail: 'RELAY_TOKEN_FILE is not configured; use env rotation + restart',
      })
      return false
    }
    try {
      const token = readTokenFromFile(this.config.tokenFilePath)
      this.currentToken = token
      this.log.info('token.reloaded', { source: 'file' })
      if (this.state === 'auth_failed') {
        this.state = 'syncing'
        this.lastError = null
        this.syncTrigger?.triggerNow()
      }
      return true
    } catch {
      this.log.error('token.reload_failed', { source: 'file' })
      return false
    }
  }

  /* ---------- SYNC (Prompt 7 §8/§9) ---------- */

  async syncOnce(forceFull = false): Promise<void> {
    if (this.syncing || this.state === 'auth_failed' || this.state === 'shutting_down') return
    this.syncing = true
    try {
      const hasCursor = this.stateData.last_sync_cursor !== null && !forceFull
      if (!hasCursor) {
        await this.runFullSync()
      } else {
        try {
          await this.runDeltaSync()
        } catch (err) {
          // Safe resync (§9): invalid/incompatible cursor → one full rebuild
          if (err instanceof RelayApiError && err.kind === 'permanent' && err.code === 'CURSOR_INVALID') {
            this.log.warn('sync.cursor_invalid_resync', {})
            this.stateData.last_sync_cursor = null
            this.persistState()
            await this.runFullSync()
          } else {
            throw err
          }
        }
      }
      this.syncFailures = 0
      this.stateData.last_sync_at = this.nowS()
      this.persistState()
      if (this.state === 'syncing' || this.state === 'degraded') this.state = 'running'
    } finally {
      this.syncing = false
    }
  }

  private async runDeltaSync(): Promise<void> {
    let since: string | null = this.stateData.last_sync_cursor
    for (;;) {
      const resp = await this.client.request<RelaySyncEnvelope>(
        'GET',
        API.relaySync(this.relayId),
        { query: { since: since ?? undefined }, raw: true },
      )
      this.applyDeltaPage(resp)
      const more = Object.values(resp.meta.cursors.has_more).some(Boolean)
      if (!more) {
        this.stateData.last_sync_cursor = resp.meta.cursors.next_cursor
        return
      }
      since = resp.meta.cursors.next_cursor
    }
  }

  private async runFullSync(): Promise<void> {
    const acc = this.manager.beginFullSync()
    let since: string | undefined
    for (;;) {
      const resp = await this.client.request<RelaySyncEnvelope>(
        'GET',
        API.relaySync(this.relayId),
        { query: { since }, raw: true },
      )
      this.manager.accumulateFullPage(acc, resp.data)
      const more = Object.values(resp.meta.cursors.has_more).some(Boolean)
      if (!more) {
        this.stateData.last_sync_cursor = resp.meta.cursors.next_cursor
        break
      }
      since = resp.meta.cursors.next_cursor
    }
    const result = this.manager.commitFullSync(acc)
    await this.reconcileAdapters(result.configsRemoved, result.configsAdded, result.configsUpdated)
    this.log.info('sync.full_applied', {
      added: result.configsAdded.length,
      updated: result.configsUpdated.length,
      removed: result.configsRemoved.length,
      rejected_cross_relay: result.rejectedCrossRelay,
      users_tracked: result.usersTracked,
    })
    if (result.rejectedCrossRelay > 0) {
      this.recordEvent(
        'isolation.cross_relay_rejected',
        'error',
        `${result.rejectedCrossRelay} config(s) for other relays rejected`,
      )
    }
  }

  private async applyDeltaPage(resp: RelaySyncEnvelope): Promise<void> {
    const result = this.manager.applyDelta(resp.data)
    await this.reconcileAdapters(result.configsRemoved, result.configsAdded, result.configsUpdated)
    this.log.info('sync.delta_applied', {
      added: result.configsAdded.length,
      updated: result.configsUpdated.length,
      removed: result.configsRemoved.length,
      rejected_cross_relay: result.rejectedCrossRelay,
    })
    if (result.rejectedCrossRelay > 0) {
      this.recordEvent(
        'isolation.cross_relay_rejected',
        'error',
        `${result.rejectedCrossRelay} config(s) for other relays rejected`,
      )
    }
  }

  /* ---------- adapter reconciliation (§10/§31) ---------- */

  /** Deterministic: resolves only after every start/stop settled. */
  private async reconcileAdapters(removed: string[], added: string[], updated: string[]): Promise<void> {
    for (const id of removed) await this.stopAssignment(id)

    for (const id of [...added, ...updated]) {
      const config = this.manager.get(id)
      if (!config) continue
      await this.startAssignment(config)
    }
  }

  private async stopAssignment(configId: string): Promise<void> {
    for (const adapter of this.registry.all()) {
      if (adapter.activeConfigIds().includes(configId)) {
        try {
          await adapter.stop(configId)
          this.log.info('adapter.stopped', { adapter: adapter.name, config_id: configId })
        } catch (err) {
          this.log.warn('adapter.stop_failed', { adapter: adapter.name, config_id: configId, detail: msg(err) })
        }
      }
    }
  }

  private async startAssignment(config: RelayConfigRecord): Promise<void> {
    if (config.enabled === false) {
      this.skippedConfigs++
      this.log.info('assignment.skipped_disabled', { config_id: config.id })
      return
    }
    const adapter = this.registry.forProtocol(config.protocol)
    if (!adapter) {
      this.skippedConfigs++
      this.log.warn('assignment.skipped_unknown_protocol', {
        config_id: config.id,
        protocol: config.protocol,
      })
      this.recordEvent('assignment.skipped', 'warning', `no adapter for protocol ${config.protocol}`)
      return
    }
    try {
      // restart-on-update semantics
      await adapter.stop(config.id)
      await adapter.start({ config, usage: this.collector, log: this.log })
    } catch (err) {
      this.skippedConfigs++
      this.log.error('assignment.start_failed', { config_id: config.id, detail: msg(err) })
      this.recordEvent('assignment.failed', 'error', `config ${config.id} failed to start`)
    }
  }

  /* ---------- HEARTBEAT (Prompt 7 §14) ---------- */

  async heartbeatOnce(): Promise<void> {
    if (this.hearting || this.state === 'auth_failed' || this.state === 'shutting_down') return
    this.hearting = true
    try {
      const payload: RelayHeartbeatRequest = {
        ts: this.nowS(),
        status: this.heartbeatStatus(),
        agent_version: this.config.softwareVersion,
        uptime_seconds: Math.floor((Date.now() - this.startedAtMs) / 1000),
        active_configs: this.manager.configCount(),
      }
      if (this.stateData.last_sync_cursor) payload.sync_cursor = this.stateData.last_sync_cursor

      const metadata = this.buildHeartbeatMetadata()
      if (metadata) payload.metadata = metadata

      const resp = await this.client.request<RelayHeartbeatResponseData>(
        'POST',
        API.relayHeartbeat(this.relayId),
        { body: payload },
      )

      this.hbFailures = 0
      this.stateData.last_heartbeat_ok_at = this.nowS()
      this.persistState()

      // server-driven catch-up (Prompt 4 §10.8 should_sync) + interval adaptation
      if (resp.should_sync) this.syncTrigger?.triggerNow()
      const serverInterval = resp.heartbeat_interval_seconds
      if (
        typeof serverInterval === 'number' &&
        serverInterval >= 10 &&
        serverInterval <= 600 &&
        serverInterval !== this.config.heartbeatIntervalS
      ) {
        this.heartbeatTrigger?.updateInterval(serverInterval * 1000)
      }

      this.log.debug('heartbeat.ok', {
        server_should_sync: resp.should_sync,
        status: payload.status,
        active_configs: payload.active_configs,
      })
    } finally {
      this.hearting = false
    }
  }

  /* ---------- USAGE (Prompt 7 §15/§16/§17) ---------- */

  async usageOnce(): Promise<void> {
    if (this.delivering || this.state === 'auth_failed' || this.state === 'shutting_down') return
    this.delivering = true
    try {
      this.drainCollectorIntoQueue()
      // deliver strictly FIFO until the head blocks (retry happens next tick)
      while (this.queue.metrics().depth > 0 && !this.isAuthFailed()) {
        const progressed = await this.deliverOldestReport()
        if (!progressed) break
      }
      if (this.queue.metrics().depth === 0) this.usageFailures = 0
    } finally {
      this.delivering = false
    }
  }

  private drainCollectorIntoQueue(): void {
    const now = this.nowS()
    const reports = this.collector.drain(
      now - this.config.usageFlushIntervalS,
      now,
      now,
      (configId) => this.manager.userOf(configId),
    )
    for (const report of reports) {
      const res = this.queue.enqueue(report.entries, report.generated_at, now)
      if (res.droppedOldest > 0) {
        this.log.error('queue.dropped_oldest', { count: res.droppedOldest })
        this.recordEvent('queue.dropped', 'critical', `${res.droppedOldest} oldest report(s) dropped (buffer full)`)
      }
      const m = this.queue.metrics()
      if (m.full) this.recordEvent('queue.full', 'critical', 'offline buffer is full')
      else if (m.nearLimit) this.recordEvent('queue.near_limit', 'warning', 'offline buffer near limit')
    }
    if (reports.length > 0) {
      this.log.info('usage.enqueued', { reports: reports.length, depth: this.queue.metrics().depth })
    }
  }

  /**
   * Deliver the OLDEST pending report. Returns true when the head advanced
   * (ack/reject/regen), false when delivery must wait (retryable error).
   */
  private async deliverOldestReport(): Promise<boolean> {
    const item = this.queue.oldest()
    if (!item) return false
    this.queue.bumpAttempts(item.report_id)

    const body: RelayUsageReportRequest = {
      report_id: item.report_id,
      generated_at: item.generated_at,
      entries: item.entries,
    }

    try {
      const ack = await this.client.request<RelayUsageAckData>('POST', API.relayUsage(this.relayId), {
        body,
      })
      // ACK received → only NOW may the report leave the queue (§16)
      this.queue.ackAccepted([ack.report_id])
      this.usageFailures = 0
      this.stateData.last_usage_ack_at = this.nowS()
      this.persistState()
      this.log.info('usage.acked', { report_id: ack.report_id, status: ack.status })
      return true
    } catch (err) {
      const apiErr = err instanceof RelayApiError ? err : null
      this.handleLoopError('usage', err)

      if (!apiErr) return false

      if (apiErr.kind === 'permanent') {
        // All-or-nothing rejection (Prompt 4 §10.9): never resend the same
        // payload. 422 + details[] → drop the invalid entries and re-queue the
        // remainder under a NEW report_id; any other 4xx payload error is
        // dead-lettered whole. The head ALWAYS advances deterministically.
        const invalid = apiErr.status === 422 ? extractInvalidConfigIds(apiErr.details) : null
        const keep = invalid ? item.entries.filter((e) => !invalid.has(e.config_id)) : []
        this.queue.reject(item.report_id, `payload_rejected_${apiErr.status}`)
        this.log.error('usage.rejected_4xx', {
          report_id: item.report_id,
          status: apiErr.status,
          invalid_entries: invalid ? invalid.size : item.entries.length,
          kept_entries: keep.length,
        })
        if (keep.length > 0) {
          this.queue.enqueue(keep, item.generated_at, this.nowS())
        }
        this.recordEvent('usage.delivery_failed', 'error', `report rejected (${apiErr.status})`)
        return true
      }

      if (apiErr.kind === 'not_found') {
        // relay/config scope vanished server-side — do not retry forever
        this.queue.reject(item.report_id, 'not_found')
        this.recordEvent('usage.delivery_failed', 'error', 'report dropped (404)')
        return true
      }

      if (apiErr.kind === 'conflict') {
        // IDEMPOTENCY_CONFLICT: our report_id collided with a different payload
        // → deterministic recovery: dead-letter the id, re-queue under new id.
        this.queue.reject(item.report_id, 'idempotency_conflict')
        this.queue.enqueue(item.entries, item.generated_at, this.nowS())
        this.log.error('usage.idempotency_conflict', { report_id: item.report_id })
        this.recordEvent('usage.delivery_failed', 'error', 'report_id conflict; regenerated')
        return true
      }

      if (apiErr.kind === 'auth' || apiErr.kind === 'forbidden' || apiErr.kind === 'gone') {
        this.handleAuthOrGone(apiErr)
        return false
      }

      // retryable (429/5xx/network/503) — keep the report, wait for next tick
      this.log.warn('usage.delivery_deferred', {
        report_id: item.report_id,
        kind: apiErr.kind,
        code: apiErr.code,
      })
      return false
    }
  }

  /* ---------- error handling / state machine ---------- */

  private isAuthFailed(): boolean {
    // method (not a field compare) so TS never narrows the state union —
    // handleAuthOrGone may flip it mid-await
    return this.state === 'auth_failed'
  }

  private handleLoopError(loop: 'sync' | 'heartbeat' | 'usage', err: unknown): void {
    if (err instanceof RelayApiError) {
      if (err.kind === 'auth' || err.kind === 'forbidden' || err.kind === 'gone') {
        this.handleAuthOrGone(err)
        return
      }
      if (loop === 'sync') this.syncFailures++
      if (loop === 'heartbeat') this.hbFailures++
      if (loop === 'usage') this.usageFailures++
      this.lastError = { kind: loop, code: err.code, at: this.nowS() }
      this.log.warn(`${loop}.failed`, { kind: err.kind, code: err.code })
      this.recordEvent(
        loop === 'usage' ? 'usage.delivery_failed' : `${loop}.failed`,
        'warning',
        err.code,
      )
      if (this.state === 'running' || this.state === 'syncing') this.state = 'degraded'
      return
    }
    this.log.error(`${loop}.failed_unexpected`, { detail: msg(err) })
    if (this.state === 'running' || this.state === 'syncing') this.state = 'degraded'
  }

  /** Prompt 7 §30: 401/403/410 → AUTH_FAILED, no infinite retry, no secret. */
  private handleAuthOrGone(err: RelayApiError): void {
    this.lastError = { kind: err.kind, code: err.code, at: this.nowS() }
    this.state = 'auth_failed'
    this.log.error('relay.auth_failed', { kind: err.kind, code: err.code })
    this.recordEvent(
      'auth.failed',
      'critical',
      err.kind === 'gone' ? 'relay deleted on Control Plane (410)' : 'relay token rejected (401/403)',
    )
  }

  private heartbeatStatus(): RelayHeartbeatRequest['status'] {
    if (this.state === 'auth_failed') return 'error'
    const m = this.queue.metrics()
    if (
      this.state === 'degraded' ||
      m.full ||
      this.syncFailures >= 3 ||
      this.hbFailures >= 3 ||
      this.usageFailures >= 5
    ) {
      return 'degraded'
    }
    return 'online'
  }

  /** test/ops visibility */
  failureCounters(): { sync: number; heartbeat: number; usage: number } {
    return { sync: this.syncFailures, heartbeat: this.hbFailures, usage: this.usageFailures }
  }

  /** test/ops visibility — the status the next heartbeat would report */
  computeHeartbeatStatus(): RelayHeartbeatRequest['status'] {
    return this.heartbeatStatus()
  }

  /* ---------- heartbeat metadata (Prompt 7 §29) ---------- */

  buildHeartbeatMetadata(): Record<string, string | number | boolean> | undefined {
    const m = this.queue.metrics()
    const entries: [string, string | number | boolean][] = [
      ['last_error_kind', this.lastError?.kind ?? ''],
      ['last_error_code', this.lastError?.code ?? ''],
      ['last_error_at', this.lastError?.at ?? 0],
      ['queue_depth', m.depth],
      ['queue_cap', this.config.queueMaxReports],
      ['queue_bytes', m.bytes],
      ['queue_full', m.full],
      ['queue_near', m.nearLimit],
      ['pending_reports', this.collector.pendingConfigCount()],
      ['skipped_configs', this.skippedConfigs],
      ['sync_failures', this.syncFailures],
      ['hb_failures', this.hbFailures],
      ['usage_failures', this.usageFailures],
      ['last_sync_at', this.stateData.last_sync_at ?? 0],
      ['last_usage_ack_at', this.stateData.last_usage_ack_at ?? 0],
      ['uptime_min', Math.floor((Date.now() - this.startedAtMs) / 60000)],
    ]
    // deterministic trim to the ≤16 keys / ≤2KB envelope (Prompt 4 §10.8)
    const trimmed = entries.slice(0, HEARTBEAT_METADATA_MAX_KEYS)
    let out: Record<string, string | number | boolean> = {}
    for (const [k, v] of trimmed) out[k] = v
    while (JSON.stringify(out).length > HEARTBEAT_METADATA_MAX_BYTES && trimmed.length > 3) {
      trimmed.pop()
      out = {}
      for (const [k, v] of trimmed) out[k] = v
    }
    return out
  }

  /* ---------- events (ring + throttle) ---------- */

  recentEvents(): RelayEvent[] {
    return [...this.events]
  }

  private recordEvent(code: string, severity: RelayEvent['severity'], detail: string): void {
    const now = Date.now()
    const last = this.eventThrottle.get(code)
    if (last !== undefined && now - last < EVENT_THROTTLE_MS && !CRITICAL_CODES.has(code)) {
      return
    }
    if (CRITICAL_CODES.has(code)) {
      this.criticalEventTimestamps = this.criticalEventTimestamps.filter((t) => now - t < 60_000)
      if (this.criticalEventTimestamps.length >= CRITICAL_EVENT_MAX_PER_MIN) return
      this.criticalEventTimestamps.push(now)
    }
    this.eventThrottle.set(code, now)
    this.events.push({ code, at: this.nowS(), severity })
    if (this.events.length > EVENT_RING_SIZE) this.events.shift()
    // structured log = the outbound carrier for operators; Control Plane
    // signals ride heartbeat metadata (GAP-R2 for a dedicated channel)
    const logFn =
      severity === 'critical' || severity === 'error'
        ? this.log.error.bind(this.log)
        : this.log.warn.bind(this.log)
    logFn('relay.event', { code, severity, detail })
  }

  /* ---------- misc ---------- */

  private buildTriggers(): void {
    const base = { backoffMultiplier: 2, jitterRatio: 0.1 }
    this.syncTrigger = new IntervalTrigger(
      'sync',
      () => this.syncOnce(),
      {
        ...base,
        intervalMs: this.config.syncIntervalS * 1000,
        onError: (e) => this.handleLoopError('sync', e),
      },
    )
    this.heartbeatTrigger = new IntervalTrigger(
      'heartbeat',
      () => this.heartbeatOnce(),
      {
        ...base,
        intervalMs: this.config.heartbeatIntervalS * 1000,
        onError: (e) => this.handleLoopError('heartbeat', e),
      },
    )
    this.usageTrigger = new IntervalTrigger(
      'usage',
      () => this.usageOnce(),
      {
        ...base,
        intervalMs: this.config.usageFlushIntervalS * 1000,
        onError: (e) => this.handleLoopError('usage', e),
      },
    )
  }

  private persistState(): void {
    try {
      this.store.save(this.stateData)
    } catch (err) {
      this.log.warn('state.persist_failed', { detail: msg(err) })
    }
  }

  healthSnapshot(): LocalHealthSnapshot {
    const m = this.queue.metrics()
    return {
      state: this.state,
      uptime_s: Math.floor((Date.now() - this.startedAtMs) / 1000),
      software_version: this.config.softwareVersion,
      active_configs: this.manager.configCount(),
      active_adapters: this.registry.all().flatMap((a) => a.activeConfigIds()),
      skipped_configs: this.skippedConfigs,
      queue_depth: m.depth,
      queue_cap: this.config.queueMaxReports,
      queue_bytes: m.bytes,
      queue_full: m.full,
      queue_near_limit: m.nearLimit,
      pending_reports: this.collector.pendingConfigCount(),
      last_sync_at: this.stateData.last_sync_at,
      last_heartbeat_ok_at: this.stateData.last_heartbeat_ok_at,
      last_usage_ack_at: this.stateData.last_usage_ack_at,
      last_error: this.lastError,
    }
  }

  localState(): RelayLocalState {
    return { ...this.stateData }
  }

  /** actual bound health port (0-config → OS-assigned) */
  healthPort(): number | null {
    return this.healthServer?.httpPort ?? null
  }

  managerRef(): AssignmentManager {
    return this.manager
  }

  collectorRef(): UsageCollector {
    return this.collector
  }

  queueRef(): OfflineUsageQueue {
    return this.queue
  }

  /** test/ops hook: run a single loop iteration manually (trigger semantics:
   * errors are handled by the state machine, not propagated to the caller) */
  async runLoopOnce(loop: 'sync' | 'heartbeat' | 'usage'): Promise<void> {
    try {
      if (loop === 'sync') return await this.syncOnce()
      if (loop === 'heartbeat') return await this.heartbeatOnce()
      return await this.usageOnce()
    } catch (err) {
      this.handleLoopError(loop, err)
    }
  }
}

/* ---------- helpers ---------- */

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Defensive parse of 422 details[] → set of invalid config_ids (Prompt 4 §10.9). */
function extractInvalidConfigIds(details: unknown): Set<string> | null {
  if (!Array.isArray(details)) return null
  const ids = new Set<string>()
  for (const d of details) {
    if (d && typeof d === 'object') {
      const cid = (d as Record<string, unknown>)['config_id']
      if (typeof cid === 'string') ids.add(cid)
    } else if (typeof d === 'string') {
      ids.add(d)
    }
  }
  return ids.size > 0 ? ids : null
}

/**
 * Local health HTTP endpoint — Prompt 7 §21/§22/§27.
 *
 * Two-level health model:
 *  - /healthz       → liveness for Railway/Docker (always 200 while the
 *                     process can serve; deliberately minimal so a broken
 *                     config does NOT turn into a restart loop)
 *  - /healthz/local → full LOCAL health snapshot (read-only, no secrets)
 *
 * This is NOT a management API (§2/§27): GET-only, no mutation, no auth
 * surface beyond a read-only snapshot, bind configurable via HEALTH_BIND
 * (set 127.0.0.1 to restrict). Control-Plane health is derived by the PANEL
 * from heartbeats — it is never exposed here.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Logger } from '../log'

export interface LocalHealthSnapshot {
  /** local process view — NOT the Control-Plane health (§21) */
  state: string
  uptime_s: number
  software_version: string
  active_configs: number
  active_adapters: string[]
  skipped_configs: number
  queue_depth: number
  queue_cap: number
  queue_bytes: number
  queue_full: boolean
  queue_near_limit: boolean
  pending_reports: number
  last_sync_at: number | null
  last_heartbeat_ok_at: number | null
  last_usage_ack_at: number | null
  last_error: { kind: string; code: string; at: number } | null
}

export class HealthServer {
  private server: Server | null = null
  /** actual bound port (useful when configured as 0 = ephemeral) */
  httpPort: number | null = null

  constructor(
    private readonly bind: string,
    private readonly port: number,
    private readonly snapshot: () => LocalHealthSnapshot,
    private readonly log: Logger,
  ) {}

  async start(): Promise<void> {
    if (this.server) return
    const server = createServer((req, res) => this.handle(req, res))
    this.server = server
    await new Promise<void>((resolvePromise, rejectPromise) => {
      server.once('error', rejectPromise)
      server.listen(this.port, this.bind, () => {
        server.removeListener('error', rejectPromise)
        const addr = server.address()
        if (addr && typeof addr === 'object') this.httpPort = addr.port
        this.log.info('health.listening', { bind: this.bind, port: this.httpPort ?? this.port })
        resolvePromise()
      })
    })
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return
    await new Promise<void>((resolvePromise) => {
      server.close(() => resolvePromise())
      setTimeout(resolvePromise, 1500).unref?.()
    })
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'method_not_allowed' }))
      return
    }
    const url = (req.url ?? '').split('?')[0]
    if (url === '/healthz') {
      const snap = this.snapshot()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, uptime_s: snap.uptime_s, software_version: snap.software_version }))
      return
    }
    if (url === '/healthz/local') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(this.snapshot()))
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not_found' }))
  }
}

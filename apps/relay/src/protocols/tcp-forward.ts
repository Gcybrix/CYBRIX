/**
 * tcp-forward — v1 reference ProtocolAdapter (Prompt 7 §31).
 *
 * Fully working generic TCP forwarder:
 *   client → relay listen port → destination host:port
 * with per-config byte accounting in BOTH directions (BigInt).
 *
 * Assignment parameters (GAP-R1 — defined here until the contract answers):
 *   parameters.listen_port      int  1..65535 (required)
 *   parameters.destination_host string (required)
 *   parameters.destination_port int  1..65535 (required)
 *   parameters.idle_timeout_s   int  (optional, default 300)
 *
 * A credential on a tcp-forward config is ignored (pass-through plane) and
 * is NEVER logged (§11/§28).
 */

import { createServer, connect, type Server, type Socket } from 'node:net'
import type { RelayConfigRecord } from '@cybrix/shared-types'
import { AdapterConfigError, type AssignmentContext, type ProtocolAdapter } from './adapter'

const DEFAULT_IDLE_TIMEOUT_S = 300
const MAX_SOCKETS_PER_CONFIG = 1024

interface ForwardParams {
  listenPort: number
  destinationHost: string
  destinationPort: number
  idleTimeoutMs: number
}

function parseParams(config: RelayConfigRecord): ForwardParams {
  const p = (config.parameters ?? {}) as Record<string, unknown>
  const listenPort = p['listen_port']
  const destinationHost = p['destination_host']
  const destinationPort = p['destination_port']

  if (typeof listenPort !== 'number' || !Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
    throw new AdapterConfigError('tcp-forward requires parameters.listen_port (1..65535)')
  }
  if (typeof destinationHost !== 'string' || destinationHost.trim() === '') {
    throw new AdapterConfigError('tcp-forward requires parameters.destination_host')
  }
  if (
    typeof destinationPort !== 'number' ||
    !Number.isInteger(destinationPort) ||
    destinationPort < 1 ||
    destinationPort > 65535
  ) {
    throw new AdapterConfigError('tcp-forward requires parameters.destination_port (1..65535)')
  }
  const idleTimeoutS =
    typeof p['idle_timeout_s'] === 'number' && p['idle_timeout_s'] > 0
      ? p['idle_timeout_s']
      : DEFAULT_IDLE_TIMEOUT_S
  return {
    listenPort,
    destinationHost: destinationHost.trim(),
    destinationPort,
    idleTimeoutMs: idleTimeoutS * 1000,
  }
}

export class TcpForwardAdapter implements ProtocolAdapter {
  readonly name = 'tcp-forward'
  readonly protocols = ['tcp-forward'] as const

  private servers = new Map<string, { server: Server; sockets: Set<Socket>; params: ForwardParams }>()

  async start(ctx: AssignmentContext): Promise<void> {
    const { config, usage, log } = ctx
    if (this.servers.has(config.id)) return // idempotent apply
    const params = parseParams(config)

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const server: Server = createServer()
      const sockets = new Set<Socket>()
      let settled = false

      server.on('connection', (clientSocket: Socket) => {
        if (sockets.size >= MAX_SOCKETS_PER_CONFIG) {
          clientSocket.destroy()
          return
        }
        sockets.add(clientSocket)
        clientSocket.setNoDelay(true)

        const upstream = connect(
          { host: params.destinationHost, port: params.destinationPort },
          () => {
            upstream.setNoDelay(true)
            clientSocket.resume()
          },
        )

        const armIdle = (): void => {
          clientSocket.setTimeout(params.idleTimeoutMs)
          upstream.setTimeout(params.idleTimeoutMs)
        }
        armIdle()

        // manual forwarding (NOT pipe): the byte-counting 'data' listeners put
        // the sockets in flowing mode, so pipe() would silently lose whatever
        // arrives before the upstream connect callback attaches it.
        clientSocket.on('data', (chunk: Buffer) => {
          usage.add(config.id, BigInt(chunk.length), 0n)
          if (upstream.writable) upstream.write(chunk)
        })
        upstream.on('data', (chunk: Buffer) => {
          usage.add(config.id, 0n, BigInt(chunk.length))
          if (clientSocket.writable) clientSocket.write(chunk)
        })

        const teardown = (): void => {
          clientSocket.destroy()
          upstream.destroy()
        }
        clientSocket.on('close', () => {
          sockets.delete(clientSocket)
          upstream.destroy()
        })
        upstream.on('close', () => {
          clientSocket.destroy()
        })
        clientSocket.on('timeout', teardown)
        upstream.on('timeout', teardown)
        clientSocket.on('error', () => teardown())
        upstream.on('error', () => teardown())
      })

      server.on('error', (err: Error) => {
        if (!settled) {
          settled = true
          rejectPromise(new AdapterConfigError(`listen ${params.listenPort} failed: ${err.message}`))
        } else {
          log.warn('adapter.error', { adapter: this.name, config_id: config.id, detail: err.message })
        }
      })

      server.listen(params.listenPort, '0.0.0.0', () => {
        settled = true
        this.servers.set(config.id, { server, sockets, params })
        log.info('adapter.started', {
          adapter: this.name,
          config_id: config.id,
          listen_port: params.listenPort,
        })
        resolvePromise()
      })
    })
  }

  async stop(configId: string): Promise<void> {
    const entry = this.servers.get(configId)
    if (!entry) return
    this.servers.delete(configId)
    for (const s of entry.sockets) s.destroy()
    entry.sockets.clear()
    await new Promise<void>((resolvePromise) => {
      entry.server.close(() => resolvePromise())
      // never hang shutdown on a stubborn listener
      setTimeout(resolvePromise, 2000).unref?.()
    })
  }

  async stopAll(): Promise<void> {
    const ids = [...this.servers.keys()]
    for (const id of ids) await this.stop(id)
  }

  activeConfigIds(): string[] {
    return [...this.servers.keys()]
  }
}

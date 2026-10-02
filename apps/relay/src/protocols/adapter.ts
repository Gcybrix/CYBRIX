/**
 * Protocol abstraction — Prompt 7 §31.
 *
 * The relay runtime NEVER hardcodes a protocol. Every data-plane behavior is
 * a ProtocolAdapter registered against protocol names (the `configs.protocol`
 * field is deliberately open per Prompt 3).
 *
 * v1 ships exactly ONE reference adapter (`tcp-forward`) — a fully working
 * generic TCP forwarder — because that is the only data plane fully defined
 * by the current contract. Real protocol adapters (vless/vmess/trojan/ss)
 * plug in WITHOUT touching Control Plane code once GAP-R1 (per-protocol
 * data-plane parameter schema) is answered. See docs/DESIGN.md §GAP-R1.
 */

import type { RelayConfigRecord } from '@cybrix/shared-types'
import type { Logger } from '../log'

export interface UsageSink {
  /** config-scoped byte accounting (BigInt, decimal-string safe) */
  add(configId: string, bytesUp: bigint, bytesDown: bigint): void
}

export interface AssignmentContext {
  config: RelayConfigRecord
  usage: UsageSink
  log: Logger
}

export interface ProtocolAdapter {
  readonly name: string
  /** protocol values this adapter can execute */
  readonly protocols: readonly string[]
  start(ctx: AssignmentContext): Promise<void>
  stop(configId: string): Promise<void>
  stopAll(): Promise<void>
  activeConfigIds(): string[]
}

export class AdapterRegistry {
  private adapters: ProtocolAdapter[] = []

  register(adapter: ProtocolAdapter): void {
    this.adapters.push(adapter)
  }

  forProtocol(protocol: string): ProtocolAdapter | undefined {
    return this.adapters.find((a) => a.protocols.includes(protocol))
  }

  all(): ProtocolAdapter[] {
    return [...this.adapters]
  }
}

export class AdapterConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdapterConfigError'
  }
}

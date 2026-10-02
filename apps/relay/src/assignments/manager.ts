/**
 * Assignment manager — Prompt 7 §10/§26 + Prompt 4 §10.7.
 *
 * Holds the relay's operational view of: its own relay record, assigned
 * configs (FULL records incl. minimum-necessary credential), and the owner
 * user subset. All of it lives in MEMORY ONLY (§11/§13) — nothing here is
 * ever written to disk.
 *
 * Server-side authorization is authoritative (the API only ever returns this
 * relay's rows); the manager still re-checks every record (defense in depth):
 *  - a config whose relay_id ≠ self is REJECTED and counted (never stored)
 *  - a sync response claiming a foreign relay identity is FATAL (misconfig)
 *  - unassign stubs remove configs from the runtime (Prompt 4 §10.7 §12.4)
 */

import type {
  RelayConfigRecord,
  RelaySelfRecord,
  RelaySyncData,
  RelayUserRecord,
  UnassignStub,
} from '@cybrix/shared-types'

export class RelayIdentityMismatchError extends Error {
  constructor(readonly expectedId: string, readonly receivedId: string) {
    super(`sync response belongs to a different relay (expected ${expectedId}, received ${receivedId})`)
    this.name = 'RelayIdentityMismatchError'
  }
}

export interface SyncApplyResult {
  fullSync: boolean
  configsAdded: string[]
  configsUpdated: string[]
  configsRemoved: string[]
  rejectedCrossRelay: number
  usersTracked: number
}

export interface SyncPageAccumulator {
  relay: RelaySelfRecord | null
  configs: RelayConfigRecord[]
  users: RelayUserRecord[]
  rejectedCrossRelay: number
}

export class AssignmentManager {
  private configs = new Map<string, RelayConfigRecord>()
  private users = new Map<string, RelayUserRecord>()
  private relaySelf: RelaySelfRecord | null = null

  constructor(private readonly selfRelayId: string) {}

  /** Validate the relay block of a sync response (§26 isolation). */
  assertRelayIdentity(data: RelaySyncData): RelaySelfRecord | null {
    const rec = data.relays[0]
    if (rec && rec.id !== this.selfRelayId) {
      throw new RelayIdentityMismatchError(this.selfRelayId, rec.id)
    }
    return rec ?? null
  }

  /**
   * Apply one sync response INCREMENTALLY (delta mode).
   * Stubs remove; full rows upsert; foreign-relay configs rejected.
   */
  applyDelta(data: RelaySyncData): SyncApplyResult {
    const relayRec = this.assertRelayIdentity(data)
    if (relayRec) this.relaySelf = relayRec

    const result: SyncApplyResult = {
      fullSync: false,
      configsAdded: [],
      configsUpdated: [],
      configsRemoved: [],
      rejectedCrossRelay: 0,
      usersTracked: 0,
    }

    for (const row of data.configs) {
      if (isStub(row)) {
        if (this.configs.delete(row.id)) result.configsRemoved.push(row.id)
        continue
      }
      if (row.relay_id !== this.selfRelayId) {
        result.rejectedCrossRelay++
        continue
      }
      const existing = this.configs.get(row.id)
      this.configs.set(row.id, row)
      if (!existing) result.configsAdded.push(row.id)
      else if (existing.version !== row.version) result.configsUpdated.push(row.id)
    }

    this.mergeUsers(data, result)
    return result
  }

  /** Begin a FULL snapshot (multi-page): collect first, replace atomically. */
  beginFullSync(): SyncPageAccumulator {
    return { relay: null, configs: [], users: [], rejectedCrossRelay: 0 }
  }

  /** Validate + collect one page of a full snapshot. */
  accumulateFullPage(acc: SyncPageAccumulator, data: RelaySyncData): void {
    const relayRec = this.assertRelayIdentity(data)
    if (relayRec) acc.relay = relayRec
    for (const row of data.configs) {
      if (isStub(row)) continue // full snapshot has no stubs, but stay safe
      if (row.relay_id !== this.selfRelayId) {
        acc.rejectedCrossRelay++
        continue
      }
      acc.configs.push(row)
    }
    acc.users.push(...data.users)
  }

  /** Atomically swap the runtime to the collected full snapshot. */
  commitFullSync(acc: SyncPageAccumulator): SyncApplyResult {
    if (acc.relay) this.relaySelf = acc.relay
    const result: SyncApplyResult = {
      fullSync: true,
      configsAdded: [],
      configsUpdated: [],
      configsRemoved: [],
      rejectedCrossRelay: acc.rejectedCrossRelay,
      usersTracked: 0,
    }

    const next = new Map<string, RelayConfigRecord>()
    for (const c of acc.configs) next.set(c.id, c)

    for (const [id] of this.configs) {
      if (!next.has(id)) result.configsRemoved.push(id)
    }
    for (const [id, c] of next) {
      const prev = this.configs.get(id)
      if (!prev) result.configsAdded.push(id)
      else if (prev.version !== c.version) result.configsUpdated.push(id)
    }
    this.configs = next

    this.users = new Map(acc.users.map((u) => [u.id, u]))
    result.usersTracked = this.users.size
    return result
  }

  get(configId: string): RelayConfigRecord | undefined {
    return this.configs.get(configId)
  }

  userOf(configId: string): string | undefined {
    return this.configs.get(configId)?.user_id
  }

  user(id: string): RelayUserRecord | undefined {
    return this.users.get(id)
  }

  activeConfigs(): RelayConfigRecord[] {
    return [...this.configs.values()]
  }

  relayRecord(): RelaySelfRecord | null {
    return this.relaySelf
  }

  configCount(): number {
    return this.configs.size
  }

  private mergeUsers(data: RelaySyncData, result: SyncApplyResult): void {
    for (const u of data.users) this.users.set(u.id, u)
    result.usersTracked = this.users.size
  }
}

export function isStub(row: RelaySyncData['configs'][number]): row is UnassignStub {
  return (row as UnassignStub).op === 'unassigned'
}

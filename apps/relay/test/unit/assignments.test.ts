import { describe, expect, it } from 'vitest'
import {
  AssignmentManager,
  RelayIdentityMismatchError,
} from '../../src/assignments/manager'
import { syncEnvelope } from '../helpers'
import {
  CONFIG2_ID,
  CONFIG_ID,
  OTHER_RELAY_ID,
  RELAY_ID,
  USER2_ID,
  USER_ID,
  configFixture,
  userFixture,
} from '../helpers'

describe('assignment manager (Prompt 7 §10/§26)', () => {
  it('applies a full snapshot atomically and diffs it', () => {
    const m = new AssignmentManager(RELAY_ID)
    const acc = m.beginFullSync()
    m.accumulateFullPage(
      acc,
      syncEnvelope({ relays: [{ id: RELAY_ID, name: 'r', status: 'active', version: 1, updated_at: 1, deleted_at: null }], configs: [configFixture()], users: [userFixture()] }).data,
    )
    const result = m.commitFullSync(acc)
    expect(result.fullSync).toBe(true)
    expect(result.configsAdded).toEqual([CONFIG_ID])
    expect(m.configCount()).toBe(1)
    expect(m.userOf(CONFIG_ID)).toBe(USER_ID)
    expect(m.relayRecord()?.id).toBe(RELAY_ID)
  })

  it('applies incremental deltas: add / update / unassign stub', () => {
    const m = new AssignmentManager(RELAY_ID)
    m.applyDelta(syncEnvelope({ configs: [configFixture()], users: [userFixture()] }).data)

    const updated = configFixture({ version: 2, updated_at: 2 })
    const r2 = m.applyDelta(syncEnvelope({ configs: [updated] }).data)
    expect(r2.configsUpdated).toEqual([CONFIG_ID])

    const r3 = m.applyDelta(
      syncEnvelope({ configs: [{ id: CONFIG_ID, version: 3, updated_at: 3, op: 'unassigned' }] }).data,
    )
    expect(r3.configsRemoved).toEqual([CONFIG_ID])
    expect(m.configCount()).toBe(0)
  })

  it('REJECTS configs belonging to another relay (cross-relay isolation)', () => {
    const m = new AssignmentManager(RELAY_ID)
    const foreign = configFixture({ id: CONFIG2_ID, relay_id: OTHER_RELAY_ID, user_id: USER2_ID })
    const result = m.applyDelta(syncEnvelope({ configs: [configFixture(), foreign] }).data)
    expect(result.rejectedCrossRelay).toBe(1)
    expect(m.get(CONFIG2_ID)).toBeUndefined()
    expect(m.get(CONFIG_ID)).toBeDefined()
  })

  it('treats a sync response for a DIFFERENT relay as a fatal identity mismatch', () => {
    const m = new AssignmentManager(RELAY_ID)
    expect(() =>
      m.applyDelta(
        syncEnvelope({
          relays: [{ id: OTHER_RELAY_ID, name: 'other', status: 'active', version: 1, updated_at: 1, deleted_at: null }],
        }).data,
      ),
    ).toThrow(RelayIdentityMismatchError)
  })

  it('keeps the owner user subset for usage attribution only', () => {
    const m = new AssignmentManager(RELAY_ID)
    m.applyDelta(
      syncEnvelope({
        configs: [configFixture(), configFixture({ id: CONFIG2_ID, user_id: USER2_ID })],
        users: [userFixture(), userFixture({ id: USER2_ID })],
      }).data,
    )
    expect(m.userOf(CONFIG_ID)).toBe(USER_ID)
    expect(m.userOf(CONFIG2_ID)).toBe(USER2_ID)
    expect(m.user(USER_ID)?.status).toBe('active')
  })
})

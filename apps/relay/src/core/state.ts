/**
 * Local state store — Prompt 7 §13. Ephemeral/operational state ONLY;
 * D1 (Control Plane) remains the Source of Truth.
 *
 * Persisted atomically (tmp + rename) so a crash can never leave a torn file.
 * Stored on disk: cursors/timestamps ONLY — never tokens, never credentials,
 * never assignment payloads.
 */

import { existsSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

export interface RelayLocalState {
  schema: 1
  last_sync_cursor: string | null
  last_sync_at: number | null
  last_heartbeat_ok_at: number | null
  last_usage_ack_at: number | null
  started_at: number
}

export function defaultState(nowS: number): RelayLocalState {
  return {
    schema: 1,
    last_sync_cursor: null,
    last_sync_at: null,
    last_heartbeat_ok_at: null,
    last_usage_ack_at: null,
    started_at: nowS,
  }
}

export function isRelayLocalState(v: unknown): v is RelayLocalState {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  return s['schema'] === 1 && typeof s['started_at'] === 'number'
}

export class LocalStateStore {
  private readonly filePath: string

  constructor(
    dataDir: string,
    private readonly nowS: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    this.filePath = join(dataDir, 'state.json')
  }

  /** Returns (state, recoveredCorrupt). Corrupt file is quarantined, never fatal. */
  load(): { state: RelayLocalState; recoveredCorrupt: boolean } {
    if (!existsSync(this.filePath)) {
      return { state: defaultState(this.nowS()), recoveredCorrupt: false }
    }
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!isRelayLocalState(parsed)) throw new Error('bad shape')
      // keep process-lifetime started_at fresh; persisted one is advisory
      return { state: { ...parsed, started_at: this.nowS() }, recoveredCorrupt: false }
    } catch {
      try {
        renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`)
      } catch {
        /* best effort quarantine */
      }
      return { state: defaultState(this.nowS()), recoveredCorrupt: true }
    }
  }

  save(state: RelayLocalState): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
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

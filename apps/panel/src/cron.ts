/**
 * Monthly traffic reset (Prompt 3 decision; Prompt 4 §10.2.1). Runs from the
 * daily Cron Trigger; only resets users whose effective reset day has occurred
 * since their last reset. Idempotent under duplicate cron executions because
 * traffic_last_reset_at is compared before the UPDATE (state-based guard).
 * Audit actor = system, action = user.traffic_reset.
 */
import type { Env } from './env'

export async function runTrafficReset(env: Env, now: number): Promise<{ reset: number; scanned: number }> {
  const settingsRow = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'traffic_reset_default_day'`).first<{ value: string }>()
  const defaultDay = settingsRow ? Number(JSON.parse(settingsRow.value)) : 1
  const nowDate = new Date(now * 1000)
  const users = await env.DB.prepare(
    `SELECT id, traffic_reset_day, traffic_last_reset_at, traffic_used_bytes FROM users WHERE deleted_at IS NULL AND status = 'active'`,
  ).all<{ id: string; traffic_reset_day: number | null; traffic_last_reset_at: number | null; traffic_used_bytes: bigint | number }>()
  let reset = 0
  for (const u of users.results ?? []) {
    const day = Math.min(u.traffic_reset_day ?? defaultDay, 28)
    // most recent due reset date strictly after traffic_last_reset_at
    const candidate = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), day))
    if (candidate.getTime() > now * 1000) {
      candidate.setUTCMonth(candidate.getUTCMonth() - 1)
    }
    const dueTs = Math.floor(candidate.getTime() / 1000)
    if (u.traffic_last_reset_at !== null && u.traffic_last_reset_at >= dueTs) continue
    // conditional UPDATE: only if traffic_last_reset_at is still behind dueTs
    const res = await env.DB.prepare(
      `UPDATE users SET traffic_used_bytes = 0, traffic_last_reset_at = ? WHERE id = ? AND (traffic_last_reset_at IS NULL OR traffic_last_reset_at < ?)`,
    )
      .bind(dueTs, u.id, dueTs)
      .run()
    if (res.meta.changes && res.meta.changes > 0) {
      reset++
      const metadata = JSON.stringify({ due_at: dueTs, reset_day: day, previous_used_bytes: typeof u.traffic_used_bytes === 'bigint' ? u.traffic_used_bytes.toString() : String(u.traffic_used_bytes) })
      await env.DB.prepare(
        `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata, request_id, created_at) VALUES ('system', NULL, 'user.traffic_reset', 'user', ?, ?, NULL, ?)`,
      )
        .bind(u.id, metadata, now)
        .run()
    }
  }
  return { reset, scanned: (users.results ?? []).length }
}

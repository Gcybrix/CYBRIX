/** D1 helpers for the builder DB + idempotent migration runner (name = 'builder-v1'). */
import { BUILDER_SCHEMA_STATEMENTS } from '../../../packages/database/schema';
import type { InstallData } from './types';

const MIGRATION_NAME = 'builder-v1';
let migrated = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (migrated) return;
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`)
    .run();
  const done = await db.prepare(`SELECT name FROM schema_migrations WHERE name = ?`).bind(MIGRATION_NAME).first();
  if (!done) {
    for (const stmt of BUILDER_SCHEMA_STATEMENTS) {
      await db.prepare(stmt).run(); // CREATE ... IF NOT EXISTS — idempotent per statement
    }
    await db
      .prepare(`INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`)
      .bind(MIGRATION_NAME, Math.floor(Date.now() / 1000))
      .run();
  }
  migrated = true;
}

export const now = () => Math.floor(Date.now() / 1000);

export async function audit(
  db: D1Database,
  actor: number | null,
  action: string,
  targetType = '',
  targetId: string | number = '',
  meta = ''
) {
  await db
    .prepare(`INSERT INTO audit_events (actor_tid, action, target_type, target_id, meta, created_at) VALUES (?,?,?,?,?,?)`)
    .bind(actor, action, targetType, String(targetId), meta, now())
    .run();
}

/** Wizard steps kept in the `step` column of wizard_state. */
export type BuilderStep =
  | 'b:bot_token'
  | 'b:cf_token'
  | 'b:cf_account'
  | 'b:names'
  | 'b:confirm'
  | 'b:exec'
  | 'b:re:bot'
  | 'b:re:cf'
  | 'b:re:exec'
  | 'b:health_token';

const STEPS: ReadonlySet<string> = new Set([
  'b:bot_token', 'b:cf_token', 'b:cf_account', 'b:names', 'b:confirm', 'b:exec',
  'b:re:bot', 'b:re:cf', 'b:re:exec', 'b:health_token',
]);

export async function getWizard(db: D1Database, tid: number): Promise<{ step: BuilderStep; data: InstallData } | null> {
  const row = await db
    .prepare(`SELECT step, data FROM wizard_state WHERE telegram_id=?`)
    .bind(tid)
    .first<{ step: string; data: string }>();
  if (!row || !STEPS.has(row.step)) return null;
  let data: InstallData = {};
  try {
    data = JSON.parse(row.data) as InstallData;
  } catch {
    data = {};
  }
  return { step: row.step as BuilderStep, data };
}

/** step=null deletes the row (wiping any transient tokens). */
export async function setWizard(db: D1Database, tid: number, step: BuilderStep | null, data: InstallData): Promise<void> {
  if (!step) {
    await db.prepare(`DELETE FROM wizard_state WHERE telegram_id=?`).bind(tid).run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO wizard_state (telegram_id, step, data, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(telegram_id) DO UPDATE SET step=excluded.step, data=excluded.data, updated_at=excluded.updated_at`
    )
    .bind(tid, step, JSON.stringify(data), now())
    .run();
}

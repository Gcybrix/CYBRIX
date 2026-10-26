/** D1 helpers + idempotent migration runner — identical pattern to apps/central-bot/src/db.ts. */
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from '../../../packages/database/schema';

let migrated = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (migrated) return;
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`)
    .run();
  const done = await db.prepare(`SELECT name FROM schema_migrations WHERE name = ?`).bind(SCHEMA_VERSION).first();
  if (!done) {
    for (const stmt of SCHEMA_STATEMENTS) {
      await db.prepare(stmt).run(); // CREATE ... IF NOT EXISTS — idempotent per statement
    }
    await db
      .prepare(`INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`)
      .bind(SCHEMA_VERSION, Math.floor(Date.now() / 1000))
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

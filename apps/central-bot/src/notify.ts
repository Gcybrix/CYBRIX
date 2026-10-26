/**
 * Notification center — DB-backed with dedupe, best-effort Telegram delivery.
 * Every notification is persisted first (audit trail + /notifications digest),
 * then delivered via DM when technically possible. Failures never throw.
 */
import type { Env } from './types';
import { now } from './db';

export type NotifKind =
  | 'winner_dm'
  | 'prize_deadline'
  | 'prize_expired'
  | 'referral_valid'
  | 'challenge_published'
  | 'challenge_finished'
  | 'report_filed'
  | 'system';

/** Persist a notification with 1h exact-dedupe per (user, kind, text). Returns row id or null when deduped. */
export async function notify(
  env: Env,
  tid: number | null,
  kind: NotifKind,
  text: string
): Promise<number | null> {
  const ts = now();
  if (tid) {
    const dup = await env.DB
      .prepare(`SELECT id FROM notifications WHERE telegram_id=? AND kind=? AND text=? AND created_at > ? LIMIT 1`)
      .bind(tid, kind, text, ts - 3600)
      .first<{ id: number }>();
    if (dup) return null;
  }
  const ins = await env.DB
    .prepare(`INSERT INTO notifications (telegram_id, kind, text, status, created_at) VALUES (?,?,?,'queued',?)`)
    .bind(tid, kind, text.slice(0, 3500), ts)
    .run();
  return (ins.meta?.last_row_id as number) ?? null;
}

/** Best-effort delivery of one queued notification; marks sent/failed. */
export async function deliver(
  env: Env,
  sendFn: (tid: number, text: string) => Promise<unknown>,
  notifId: number,
  tid: number,
  text: string
): Promise<void> {
  try {
    const r = await sendFn(tid, text);
    await env.DB
      .prepare(`UPDATE notifications SET status=?, sent_at=? WHERE id=?`)
      .bind(r ? 'sent' : 'failed', now(), notifId)
      .run();
  } catch {
    await env.DB.prepare(`UPDATE notifications SET status='failed', sent_at=? WHERE id=?`).bind(now(), notifId).run();
  }
}

/** Mark all of a user's notifications as read (viewed via /notifications). */
export async function markRead(env: Env, tid: number): Promise<void> {
  await env.DB
    .prepare(`UPDATE notifications SET status='read' WHERE telegram_id=? AND status IN ('queued','sent')`)
    .bind(tid)
    .run();
}

export async function recentFor(env: Env, tid: number, limit = 10) {
  return env.DB
    .prepare(`SELECT id, kind, text, status, created_at FROM notifications WHERE telegram_id=? ORDER BY id DESC LIMIT ?`)
    .bind(tid, limit)
    .all<{ id: number; kind: string; text: string; status: string; created_at: number }>();
}

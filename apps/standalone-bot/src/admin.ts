/** Admin/owner features: panel codes, broadcast, grants, gift codes, tickets, stats, reports, prize delivery. */
import type { Env } from './types';
import { now, audit } from './db';
import { t, type Lang } from '../../../packages/shared/src/i18n';
import { randHex } from '../../../packages/shared/src/config';
import { Tg, kb, userMention } from './tg';
import { isOwner, brandName } from './users';
import { grant, getWallet, total } from './wallet';
import { notify, deliver } from './notify';

export async function makePanelCode(env: Env, tid: number): Promise<string> {
  const code = randHex(4).toUpperCase(); // 8 hex chars
  const ts = now();
  await env.DB
    .prepare(`INSERT INTO panel_login_codes (code, telegram_id, expires_at, used, created_at) VALUES (?,?,?,0,?)`)
    .bind(code, tid, ts + 300, ts)
    .run();
  await audit(env.DB, tid, 'panel.code_issued', 'panel', tid, '');
  return code;
}

export async function broadcast(env: Env, tg: Tg, text: string): Promise<{ ok: number; fail: number }> {
  const users = await env.DB.prepare(`SELECT telegram_id FROM users WHERE status='active' ORDER BY last_seen_at DESC LIMIT 10000`).all<{ telegram_id: number }>();
  let ok = 0, fail = 0;
  for (const u of users.results) {
    const r = await tg.sendMessage(u.telegram_id, text);
    if (r) ok++; else fail++;
    await new Promise((res) => setTimeout(res, 30)); // ~33 msg/s, below Telegram broadcast limits
  }
  await audit(env.DB, null, 'broadcast.sent', 'system', '', `${ok}/${fail}`);
  return { ok, fail };
}

export async function adminGrant(env: Env, tg: Tg, chatId: number, actor: number, args: string[]): Promise<void> {
  if (!(await isOwner(env, actor))) return;
  const target = parseInt(args[0], 10);
  const amount = parseInt(args[1], 10);
  if (!Number.isInteger(target) || !Number.isInteger(amount) || amount <= 0) {
    await tg.sendMessage(chatId, 'فرمت: /grant <telegram_id> <amount>');
    return;
  }
  const ok = await grant(env, target, amount, 'gift', `owner grant by ${actor}`);
  await tg.sendMessage(chatId, ok ? t('fa', 'grant_done', { amount, user: `<code>${target}</code>` }) : t('fa', 'err_generic'));
}

export async function makeGiftCode(env: Env, tg: Tg, chatId: number, actor: number, args: string[]): Promise<void> {
  if (!(await isOwner(env, actor))) return;
  const amount = parseInt(args[0], 10);
  const uses = Math.min(parseInt(args[1] || '1', 10) || 1, 1000);
  if (!Number.isInteger(amount) || amount <= 0) {
    await tg.sendMessage(chatId, 'فرمت: /gencode <amount> <uses>');
    return;
  }
  const code = 'CYB-' + randHex(4).toUpperCase();
  await env.DB.prepare(`INSERT INTO coupons (code, kind, amount, max_uses, uses, expires_at, created_by, created_at) VALUES (?,?,?,?,0,NULL,?,?)`)
    .bind(code, 'credits', amount, uses, actor, now()).run();
  await audit(env.DB, actor, 'coupon.create', 'coupon', code, `${amount}x${uses}`);
  await tg.sendMessage(chatId, t('fa', 'code_generated', { code, amount, uses }));
}

export async function myStats(env: Env, chatId: number, tid: number): Promise<void> {
  const ch = await env.DB.prepare(`SELECT COUNT(*) AS n FROM challenges WHERE created_by=?`).bind(tid).first<{ n: number }>();
  const parts = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM participants p JOIN challenges c ON c.id=p.challenge_id WHERE c.created_by=?`)
    .bind(tid).first<{ n: number }>();
  const chans = await env.DB.prepare(`SELECT COUNT(*) AS n FROM channels WHERE owner_tid=?`).bind(tid).first<{ n: number }>();
  const w = await getWallet(env, tid);
  await env.DB.prepare(`SELECT 1`).first(); // keepalive
  const text = t('fa', 'my_stats', {
    challenges: ch?.n ?? 0, participants: parts?.n ?? 0, channels: chans?.n ?? 0, credits: total(w),
  });
  const tg = new Tg(env);
  await tg.sendMessage(chatId, text);
}

export async function openTicketsList(env: Env, tg: Tg, chatId: number, actor: number): Promise<void> {
  if (!(await isOwner(env, actor))) return;
  const rows = await env.DB
    .prepare(`SELECT t.id, t.subject, t.status, t.telegram_id, u.username FROM support_tickets t LEFT JOIN users u ON u.telegram_id=t.telegram_id WHERE t.status='open' ORDER BY t.id DESC LIMIT 10`)
    .all<{ id: number; subject: string; status: string; telegram_id: number; username: string }>();
  if (!rows.results.length) { await tg.sendMessage(chatId, '✅ تیکت بازی نیست.'); return; }
  const text = rows.results.map((r) => `#${r.id} — ${r.subject.slice(0, 40)} (از ${userMention({ id: r.telegram_id, username: r.username, first_name: '' } as any)})`).join('\n');
  await tg.sendMessage(chatId, `🆘 تیکت‌های باز:\n\n${text}\n\nپاسخ: /reply <id> <text>`);
}

export async function replyTicket(env: Env, tg: Tg, chatId: number, actor: number, args: string[], raw: string): Promise<void> {
  if (!(await isOwner(env, actor))) return;
  const id = parseInt(args[0], 10);
  const text = raw.replace(/^\/reply\s+\d+\s*/, '');
  if (!Number.isInteger(id) || !text) { await tg.sendMessage(chatId, 'فرمت: /reply <id> <text>'); return; }
  const tk = await env.DB.prepare(`SELECT * FROM support_tickets WHERE id=?`).bind(id).first<{ id: number; telegram_id: number; status: string }>();
  if (!tk) { await tg.sendMessage(chatId, 'تیکت یافت نشد.'); return; }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, sender_tid, from_role, text, created_at) VALUES (?,?,?,?,?)`).bind(id, actor, 'admin', text, now()),
    env.DB.prepare(`UPDATE support_tickets SET status='answered', updated_at=? WHERE id=?`).bind(now(), id),
  ]);
  await tg.sendMessage(tk.telegram_id, `📩 پاسخ پشتیبانی به تیکت #${id}:\n\n${text}`);
  await tg.sendMessage(chatId, '✅ ارسال شد.');
}

export async function platformStats(env: Env): Promise<string> {
  const users = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>();
  const active7 = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE last_seen_at > ?`).bind(now() - 7 * 86400).first<{ n: number }>();
  const challenges = await env.DB.prepare(`SELECT COUNT(*) AS n FROM challenges`).first<{ n: number }>();
  const activeCh = await env.DB.prepare(`SELECT COUNT(*) AS n FROM challenges WHERE status='active'`).first<{ n: number }>();
  const participants = await env.DB.prepare(`SELECT COUNT(*) AS n FROM participants`).first<{ n: number }>();
  const credits = await env.DB.prepare(`SELECT COALESCE(SUM(free+gift+purchased),0) AS n FROM wallets`).first<{ n: number }>();
  const spent = await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) AS n FROM credit_transactions WHERE kind='spend'`).first<{ n: number }>();
  const tickets = await env.DB.prepare(`SELECT COUNT(*) AS n FROM support_tickets WHERE status='open'`).first<{ n: number }>();
  const openReports = await env.DB.prepare(`SELECT COUNT(*) AS n FROM abuse_reports WHERE status='open'`).first<{ n: number }>();
  const pendingPrizes = await env.DB.prepare(`SELECT COUNT(*) AS n FROM prize_deliveries WHERE status='pending'`).first<{ n: number }>();
  return [
    `📊 ${brandName(env)} Platform Stats`,
    `─────────────────`,
    `👤 users: ${users?.n ?? 0} (7d active: ${active7?.n ?? 0})`,
    `🎯 challenges: ${challenges?.n ?? 0} (active: ${activeCh?.n ?? 0})`,
    `👥 participants: ${participants?.n ?? 0}`,
    `💳 credits issued: ${credits?.n ?? 0} | spent: ${spent?.n ?? 0}`,
    `🆘 open tickets: ${tickets?.n ?? 0}`,
    `🚩 open abuse reports: ${openReports?.n ?? 0}`,
    `🎁 pending prize deliveries: ${pendingPrizes?.n ?? 0}`,
  ].join('\n');
}

/* ------------------------------ Abuse reports ------------------------------ */

/** Any user files an abuse report against a challenge. */
export async function submitReport(env: Env, tg: Tg, chatId: number, tid: number, lang: Lang, chId: number, reason: string): Promise<void> {
  const ch = await env.DB.prepare(`SELECT id FROM challenges WHERE id=?`).bind(chId).first<{ id: number }>();
  if (!ch) { await tg.sendMessage(chatId, t(lang, 'report_usage')); return; }
  const ins = await env.DB
    .prepare(`INSERT INTO abuse_reports (reporter_tid, target_type, target_id, reason, status, created_at) VALUES (?,?,?,?, 'open', ?)`)
    .bind(tid, 'challenge', String(chId), reason.slice(0, 500), now())
    .run();
  await audit(env.DB, tid, 'abuse.report', 'challenge', chId, reason.slice(0, 120));
  await tg.sendMessage(chatId, t(lang, 'report_saved', { id: ins.meta?.last_row_id ?? 0 }));
  // notify owner (best effort)
  const owner = await env.DB.prepare(`SELECT telegram_id FROM users WHERE role='owner' LIMIT 1`).first<{ telegram_id: number }>();
  if (owner) {
    const text = `🚩 گزارش تخلف جدید #${ins.meta?.last_row_id}\nچالش: ${chId}\nگزارش‌دهنده: <code>${tid}</code>\nدلیل: ${reason.slice(0, 200)}\n\nرسیدگی: /reportclose ${ins.meta?.last_row_id} resolved|dismissed`;
    const nid = await notify(env, owner.telegram_id, 'report_filed', text);
    if (nid) await deliver(env, (tid2, txt) => tg.sendMessage(tid2, txt), nid, owner.telegram_id, text);
  }
}

export async function listReports(env: Env, tg: Tg, chatId: number, actor: number, lang: Lang): Promise<void> {
  if (!(await isOwner(env, actor))) return;
  const rows = await env.DB
    .prepare(`SELECT id, reporter_tid, target_id, reason, created_at FROM abuse_reports WHERE status='open' ORDER BY id DESC LIMIT 15`)
    .all<{ id: number; reporter_tid: number; target_id: string; reason: string; created_at: number }>();
  if (!rows.results.length) { await tg.sendMessage(chatId, t(lang, 'reports_none')); return; }
  const list = rows.results.map((r) => `#${r.id} — چالش ${r.target_id} — از <code>${r.reporter_tid}</code>\n  ${r.reason.slice(0, 120)}`).join('\n');
  await tg.sendMessage(chatId, t(lang, 'reports_list', { list }));
}

export async function closeReport(env: Env, tg: Tg, chatId: number, actor: number, lang: Lang, id: number, status: string): Promise<void> {
  if (!(await isOwner(env, actor))) return;
  if (!['resolved', 'dismissed'].includes(status)) { await tg.sendMessage(chatId, t(lang, 'report_close_usage')); return; }
  const upd = await env.DB.prepare(`UPDATE abuse_reports SET status=? WHERE id=? AND status='open'`).bind(status, id).run();
  if ((upd.meta?.changes ?? 0) !== 1) { await tg.sendMessage(chatId, t(lang, 'report_close_usage')); return; }
  await audit(env.DB, actor, 'abuse.close', 'report', id, status);
  await tg.sendMessage(chatId, t(lang, 'report_closed', { id, status }));
}

/* ---------------------------- Prize delivery ops --------------------------- */

function canManage(chCreated_by: number, tid: number, owner: boolean): boolean {
  return chCreated_by === tid || owner;
}

export async function prizesList(env: Env, tg: Tg, chatId: number, actor: number, lang: Lang, chId: number): Promise<void> {
  const ch = await env.DB.prepare(`SELECT id, created_by FROM challenges WHERE id=?`).bind(chId).first<{ id: number; created_by: number }>();
  if (!ch) { await tg.sendMessage(chatId, t(lang, 'prizes_none')); return; }
  if (!canManage(ch.created_by, actor, await isOwner(env, actor))) { await tg.sendMessage(chatId, t(lang, 'prizedone_denied')); return; }
  const rows = await env.DB
    .prepare(`SELECT d.rank, d.status, d.winner_tid, u.username, u.first_name FROM prize_deliveries d LEFT JOIN users u ON u.telegram_id=d.winner_tid WHERE d.challenge_id=? ORDER BY d.rank`)
    .bind(chId).all<{ rank: number; status: string; winner_tid: number; username: string; first_name: string }>();
  if (!rows.results.length) { await tg.sendMessage(chatId, t(lang, 'prizes_none')); return; }
  const icons: Record<string, string> = { pending: '⏳', claimed: '📬', delivered: '✅', expired: '⛔', replaced: '🔁' };
  const list = rows.results.map((r) => `${icons[r.status] ?? '•'} رتبه ${r.rank} — ${userMention({ id: r.winner_tid, username: r.username, first_name: r.first_name } as any)} — ${r.status}`).join('\n');
  await tg.sendMessage(chatId, t(lang, 'prizes_list', { ch: chId, list }));
}

export async function prizeDone(env: Env, tg: Tg, chatId: number, actor: number, lang: Lang, chId: number, rank: number): Promise<void> {
  const ch = await env.DB.prepare(`SELECT id, created_by FROM challenges WHERE id=?`).bind(chId).first<{ id: number; created_by: number }>();
  if (!ch) { await tg.sendMessage(chatId, t(lang, 'prizedone_usage')); return; }
  if (!canManage(ch.created_by, actor, await isOwner(env, actor))) { await tg.sendMessage(chatId, t(lang, 'prizedone_denied')); return; }
  const upd = await env.DB.batch([
    env.DB.prepare(`UPDATE prize_deliveries SET status='delivered', delivered_at=? WHERE challenge_id=? AND rank=? AND status IN ('pending','claimed')`).bind(now(), chId, rank),
    env.DB.prepare(`UPDATE prizes SET status='delivered' WHERE challenge_id=? AND rank=?`).bind(chId, rank),
  ]);
  if ((upd[0]?.meta?.changes ?? 0) !== 1) { await tg.sendMessage(chatId, t(lang, 'prizedone_usage')); return; }
  await audit(env.DB, actor, 'prize.delivered', 'challenge', chId, `rank=${rank}`);
  await tg.sendMessage(chatId, t(lang, 'prizedone_ok', { rank, ch: chId }));
}

/** Replace a winner with the next alternate (audited, both notified). */
export async function redrawWinner(env: Env, tg: Tg, chatId: number, actor: number, lang: Lang, chId: number, rank: number, reason: string): Promise<void> {
  const ch = await env.DB.prepare(`SELECT id, created_by, title, winners_count FROM challenges WHERE id=?`).bind(chId).first<{ id: number; created_by: number; title: string; winners_count: number }>();
  if (!ch) { await tg.sendMessage(chatId, t(lang, 'redraw_usage')); return; }
  if (!canManage(ch.created_by, actor, await isOwner(env, actor))) { await tg.sendMessage(chatId, t(lang, 'redraw_denied')); return; }
  const cur = await env.DB.prepare(`SELECT id, winner_tid FROM prize_deliveries WHERE challenge_id=? AND rank=?`).bind(chId, rank).first<{ id: number; winner_tid: number }>();
  if (!cur) { await tg.sendMessage(chatId, t(lang, 'redraw_usage')); return; }
  const alt = await env.DB
    .prepare(`SELECT telegram_id FROM winners WHERE challenge_id=? AND rank > ? AND method='alternate' ORDER BY rank LIMIT 1`)
    .bind(chId, ch.winners_count).first<{ telegram_id: number }>();
  if (!alt) { await tg.sendMessage(chatId, t(lang, 'redraw_no_alt')); return; }

  await env.DB.batch([
    env.DB.prepare(`UPDATE prizes SET status='pending' WHERE challenge_id=? AND rank=? AND status != 'delivered'`).bind(chId, rank),
    env.DB.prepare(`UPDATE winners SET telegram_id=?, method='alternate-promoted' WHERE challenge_id=? AND rank=?`).bind(alt.telegram_id, chId, rank),
    env.DB.prepare(`DELETE FROM winners WHERE challenge_id=? AND telegram_id=? AND method='alternate'`).bind(chId, alt.telegram_id),
    // reuse the SAME delivery row (UNIQUE(challenge_id, rank)) — history lives in audit_events
    env.DB.prepare(`UPDATE prize_deliveries SET winner_tid=?, status='pending', deadline_at=?, responded_at=NULL, delivered_at=NULL, note=? WHERE id=?`)
      .bind(alt.telegram_id, now() + 48 * 3600, reason.slice(0, 200), cur.id),
  ]);
  await audit(env.DB, actor, 'prize.redraw', 'challenge', chId, `rank=${rank} old=${cur.winner_tid} new=${alt.telegram_id} reason=${reason.slice(0, 100)}`);
  const dmOld = `ℹ️ برنده جایگزین شد — چالش «${ch.title}» رتبه ${rank}. دلیل: ${reason.slice(0, 150)}`;
  const dmNew = t('fa', 'winner_dm_v2', { title: ch.title, rank, prize: '-', deadline: '-', ch: chId });
  for (const [tid2, txt] of [[cur.winner_tid, dmOld], [alt.telegram_id, dmNew]] as const) {
    const nid = await notify(env, tid2, 'system', txt);
    if (nid) await deliver(env, (t3, x) => tg.sendMessage(t3, x), nid, tid2, txt);
  }
  await tg.sendMessage(chatId, t(lang, 'redraw_ok', { rank, ch: chId }));
}

/** Winner confirms prize reception within the deadline. */
export async function claimPrize(env: Env, tg: Tg, chatId: number, tid: number, lang: Lang, chId: number): Promise<void> {
  const d = await env.DB
    .prepare(`SELECT id, rank, status, deadline_at FROM prize_deliveries WHERE challenge_id=? AND winner_tid=?`)
    .bind(chId, tid).first<{ id: number; rank: number; status: string; deadline_at: number }>();
  if (!d || d.status === 'delivered' || d.status === 'replaced' || (d.status === 'pending' && d.deadline_at < now())) {
    await tg.sendMessage(chatId, t(lang, 'claim_not_winner'));
    return;
  }
  if (d.status === 'claimed' || d.status === 'expired') {
    await tg.sendMessage(chatId, t(lang, 'claim_not_winner'));
    return;
  }
  await env.DB.prepare(`UPDATE prize_deliveries SET status='claimed', responded_at=? WHERE id=? AND status='pending'`).bind(now(), d.id).run();
  await audit(env.DB, tid, 'prize.claimed', 'challenge', chId, `rank=${d.rank}`);
  await tg.sendMessage(chatId, t(lang, 'claim_ok', { rank: d.rank, ch: chId }));
}

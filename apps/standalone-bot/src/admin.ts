/** Admin/owner features: panel codes, broadcast, grants, gift codes, tickets, stats. */
import type { Env } from './types';
import { now, audit } from './db';
import { t, type Lang } from '../../../packages/shared/src/i18n';
import { randHex } from '../../../packages/shared/src/config';
import { Tg, kb, userMention } from './tg';
import { isOwner, brandName } from './users';
import { grant, getWallet, total } from './wallet';

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
  return [
    `📊 ${brandName(env)} Platform Stats`,
    `─────────────────`,
    `👤 users: ${users?.n ?? 0} (7d active: ${active7?.n ?? 0})`,
    `🎯 challenges: ${challenges?.n ?? 0} (active: ${activeCh?.n ?? 0})`,
    `👥 participants: ${participants?.n ?? 0}`,
    `💳 credits issued: ${credits?.n ?? 0} | spent: ${spent?.n ?? 0}`,
    `🆘 open tickets: ${tickets?.n ?? 0}`,
  ].join('\n');
}

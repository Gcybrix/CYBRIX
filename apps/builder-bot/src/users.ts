/** Builder users, mandatory-channel join gate, rate limiting, menus. */
import type { Env, BuilderUserRow, TgUser } from './types';
import { now } from './db';
import { parseJson, OFFICIAL_CHANNELS } from '../../../packages/shared/src/config';
import type { Lang } from '../../../packages/shared/src/i18n';
import { Tg, kb } from './tg';
import { t } from './strings';

export function mandatoryChannels(env: Env): string[] {
  const list = parseJson<string[]>(env.MANDATORY_CHANNELS, [...OFFICIAL_CHANNELS]);
  return Array.isArray(list) && list.length ? list : [...OFFICIAL_CHANNELS];
}

export async function ensureBuilderUser(env: Env, u: TgUser): Promise<BuilderUserRow | null> {
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO builder_users (telegram_id, first_name, username, lang, joined_at, last_seen_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(telegram_id) DO UPDATE SET first_name=excluded.first_name, username=excluded.username, last_seen_at=excluded.last_seen_at`
  )
    .bind(u.id, u.first_name || '', u.username || '', u.language_code?.startsWith('en') ? 'en' : 'fa', ts, ts)
    .run();
  const row = await env.DB
    .prepare(`SELECT telegram_id, first_name, username, lang FROM builder_users WHERE telegram_id = ?`)
    .bind(u.id)
    .first<BuilderUserRow>();
  return row ?? null;
}

/* Cached builder-bot identity (for rejecting its own token in the wizard). */
let cachedMe: { id: number; username: string } | null = null;
export async function builderMe(tg: Tg): Promise<{ id: number; username: string } | null> {
  if (cachedMe) return cachedMe;
  const me = await tg.getMe();
  if (me?.id && me.username) cachedMe = { id: me.id, username: me.username };
  return cachedMe;
}

/** Check membership of one user in all mandatory channels (cached 60s per isolate). */
const memberCache = new Map<string, { ok: boolean; exp: number }>();

export async function passesJoinGate(env: Env, tg: Tg, tid: number): Promise<boolean> {
  const chans = mandatoryChannels(env);
  const nowMs = Date.now();
  for (const ch of chans) {
    const key = `${ch}:${tid}`;
    const c = memberCache.get(key);
    if (c && c.exp > nowMs) {
      if (!c.ok) return false;
      continue;
    }
    const m = await tg.getChatMember(ch, tid);
    const ok = !!m && ['creator', 'administrator', 'member'].includes(m.status);
    memberCache.set(key, { ok, exp: nowMs + 60_000 });
    if (!ok) return false;
  }
  return true;
}

export function joinGateKeyboard(env: Env, lang: Lang) {
  const rows: Array<Array<{ text: string; url?: string; callback_data?: string }>> = mandatoryChannels(env).map((ch) => [
    { text: t(lang, 'b_join_btn'), url: `https://t.me/${ch.replace('@', '')}` },
  ]);
  rows.push([{ text: t(lang, 'b_check_again'), callback_data: 'b:check' }]);
  return kb(rows);
}

export function mainMenuKeyboard(lang: Lang) {
  return kb([
    [{ text: t(lang, 'b_btn_install'), callback_data: 'menu:install' }],
    [{ text: t(lang, 'b_btn_status'), callback_data: 'menu:status' }, { text: t(lang, 'b_btn_help'), callback_data: 'menu:help' }],
  ]);
}

/** simple per-user token bucket (in-memory; resets per isolate — documented limitation) */
const buckets = new Map<number, { tokens: number; ts: number }>();
export function rateLimited(tid: number): boolean {
  const nowMs = Date.now();
  const b = buckets.get(tid) ?? { tokens: 8, ts: nowMs };
  b.tokens = Math.min(8, b.tokens + ((nowMs - b.ts) / 1000) * 0.5); // refill 0.5/s
  b.ts = nowMs;
  if (b.tokens < 1) {
    buckets.set(tid, b);
    return true;
  }
  b.tokens -= 1;
  buckets.set(tid, b);
  return false;
}

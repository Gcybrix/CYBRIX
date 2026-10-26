/** User registration, roles, mandatory-channel gate (standalone: owner-managed via meta), rate limiting. */
import type { Env, DBUserRow, TgUser } from './types';
import { now, getMeta, setMeta } from './db';
import { t, type Lang } from '../../../packages/shared/src/i18n';
import { SIGNUP_FREE_CREDITS, parseJson } from '../../../packages/shared/src/config';
import { Tg, kb } from './tg';

export function brandName(env: Env): string {
  return (env.BRAND_NAME || '').trim() || 'CYBRIX';
}

/**
 * Owner bootstrap: when OWNER_TG_ID is empty or "0", the FIRST user who sends /start
 * becomes owner (stored atomically in meta key `owner_tid`). If OWNER_TG_ID is configured,
 * it wins and no bootstrap happens.
 */
export async function bootstrapOwner(env: Env, tid: number): Promise<void> {
  const envOwner = (env.OWNER_TG_ID || '').trim();
  if (envOwner && envOwner !== '0') return; // configured owner wins
  await env.DB
    .prepare(`INSERT INTO meta (key, value) VALUES ('owner_tid', ?) ON CONFLICT(key) DO NOTHING`)
    .bind(String(tid))
    .run();
}

/* --------------------- mandatory channels (meta-managed) -------------------- */

const CHANNEL_HANDLE_RE = /^@[A-Za-z0-9_]{3,64}$/;

/** Read mandatory channels from meta (`mandatory_channels`); on first run seed from env.MANDATORY_CHANNELS. */
export async function getMandatoryChannels(env: Env): Promise<string[]> {
  let raw = await getMeta(env, 'mandatory_channels');
  if (raw === null) {
    const init = parseJson<unknown[]>(env.MANDATORY_CHANNELS, []);
    const safe = Array.isArray(init) ? init.filter((c): c is string => typeof c === 'string' && CHANNEL_HANDLE_RE.test(c)) : [];
    raw = JSON.stringify(safe);
    await setMeta(env, 'mandatory_channels', raw);
    return safe;
  }
  const list = parseJson<unknown[]>(raw, []);
  return Array.isArray(list) ? list.filter((c): c is string => typeof c === 'string' && CHANNEL_HANDLE_RE.test(c)) : [];
}

/** Owner-only: add a mandatory channel after validating @username format and verifying it exists via getChat. */
export async function addMandatoryChannel(
  env: Env,
  tg: Tg,
  handle: string
): Promise<{ ok: true } | { ok: false; error: 'format' | 'not_found' | 'dup' }> {
  const input = handle.trim();
  if (!CHANNEL_HANDLE_RE.test(input)) return { ok: false, error: 'format' };
  const chat = await tg.getChat(input); // must exist and be visible to the bot
  if (!chat) return { ok: false, error: 'not_found' };
  const canonical = chat.username ? `@${chat.username}` : input;
  const list = await getMandatoryChannels(env);
  if (list.some((c) => c.toLowerCase() === canonical.toLowerCase())) return { ok: false, error: 'dup' };
  list.push(canonical);
  await setMeta(env, 'mandatory_channels', JSON.stringify(list));
  return { ok: true };
}

/** Owner-only: remove a mandatory channel. Returns false when format is invalid or it was not in the list. */
export async function removeMandatoryChannel(env: Env, handle: string): Promise<boolean> {
  const input = handle.trim();
  if (!CHANNEL_HANDLE_RE.test(input)) return false;
  const list = await getMandatoryChannels(env);
  const next = list.filter((c) => c.toLowerCase() !== input.toLowerCase());
  if (next.length === list.length) return false;
  await setMeta(env, 'mandatory_channels', JSON.stringify(next));
  return true;
}

export async function ensureUser(env: Env, u: TgUser): Promise<DBUserRow | null> {
  const ts = now();
  const metaOwner = await getMeta(env, 'owner_tid');
  const ownerFlag =
    String(u.id) === (env.OWNER_TG_ID || '').trim() || (!!metaOwner && metaOwner === String(u.id));
  await env.DB.prepare(
    `INSERT INTO users (telegram_id, first_name, username, lang, role, joined_at, last_seen_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(telegram_id) DO UPDATE SET first_name=excluded.first_name, username=excluded.username, role=excluded.role, last_seen_at=excluded.last_seen_at`
  )
    .bind(u.id, u.first_name || '', u.username || '', u.language_code?.startsWith('en') ? 'en' : 'fa',
      ownerFlag ? 'owner' : 'user', ts, ts)
    .run();

  // signup grant (idempotent via wallets row existence)
  const w = await env.DB.prepare(`SELECT telegram_id FROM wallets WHERE telegram_id = ?`).bind(u.id).first();
  if (!w) {
    const txid = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO wallets (telegram_id, free, updated_at) VALUES (?,?,?)`).bind(u.id, SIGNUP_FREE_CREDITS, ts),
      env.DB.prepare(
        `INSERT INTO credit_transactions (txid, telegram_id, kind, wallet_kind, amount, balance_after, ref, reason, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(txid, u.id, 'grant', 'free', SIGNUP_FREE_CREDITS, SIGNUP_FREE_CREDITS, 'signup', 'welcome grant', ts),
    ]);
  }

  const row = await env.DB.prepare(`SELECT * FROM users WHERE telegram_id = ?`).bind(u.id).first<DBUserRow>();
  return row ?? null;
}

export async function isOwner(env: Env, tid: number): Promise<boolean> {
  const metaOwner = await getMeta(env, 'owner_tid');
  if (metaOwner) return String(tid) === metaOwner; // bootstrapped/managed owner wins
  const envOwner = (env.OWNER_TG_ID || '').trim();
  return !!envOwner && envOwner !== '0' && String(tid) === envOwner;
}

/** Check membership of one user in all mandatory channels (cached 60s in-memory per isolate). */
const memberCache = new Map<string, { ok: boolean; exp: number }>();

export async function passesJoinGate(env: Env, tg: Tg, tid: number, extra: string[] = []): Promise<boolean> {
  const chans = [...(await getMandatoryChannels(env)), ...extra];
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

export async function joinGateKeyboard(env: Env, lang: Lang) {
  const rows: Array<Array<{ text: string; url?: string; callback_data?: string }>> = (await getMandatoryChannels(env)).map((ch) => [
    { text: t(lang, 'join_btn'), url: `https://t.me/${ch.replace('@', '')}` },
  ]);
  rows.push([{ text: t(lang, 'check_again'), callback_data: 'menu:start' }]);
  return kb(rows);
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

export function mainMenuKeyboard(lang: Lang, role: string) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: t(lang, 'btn_challenges'), callback_data: 'menu:challenges' }],
    [{ text: t(lang, 'btn_my_channels'), callback_data: 'menu:mychannels' }, { text: t(lang, 'btn_create'), callback_data: 'wz:start' }],
    [{ text: t(lang, 'btn_wallet'), callback_data: 'menu:wallet' }, { text: t(lang, 'btn_stats'), callback_data: 'menu:stats' }],
    [{ text: t(lang, 'btn_support'), callback_data: 'menu:support' }, { text: t(lang, 'btn_lang'), callback_data: 'menu:lang' }],
  ];
  return kb(rows);
}

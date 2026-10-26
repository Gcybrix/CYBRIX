/** CYBRIX Web Panel — Cloudflare Worker: admin dashboard SPA + D1-backed JSON API.
 *  Shares the central D1 database with the bots. Env: { DB, VERSION } — no secrets.
 */
import type { Env } from './types';
import { ensureSchema, now, audit } from './db';
import { randHex, fmtTehranDateTime } from '../../../packages/shared/src/config';
import { PANEL_HTML } from './panel_html';

const PAGE_SIZE = 20;
const SESSION_TTL_SEC = 7 * 86400;

const SEC_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

type Role = 'user' | 'admin' | 'owner';

interface Auth {
  tid: number;
  role: Role;
  firstName: string;
  username: string;
  lang: 'fa' | 'en';
}

interface ChListItem {
  id: number;
  title: string;
  type: string;
  status: string;
  end_at: number;
  channel_chat_id: string;
  winners_count: number;
  created_at: number;
  participants: number;
  winners: number;
}

interface ChFull {
  id: number;
  title: string;
  description: string;
  type: string;
  status: string;
  channel_chat_id: string;
  created_by: number;
  start_at: number | null;
  end_at: number;
  tz: string;
  winners_count: number;
  prizes: string;
  cost: number;
  created_at: number;
}

interface PartRow {
  telegram_id: number;
  joined_at: number;
  score: number;
  status: string;
  first_name: string;
  username: string;
}

interface WinRow {
  rank: number;
  method: string;
  selected_at: number;
  proof: string;
  telegram_id: number;
  first_name: string;
  username: string;
}

interface AuditRow {
  id: number;
  actor_tid: number | null;
  action: string;
  target_type: string;
  target_id: string;
  meta: string;
  created_at: number;
}

interface TxRow {
  id: number;
  txid: string;
  kind: string;
  wallet_kind: string;
  amount: number;
  balance_after: number;
  ref: string;
  reason: string;
  created_at: number;
  telegram_id?: number;
  user_name?: string;
  user_username?: string;
}

interface TicketRow {
  id: number;
  subject: string;
  status: string;
  created_at: number;
  updated_at: number;
  telegram_id: number;
  first_name: string;
  username: string;
  last_message: string | null;
  messages: number;
}

interface PrizeRow {
  rank: number;
  title: string;
  value: string;
  status: string;
}

interface PrizeDeliveryRow {
  rank: number;
  status: string;
  deadline_at: number;
}

interface ReportRow {
  id: number;
  target_type: string;
  target_id: string;
  reason: string;
  status: string;
  created_at: number;
  challenge_title: string;
  reporter_name: string;
}

interface PublicChallengeRow {
  id: number;
  type: string;
  title: string;
  description: string;
  status: string;
  end_at: number;
  winners_count: number;
  prizes: string;
  snapshot_hash: string | null;
  config: string | null;
}

interface PublicWinnerRow {
  rank: number;
  first_name: string;
}

const TYPE_LABELS_FA: Record<string, string> = {
  random: 'قرعه‌کشی',
  vote: 'رأی‌گیری',
  referral: 'دعوت',
  quiz: 'آزمون',
  photo: 'عکاسی',
  points: 'امتیازی',
};
const TYPE_LABELS_EN: Record<string, string> = {
  random: 'Lottery',
  vote: 'Voting',
  referral: 'Referral',
  quiz: 'Quiz',
  photo: 'Photo',
  points: 'Points',
};

/* ------------------------------- responses -------------------------------- */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function htmlResponse(): Response {
  return new Response(PANEL_HTML, {
    headers: {
      ...SEC_HEADERS,
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // Inline-only SPA: block any external resource from ever loading.
      'content-security-policy':
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

function csvResponse(body: string, filename: string): Response {
  return new Response('\uFEFF' + body, {
    headers: {
      ...SEC_HEADERS,
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="' + filename + '"',
      'cache-control': 'no-store',
    },
  });
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function parsePage(raw: string | null): number {
  const n = parseInt(raw || '1', 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 100000);
}

/** Server-side HTML escaping for anything user-originated (public page). */
function esc(s: unknown): string {
  const v = s === null || s === undefined ? '' : String(s);
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parsePublicPageFlag(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const cfg = JSON.parse(raw) as { public_page?: unknown };
    return cfg.public_page === true;
  } catch {
    return false;
  }
}

/* ----------------------------- login rate limit ---------------------------- */

const loginAttempts = new Map<string, number[]>();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

function allowLoginAttempt(ip: string): boolean {
  const ts = Date.now();
  const fresh = (loginAttempts.get(ip) || []).filter((t0) => ts - t0 < LOGIN_WINDOW_MS);
  if (fresh.length >= LOGIN_MAX_ATTEMPTS) {
    loginAttempts.set(ip, fresh);
    return false;
  }
  fresh.push(ts);
  loginAttempts.set(ip, fresh);
  if (loginAttempts.size > 5000) {
    for (const [key, stamps] of loginAttempts) {
      if (stamps.length === 0 || ts - stamps[stamps.length - 1] >= LOGIN_WINDOW_MS) loginAttempts.delete(key);
      if (loginAttempts.size <= 4000) break;
    }
  }
  return true;
}

/* ---------------------------------- auth ----------------------------------- */

async function authenticate(env: Env, request: Request): Promise<Auth | null> {
  const header = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!m) return null;
  const token = m[1];
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const sess = await env.DB
    .prepare(`SELECT telegram_id, role, expires_at FROM panel_sessions WHERE token = ?`)
    .bind(token)
    .first<{ telegram_id: number; role: string; expires_at: number }>();
  if (!sess || sess.expires_at <= now()) return null;
  const user = await env.DB
    .prepare(`SELECT first_name, username, lang, role FROM users WHERE telegram_id = ?`)
    .bind(sess.telegram_id)
    .first<{ first_name: string; username: string; lang: string; role: string }>();
  return {
    tid: sess.telegram_id,
    role: ((user && user.role) || sess.role || 'user') as Role,
    firstName: (user && user.first_name) || '',
    username: (user && user.username) || '',
    lang: user && user.lang === 'en' ? 'en' : 'fa',
  };
}

/* --------------------------------- login ----------------------------------- */

async function handleLogin(env: Env, request: Request): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  if (!allowLoginAttempt(ip)) return json({ error: 'rate_limited' }, 429);
  let body: { code?: unknown };
  try {
    body = (await request.json()) as { code?: unknown };
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{8}$/.test(code)) return json({ error: 'invalid_code' }, 401);
  const ts = now();
  const row = await env.DB
    .prepare(`SELECT telegram_id, expires_at, used FROM panel_login_codes WHERE code = ?`)
    .bind(code)
    .first<{ telegram_id: number; expires_at: number; used: number }>();
  if (!row || row.used !== 0 || row.expires_at <= ts) return json({ error: 'invalid_code' }, 401);
  const user = await env.DB
    .prepare(`SELECT first_name, role, lang FROM users WHERE telegram_id = ?`)
    .bind(row.telegram_id)
    .first<{ first_name: string; role: string; lang: string }>();
  // Atomic claim: only one concurrent request can consume the code.
  const claim = await env.DB.prepare(`UPDATE panel_login_codes SET used = 1 WHERE code = ? AND used = 0`).bind(code).run();
  if ((claim.meta?.changes ?? 0) !== 1) return json({ error: 'invalid_code' }, 401);
  const token = randHex(32); // 64 hex chars, 32 bytes of entropy
  await env.DB
    .prepare(`INSERT INTO panel_sessions (token, telegram_id, role, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(token, row.telegram_id, user?.role || 'user', ts + SESSION_TTL_SEC, ts)
    .run();
  await audit(env.DB, row.telegram_id, 'panel.login', 'panel', row.telegram_id, '');
  return json({ token, role: user?.role || 'user', first_name: user?.first_name || '' });
}

/* ---------------------------------- /api/me --------------------------------- */

async function handleMe(env: Env, a: Auth): Promise<Response> {
  const w = await env.DB
    .prepare(`SELECT COALESCE(free, 0) AS free, COALESCE(gift, 0) AS gift, COALESCE(purchased, 0) AS purchased FROM wallets WHERE telegram_id = ?`)
    .bind(a.tid)
    .first<{ free: number; gift: number; purchased: number }>();
  return json({
    telegram_id: a.tid,
    role: a.role,
    first_name: a.firstName,
    username: a.username,
    lang: a.lang,
    wallet: { free: w?.free ?? 0, gift: w?.gift ?? 0, purchased: w?.purchased ?? 0 },
  });
}

/* -------------------------------- /api/summary ------------------------------ */

async function dailySeries(
  env: Env,
  sql: string,
  binds: (string | number)[],
  dayStart: number
): Promise<number[]> {
  const rows = await env.DB.prepare(sql).bind(...binds).all<{ d: number; n: number }>();
  const map = new Map<number, number>();
  for (const r of rows.results) map.set(Number(r.d), Number(r.n));
  const out: number[] = [];
  for (let i = 6; i >= 0; i--) out.push(map.get(dayStart - i * 86400) || 0);
  return out;
}

async function handleSummary(env: Env, a: Auth): Promise<Response> {
  const owner = a.role === 'owner';
  const ts = now();
  const dayStart = Math.floor(ts / 86400) * 86400;
  const weekAgo = ts - 7 * 86400;
  const seriesFrom = dayStart - 6 * 86400;

  const chWhere = owner ? '' : ' WHERE created_by = ?';
  const chBinds = owner ? [] : [a.tid];
  const chScope = owner ? '' : ' AND challenge_id IN (SELECT id FROM challenges WHERE created_by = ?)';
  const chScopeBinds = owner ? [] : [a.tid];
  const txScope = owner ? '' : ' AND telegram_id = ?';
  const txScopeBinds = owner ? [] : [a.tid];

  const [ch, parts, votesRow, refs, issued, spent, tickets, chans, wallet, usersRow] = await Promise.all([
    env.DB
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'active'), 0) AS active, COALESCE(SUM(status = 'finished'), 0) AS finished FROM challenges${chWhere}`
      )
      .bind(...chBinds)
      .first<{ total: number; active: number; finished: number }>(),
    env.DB
      .prepare(`SELECT COUNT(*) AS n FROM participants WHERE 1 = 1${chScope}`)
      .bind(...chScopeBinds)
      .first<{ n: number }>(),
    env.DB
      .prepare(`SELECT COUNT(*) AS n FROM votes WHERE 1 = 1${chScope}`)
      .bind(...chScopeBinds)
      .first<{ n: number }>(),
    env.DB
      .prepare(`SELECT COUNT(*) AS n FROM referrals WHERE valid = 1${chScope}`)
      .bind(...chScopeBinds)
      .first<{ n: number }>(),
    owner
      ? env.DB.prepare(`SELECT COALESCE(SUM(free + gift + purchased), 0) AS n FROM wallets`).first<{ n: number }>()
      : Promise.resolve(null),
    env.DB
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM credit_transactions WHERE kind = 'spend'${txScope}`)
      .bind(...txScopeBinds)
      .first<{ n: number }>(),
    owner
      ? env.DB.prepare(`SELECT COUNT(*) AS n FROM support_tickets WHERE status = 'open'`).first<{ n: number }>()
      : env.DB
          .prepare(`SELECT COUNT(*) AS n FROM support_tickets WHERE status = 'open' AND telegram_id = ?`)
          .bind(a.tid)
          .first<{ n: number }>(),
    owner
      ? env.DB.prepare(`SELECT COUNT(*) AS n FROM channels`).first<{ n: number }>()
      : env.DB.prepare(`SELECT COUNT(*) AS n FROM channels WHERE owner_tid = ?`).bind(a.tid).first<{ n: number }>(),
    env.DB
      .prepare(`SELECT COALESCE(free, 0) AS free, COALESCE(gift, 0) AS gift, COALESCE(purchased, 0) AS purchased FROM wallets WHERE telegram_id = ?`)
      .bind(a.tid)
      .first<{ free: number; gift: number; purchased: number }>(),
    owner
      ? env.DB
          .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(last_seen_at > ?), 0) AS w7 FROM users`)
          .bind(weekAgo)
          .first<{ total: number; w7: number }>()
      : Promise.resolve(null),
  ]);

  const [usersSeries, chSeries, paSeries, spSeries] = await Promise.all([
    owner
      ? dailySeries(
          env,
          `SELECT (joined_at / 86400) * 86400 AS d, COUNT(*) AS n FROM users WHERE joined_at >= ? GROUP BY d`,
          [seriesFrom],
          dayStart
        )
      : Promise.resolve([] as number[]),
    dailySeries(
      env,
      `SELECT (created_at / 86400) * 86400 AS d, COUNT(*) AS n FROM challenges WHERE created_at >= ?${owner ? '' : ' AND created_by = ?'} GROUP BY d`,
      [seriesFrom, ...chScopeBinds],
      dayStart
    ),
    dailySeries(
      env,
      `SELECT (p.joined_at / 86400) * 86400 AS d, COUNT(*) AS n FROM participants p WHERE p.joined_at >= ?${chScope} GROUP BY d`,
      [seriesFrom, ...chScopeBinds],
      dayStart
    ),
    dailySeries(
      env,
      `SELECT (created_at / 86400) * 86400 AS d, COALESCE(SUM(amount), 0) AS n FROM credit_transactions WHERE created_at >= ? AND kind = 'spend'${txScope} GROUP BY d`,
      [seriesFrom, ...txScopeBinds],
      dayStart
    ),
  ]);

  const walletTotal = (wallet?.free ?? 0) + (wallet?.gift ?? 0) + (wallet?.purchased ?? 0);
  return json({
    scope: owner ? 'owner' : 'self',
    users: owner ? usersRow?.total ?? 0 : null,
    users_7d: owner ? usersRow?.w7 ?? 0 : null,
    challenges_total: ch?.total ?? 0,
    challenges_active: ch?.active ?? 0,
    challenges_finished: ch?.finished ?? 0,
    participants: parts?.n ?? 0,
    votes: votesRow?.n ?? 0,
    referrals_valid: refs?.n ?? 0,
    credits_issued: owner ? issued?.n ?? 0 : walletTotal,
    credits_spent: spent?.n ?? 0,
    open_tickets: tickets?.n ?? 0,
    channels: chans?.n ?? 0,
    wallet: { free: wallet?.free ?? 0, gift: wallet?.gift ?? 0, purchased: wallet?.purchased ?? 0 },
    series: {
      users: owner ? usersSeries : null,
      challenges: chSeries,
      participants: paSeries,
      spent: spSeries,
    },
  });
}

/* ------------------------------ /api/challenges ----------------------------- */

async function handleChallengesList(env: Env, a: Auth, url: URL): Promise<Response> {
  const owner = a.role === 'owner';
  const status = (url.searchParams.get('status') || 'all').toLowerCase();
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const page = parsePage(url.searchParams.get('page'));
  const offset = (page - 1) * PAGE_SIZE;

  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (!owner) {
    where.push('c.created_by = ?');
    binds.push(a.tid);
  }
  if (status === 'active' || status === 'finished' || status === 'draft') {
    where.push('c.status = ?');
    binds.push(status);
  }
  if (q) {
    where.push(`c.title LIKE ? ESCAPE '\\'`);
    binds.push('%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%');
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM challenges c ${whereSql}`)
    .bind(...binds)
    .first<{ n: number }>();
  const listBinds = [...binds, PAGE_SIZE, offset];
  const rows = await env.DB
    .prepare(
      `SELECT c.id, c.title, c.type, c.status, c.end_at, c.channel_chat_id, c.winners_count, c.created_at,
        (SELECT COUNT(*) FROM participants p WHERE p.challenge_id = c.id) AS participants,
        (SELECT COUNT(*) FROM winners w WHERE w.challenge_id = c.id) AS winners
       FROM challenges c ${whereSql}
       ORDER BY c.id DESC LIMIT ? OFFSET ?`
    )
    .bind(...listBinds)
    .all<ChListItem>();

  const totalN = total?.n ?? 0;
  return json({
    items: rows.results,
    page,
    page_size: PAGE_SIZE,
    total: totalN,
    pages: Math.max(1, Math.ceil(totalN / PAGE_SIZE)),
  });
}

async function handleChallengeDetail(env: Env, a: Auth, id: number): Promise<Response> {
  const ch = await env.DB
    .prepare(
      `SELECT id, title, description, type, status, channel_chat_id, created_by, start_at, end_at, tz, winners_count, prizes, cost, created_at
       FROM challenges WHERE id = ?`
    )
    .bind(id)
    .first<ChFull>();
  if (!ch || (a.role !== 'owner' && ch.created_by !== a.tid)) return json({ error: 'not_found' }, 404);

  // Prize rows + delivery tracking are privacy-gated: only the owner or the
  // challenge creator may see them. Any other session never receives them.
  const canSeePrizes = a.role === 'owner' || ch.created_by === a.tid;

  const [participants, participantsTotal, winners, auditRows, prizeRows, deliveries] = await Promise.all([
    env.DB
      .prepare(
        `SELECT p.telegram_id, p.joined_at, p.score, p.status,
                COALESCE(u.first_name, '') AS first_name, COALESCE(u.username, '') AS username
         FROM participants p LEFT JOIN users u ON u.telegram_id = p.telegram_id
         WHERE p.challenge_id = ? ORDER BY p.score DESC, p.id ASC LIMIT 200`
      )
      .bind(id)
      .all<PartRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM participants WHERE challenge_id = ?`).bind(id).first<{ n: number }>(),
    env.DB
      .prepare(
        `SELECT w.rank, w.method, w.selected_at, w.proof, w.telegram_id,
                COALESCE(u.first_name, '') AS first_name, COALESCE(u.username, '') AS username
         FROM winners w LEFT JOIN users u ON u.telegram_id = w.telegram_id
         WHERE w.challenge_id = ? ORDER BY w.rank ASC`
      )
      .bind(id)
      .all<WinRow>(),
    env.DB
      .prepare(
        `SELECT id, actor_tid, action, target_type, target_id, meta, created_at
         FROM audit_events WHERE target_type = 'challenge' AND target_id = ?
         ORDER BY id DESC LIMIT 100`
      )
      .bind(String(id))
      .all<AuditRow>(),
    canSeePrizes
      ? env.DB
          .prepare(`SELECT rank, title, value, status FROM prizes WHERE challenge_id = ? ORDER BY rank ASC`)
          .bind(id)
          .all<PrizeRow>()
      : Promise.resolve(null),
    canSeePrizes
      ? env.DB
          .prepare(`SELECT rank, status, deadline_at FROM prize_deliveries WHERE challenge_id = ? ORDER BY rank ASC`)
          .bind(id)
          .all<PrizeDeliveryRow>()
      : Promise.resolve(null),
  ]);

  return json({
    challenge: {
      id: ch.id,
      title: ch.title,
      description: ch.description || '',
      type: ch.type,
      status: ch.status,
      channel_chat_id: ch.channel_chat_id,
      start_at: ch.start_at,
      end_at: ch.end_at,
      tz: ch.tz,
      winners_count: ch.winners_count,
      prizes: ch.prizes || '',
      cost: ch.cost,
      created_at: ch.created_at,
    },
    participants_total: participantsTotal?.n ?? 0,
    participants: participants.results,
    winners: winners.results,
    audit: auditRows.results,
    ...(prizeRows ? { prize_rows: prizeRows.results } : {}),
    ...(deliveries ? { prize_deliveries: deliveries.results } : {}),
  });
}

/* ----------------------------- /api/transactions ---------------------------- */

async function handleTransactions(env: Env, a: Auth, url: URL): Promise<Response> {
  const owner = a.role === 'owner';
  const page = parsePage(url.searchParams.get('page'));
  const offset = (page - 1) * PAGE_SIZE;
  const where = owner ? '' : 'WHERE t.telegram_id = ?';
  const binds: (string | number)[] = owner ? [] : [a.tid];

  const total = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM credit_transactions t ${where}`)
    .bind(...binds)
    .first<{ n: number }>();

  const cols =
    't.id, t.txid, t.kind, t.wallet_kind, t.amount, t.balance_after, t.ref, t.reason, t.created_at' +
    (owner ? ', t.telegram_id' : '');
  const extraCols = owner ? ', COALESCE(u.first_name, \'\') AS user_name, COALESCE(u.username, \'\') AS user_username' : '';
  const join = owner ? ' LEFT JOIN users u ON u.telegram_id = t.telegram_id' : '';
  const listBinds = [...binds, PAGE_SIZE, offset];
  const rows = await env.DB
    .prepare(
      `SELECT ${cols}${extraCols} FROM credit_transactions t${join} ${where} ORDER BY t.id DESC LIMIT ? OFFSET ?`
    )
    .bind(...listBinds)
    .all<TxRow>();

  const totalN = total?.n ?? 0;
  return json({
    items: rows.results,
    page,
    page_size: PAGE_SIZE,
    total: totalN,
    pages: Math.max(1, Math.ceil(totalN / PAGE_SIZE)),
  });
}

/* -------------------------------- /api/tickets ------------------------------ */

async function handleTickets(env: Env, a: Auth): Promise<Response> {
  if (a.role !== 'owner') return json({ error: 'forbidden' }, 403);
  const rows = await env.DB
    .prepare(
      `SELECT t.id, t.subject, t.status, t.created_at, t.updated_at, t.telegram_id,
              COALESCE(u.first_name, '') AS first_name, COALESCE(u.username, '') AS username,
              (SELECT m.text FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_message,
              (SELECT COUNT(*) FROM ticket_messages m2 WHERE m2.ticket_id = t.id) AS messages
       FROM support_tickets t LEFT JOIN users u ON u.telegram_id = t.telegram_id
       WHERE t.status = 'open' ORDER BY t.updated_at DESC LIMIT 100`
    )
    .all<TicketRow>();
  return json({ items: rows.results });
}

/* ------------------------------ /api/reports -------------------------------- */

async function handleReportsList(env: Env, a: Auth): Promise<Response> {
  if (a.role !== 'owner') return json({ error: 'forbidden' }, 403);
  const rows = await env.DB
    .prepare(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.status, r.created_at,
              COALESCE(c.title, '') AS challenge_title,
              COALESCE(u.first_name, '') AS reporter_name
       FROM abuse_reports r
       LEFT JOIN challenges c ON c.id = CAST(r.target_id AS INTEGER)
       LEFT JOIN users u ON u.telegram_id = r.reporter_tid
       WHERE r.status = 'open'
       ORDER BY r.id DESC LIMIT 50`
    )
    .all<ReportRow>();
  return json({ items: rows.results });
}

async function handleReportClose(env: Env, a: Auth, request: Request): Promise<Response> {
  if (a.role !== 'owner') return json({ error: 'forbidden' }, 403);
  let body: { id?: unknown; status?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; status?: unknown };
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const id = typeof body.id === 'number' ? body.id : Number.parseInt(String(body.id ?? ''), 10);
  const status = body.status;
  if (!Number.isInteger(id) || (id as number) <= 0 || (status !== 'resolved' && status !== 'dismissed')) {
    return json({ error: 'bad_request' }, 400);
  }
  // Only open reports can transition; a stale/already-closed id is a 404.
  const upd = await env.DB
    .prepare(`UPDATE abuse_reports SET status = ? WHERE id = ? AND status = 'open'`)
    .bind(status, id)
    .run();
  if ((upd.meta?.changes ?? 0) !== 1) return json({ error: 'not_found' }, 404);
  await audit(env.DB, a.tid, 'abuse.close', 'abuse_report', id as number, String(status));
  return json({ ok: true, id: id, status: status });
}

/* --------------------------------- exports ---------------------------------- */

async function handleExportChallenges(env: Env, a: Auth): Promise<Response> {
  const owner = a.role === 'owner';
  const where = owner ? '' : 'WHERE c.created_by = ?';
  const binds: (string | number)[] = owner ? [] : [a.tid];
  const rows = await env.DB
    .prepare(
      `SELECT c.id, c.title, c.type, c.status, c.channel_chat_id, c.end_at, c.created_at,
         (SELECT COUNT(*) FROM participants p WHERE p.challenge_id = c.id) AS participants,
         (SELECT COUNT(*) FROM winners w WHERE w.challenge_id = c.id) AS winners
       FROM challenges c ${where} ORDER BY c.id DESC LIMIT 10000`
    )
    .bind(...binds)
    .all<ChListItem>();
  const lines: string[] = ['id,title,type,status,channel,end_at_tehran,participants,winners,created_at_tehran'];
  for (const r of rows.results) {
    lines.push(
      [r.id, r.title, r.type, r.status, r.channel_chat_id, fmtTehranDateTime(r.end_at), r.participants, r.winners, fmtTehranDateTime(r.created_at)]
        .map(csvCell)
        .join(',')
    );
  }
  return csvResponse(lines.join('\r\n'), 'cybrix-challenges.csv');
}

async function handleExportParticipants(env: Env, a: Auth, url: URL): Promise<Response> {
  const id = parseInt(url.searchParams.get('id') || '', 10);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_request' }, 400);
  const ch = await env.DB
    .prepare(`SELECT id, title, created_by FROM challenges WHERE id = ?`)
    .bind(id)
    .first<{ id: number; title: string; created_by: number }>();
  if (!ch || (a.role !== 'owner' && ch.created_by !== a.tid)) return json({ error: 'not_found' }, 404);
  const rows = await env.DB
    .prepare(
      `SELECT p.telegram_id, COALESCE(u.first_name, '') AS first_name, COALESCE(u.username, '') AS username,
              p.score, p.status, p.joined_at
       FROM participants p LEFT JOIN users u ON u.telegram_id = p.telegram_id
       WHERE p.challenge_id = ? ORDER BY p.score DESC, p.id ASC LIMIT 20000`
    )
    .bind(id)
    .all<PartRow>();
  const lines: string[] = ['challenge_id,challenge_title,telegram_id,first_name,username,score,status,joined_at_tehran'];
  for (const r of rows.results) {
    lines.push(
      [id, ch.title, r.telegram_id, r.first_name, r.username, r.score, r.status, fmtTehranDateTime(r.joined_at)]
        .map(csvCell)
        .join(',')
    );
  }
  return csvResponse(lines.join('\r\n'), 'cybrix-participants-' + id + '.csv');
}

/* --------------------------- public campaign page --------------------------- */

const PUBLIC_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function publicHtmlHeaders(): Record<string, string> {
  return {
    ...SEC_HEADERS,
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': PUBLIC_CSP,
  };
}

/** Polite 404 — byte-identical for missing AND private challenges, never leaks existence. */
function publicNotFound(): Response {
  const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CYBRIX</title>
<style>
html,body{margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#050b06;color:#e8f5ec;font-family:Inter,'Vazirmatn',system-ui,-apple-system,'Segoe UI',Tahoma,Arial,sans-serif;padding:22px}
.card{max-width:440px;width:100%;text-align:center;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:18px;padding:36px 26px;backdrop-filter:blur(14px)}
h2{font-size:19px;margin:0 0 6px;color:#22ff88}
p{margin:0;font-size:14px;line-height:1.9;color:#8fa89a}
.sep{border:0;border-top:1px solid rgba(255,255,255,.09);margin:16px 0}
.brand{margin-top:18px;font-size:11px;letter-spacing:.35em;color:#22ff88;opacity:.75}
</style>
</head>
<body>
<main class="card" role="main">
  <h2 lang="fa" dir="rtl">این صفحه در دسترس نیست</h2>
  <p lang="fa" dir="rtl">این کمپین عمومی نیست یا وجود ندارد.</p>
  <hr class="sep">
  <h2 lang="en" dir="ltr" style="margin-top:0">Page not available</h2>
  <p lang="en" dir="ltr">This campaign is private or does not exist.</p>
  <div class="brand">CYBRIX</div>
</main>
</body>
</html>`;
  return new Response(html, { status: 404, headers: publicHtmlHeaders() });
}

function medalFor(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '🏅';
}

function publicCampaignHtml(ch: PublicChallengeRow, participants: number, winners: PublicWinnerRow[]): string {
  const statusKey = ch.status === 'finished' ? 'finished' : 'active';
  const typePill = TYPE_LABELS_FA[ch.type]
    ? '<span class="pill" data-l="type_' + esc(ch.type) + '">' + esc(TYPE_LABELS_FA[ch.type]) + '</span>'
    : '<span class="pill">' + esc(ch.type) + '</span>';
  const endAt = fmtTehranDateTime(ch.end_at);
  const desc = esc(ch.description || '').replace(/\r?\n/g, '<br>');
  const prizeLines = (ch.prizes || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  const snap = ch.snapshot_hash ? String(ch.snapshot_hash) : '';
  const finished = ch.status === 'finished';

  let prizesHtml: string;
  if (prizeLines.length) {
    prizesHtml =
      '<ul class="prizes">' +
      prizeLines.map((line) => '<li><span class="medal" aria-hidden="true">🎁</span><span>' + esc(line) + '</span></li>').join('') +
      '</ul>';
  } else {
    prizesHtml = '<ul class="prizes"><li data-l="no_prizes">جایزه‌ای ثبت نشده است</li></ul>';
  }

  let winnersHtml: string;
  if (!finished) {
    winnersHtml = '';
  } else if (winners.length) {
    winnersHtml =
      '<ol class="winners">' +
      winners
        .map(
          (w) =>
            '<li><span class="medal" aria-hidden="true">' +
            medalFor(w.rank) +
            '</span><span class="w-name">' +
            esc(w.first_name || '—') +
            '</span><span class="w-rank">#' +
            esc(w.rank) +
            '</span></li>'
        )
        .join('') +
      '</ol>';
  } else {
    winnersHtml = '<ol class="winners"><li data-l="no_winners">برندگان هنوز اعلام نشده‌اند</li></ol>';
  }
  const winnersSection = finished
    ? '<section class="card"><h2 data-l="winners_label">برندگان</h2>' + winnersHtml + '</section>'
    : '';

  const snapSection = snap
    ? '<section class="card"><span class="k" data-l="snapshot_label">اثبات شفافیت</span><span class="v mono">' +
      esc(snap.slice(0, 14)) +
      '…</span></section>'
    : '';

  const descHtml = desc ? '<p class="desc">' + desc + '</p>' : '';

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ch.title)} — CYBRIX</title>
<style>
:root{--bg:#050b06;--card:rgba(255,255,255,.045);--border:rgba(255,255,255,.09);--text:#e8f5ec;--muted:#8fa89a;--accent:#22ff88;--accent2:#00e676;--info:#7fb5ff}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{min-height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--text);font-family:Inter,'Vazirmatn',system-ui,-apple-system,'Segoe UI',Tahoma,Arial,sans-serif;font-size:15.5px;line-height:1.75;-webkit-font-smoothing:antialiased}
body::before{content:'';position:fixed;inset:0;pointer-events:none;background:radial-gradient(640px 320px at 85% -10%,rgba(34,255,136,.1),transparent 60%),radial-gradient(520px 280px at 8% 110%,rgba(0,230,118,.08),transparent 60%)}
.wrap{position:relative;flex:1;width:100%;max-width:760px;margin:0 auto;padding:0 18px 28px}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 18px;background:rgba(5,11,6,.78);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:10px;min-width:0}
.b-name{font-weight:800;letter-spacing:6px;font-size:18px;background:linear-gradient(90deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent;line-height:1.2}
.b-slogan{color:var(--muted);font-size:10px;letter-spacing:.14em;text-transform:uppercase}
.lang-btn{background:transparent;border:1px solid var(--border);color:var(--text);border-radius:10px;min-width:44px;min-height:40px;font-weight:700;cursor:pointer;font-size:14px}
.lang-btn:hover{border-color:var(--accent);color:var(--accent)}
.card{background:var(--card);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--border);border-radius:16px;padding:22px;margin-top:18px;box-shadow:0 12px 34px rgba(0,0,0,.4)}
.pills{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.pill{display:inline-flex;align-items:center;gap:7px;padding:3px 13px;border-radius:999px;font-size:12.5px;font-weight:700;border:1px solid var(--border);color:var(--muted)}
.pill.st-active{color:var(--accent);border-color:rgba(34,255,136,.45);background:rgba(34,255,136,.08)}
.pill.st-finished{color:var(--info);border-color:rgba(127,181,255,.4);background:rgba(127,181,255,.08)}
h1.title{font-size:clamp(21px,4.5vw,28px);line-height:1.5;margin:0 0 8px;word-break:break-word}
.desc{color:var(--muted);font-size:14.5px;margin:0;word-break:break-word}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px}
.grid .card{margin-top:0;padding:16px 18px}
.k{display:block;color:var(--muted);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
.v{font-size:16px;font-weight:700}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13.5px;direction:ltr;unicode-bidi:embed;word-break:break-all}
h2{font-size:16.5px;margin:0 0 12px}
ul.prizes,ol.winners{list-style:none;margin:0;padding:0;display:grid;gap:9px}
ul.prizes li,ol.winners li{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:12px;padding:10px 14px;font-size:14.5px;flex-wrap:wrap}
.medal{font-size:19px}
.w-name{font-weight:700}
.w-rank{color:var(--muted);font-size:12.5px}
.join{display:flex;align-items:center;justify-content:center;gap:9px;margin:22px 0 8px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#04140a;font-weight:800;font-size:16px;border-radius:14px;padding:15px 22px;text-decoration:none;transition:filter .15s}
.join:hover{filter:brightness(1.07)}
.foot{text-align:center;padding:14px 10px;color:var(--muted);font-size:12.5px;border-top:1px solid var(--border);margin-top:26px}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
@media (max-width:620px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header class="top">
  <div class="brand">
    <svg width="30" height="30" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M32 4 56 18v28L32 60 8 46V18Z" stroke="#22ff88" stroke-width="3"/><path d="M26 24l-8 8 8 8M38 24l8 8-8 8" stroke="#00e676" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div><div class="b-name">CYBRIX</div><div class="b-slogan">Code. Security. Innovation.</div></div>
  </div>
  <button id="lang-btn" class="lang-btn" type="button" aria-label="تغییر زبان / Switch language">EN</button>
</header>
<div class="wrap">
<main>
  <section class="card" style="margin-top:20px">
    <div class="pills">
      <span class="pill st-${statusKey}" data-l="status_${statusKey}">${statusKey === 'active' ? 'فعال' : 'پایان‌یافته'}</span>
      ${typePill}
    </div>
    <h1 class="title">${esc(ch.title)}</h1>
    ${descHtml}
  </section>
  <div class="grid">
    <section class="card"><span class="k" data-l="end_label">زمان پایان</span><span class="v mono">${esc(endAt)}</span></section>
    <section class="card"><span class="k" data-l="participants_label">شرکت‌کننده‌های فعال</span><span class="v">${esc(participants)}</span></section>
  </div>
  <section class="card"><h2 data-l="prizes_label">جوایز</h2>${prizesHtml}</section>
  ${winnersSection}
  ${snapSection}
  <a class="join" href="https://t.me" target="_blank" rel="noopener noreferrer"><span data-l="join_btn">عضویت در بات</span></a>
</main>
</div>
<footer class="foot">CYBRIX — Code. Security. Innovation. 💚</footer>
<script>
(function(){
'use strict';
var L={
fa:{
  status_active:'فعال',status_finished:'پایان‌یافته',
  type_random:'قرعه‌کشی',type_vote:'رأی‌گیری',type_referral:'دعوت',type_quiz:'آزمون',type_photo:'عکاسی',type_points:'امتیازی',
  end_label:'زمان پایان',participants_label:'شرکت‌کننده‌های فعال',
  prizes_label:'جوایز',no_prizes:'جایزه‌ای ثبت نشده است',
  winners_label:'برندگان',no_winners:'برندگان هنوز اعلام نشده‌اند',
  snapshot_label:'اثبات شفافیت (هش لحظه‌ای نتایج)',
  join_btn:'عضویت در بات'
},
en:{
  status_active:'Active',status_finished:'Finished',
  type_random:'Lottery',type_vote:'Voting',type_referral:'Referral',type_quiz:'Quiz',type_photo:'Photo',type_points:'Points',
  end_label:'Ends at',participants_label:'Active participants',
  prizes_label:'Prizes',no_prizes:'No prizes announced',
  winners_label:'Winners',no_winners:'Winners not announced yet',
  snapshot_label:'Transparency proof (results snapshot hash)',
  join_btn:'Join via bot'
}};
function setLang(l){
  document.documentElement.lang=l;
  document.documentElement.dir=(l==='fa')?'rtl':'ltr';
  var els=document.querySelectorAll('[data-l]');
  for(var i=0;i<els.length;i++){
    var k=els[i].getAttribute('data-l');
    if(L[l][k]!==undefined)els[i].textContent=L[l][k];
  }
  var b=document.getElementById('lang-btn');
  if(b)b.textContent=(l==='fa')?'EN':'FA';
  try{localStorage.setItem('cybrix_pub_lang',l);}catch(e){}
}
var btn=document.getElementById('lang-btn');
if(btn)btn.addEventListener('click',function(){
  setLang(document.documentElement.lang==='fa'?'en':'fa');
});
var saved='fa';
try{saved=localStorage.getItem('cybrix_pub_lang')||'fa';}catch(e){}
if(saved!=='fa')setLang(saved);
})();
</script>
</body>
</html>`;
}

async function handlePublicChallenge(env: Env, id: number): Promise<Response> {
  await ensureSchema(env.DB);
  const ch = await env.DB
    .prepare(
      `SELECT id, type, title, description, status, end_at, winners_count, prizes, snapshot_hash, config
       FROM challenges WHERE id = ?`
    )
    .bind(id)
    .first<PublicChallengeRow>();
  // Same polite 404 whether the challenge is missing, private, draft, paused or cancelled.
  const isPublic =
    !!ch && (ch.status === 'active' || ch.status === 'finished') && parsePublicPageFlag(ch.config);
  if (!ch || !isPublic) return publicNotFound();

  const parts = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM participants WHERE challenge_id = ? AND status = 'active'`)
    .bind(id)
    .first<{ n: number }>();

  // Public winners = main ranks only (rank <= winners_count); alternates are never exposed.
  let winners: PublicWinnerRow[] = [];
  if (ch.status === 'finished' && ch.winners_count > 0) {
    const w = await env.DB
      .prepare(
        `SELECT w.rank, COALESCE(u.first_name, '') AS first_name
         FROM winners w LEFT JOIN users u ON u.telegram_id = w.telegram_id
         WHERE w.challenge_id = ? AND w.rank <= ? ORDER BY w.rank ASC LIMIT 100`
      )
      .bind(id, ch.winners_count)
      .all<PublicWinnerRow>();
    winners = w.results;
  }

  return new Response(publicCampaignHtml(ch, parts?.n ?? 0, winners), {
    status: 200,
    headers: publicHtmlHeaders(),
  });
}

/* ---------------------------------- router ---------------------------------- */

const API_PATHS = [
  '/api/login',
  '/api/me',
  '/api/summary',
  '/api/challenges',
  '/api/transactions',
  '/api/tickets',
  '/api/reports',
  '/api/reports/close',
  '/api/export/challenges.csv',
  '/api/export/participants.csv',
];

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;
    try {
      if (path === '/health' && method === 'GET') {
        await ensureSchema(env.DB);
        let db = 'ok';
        try {
          await env.DB.prepare(`SELECT 1`).first();
        } catch {
          db = 'fail';
        }
        return json({ ok: db === 'ok', service: 'cybrix-web-panel', version: env.VERSION || 'dev', db });
      }

      if (path === '/' && method === 'GET') return htmlResponse();

      // Public campaign page — no session required; polite 404 for anything not public.
      if (path === '/c' || path.startsWith('/c/')) {
        const pubMatch = /^\/c\/(\d+)$/.exec(path);
        if (method === 'GET' && pubMatch) return handlePublicChallenge(env, parseInt(pubMatch[1], 10));
        return publicNotFound();
      }

      if (path === '/api/login' && method === 'POST') {
        await ensureSchema(env.DB);
        return handleLogin(env, request);
      }

      await ensureSchema(env.DB);
      const auth = await authenticate(env, request);
      if (!auth) return json({ error: 'unauthorized' }, 401);

      if (path === '/api/me' && method === 'GET') return handleMe(env, auth);
      if (path === '/api/summary' && method === 'GET') return handleSummary(env, auth);
      if (path === '/api/challenges' && method === 'GET') return handleChallengesList(env, auth, url);

      const chMatch = /^\/api\/challenges\/(\d+)$/.exec(path);
      if (chMatch && method === 'GET') return handleChallengeDetail(env, auth, parseInt(chMatch[1], 10));

      if (path === '/api/transactions' && method === 'GET') return handleTransactions(env, auth, url);
      if (path === '/api/tickets' && method === 'GET') return handleTickets(env, auth);
      if (path === '/api/reports' && method === 'GET') return handleReportsList(env, auth);
      if (path === '/api/reports/close' && method === 'POST') return handleReportClose(env, auth, request);
      if (path === '/api/export/challenges.csv' && method === 'GET') return handleExportChallenges(env, auth);
      if (path === '/api/export/participants.csv' && method === 'GET') return handleExportParticipants(env, auth, url);

      if (path.startsWith('/api/')) {
        const known = API_PATHS.includes(path) || /^\/api\/challenges\/\d+$/.test(path);
        return json({ error: known ? 'method_not_allowed' : 'not_found' }, known ? 405 : 404);
      }
      return method === 'GET' ? htmlResponse() : json({ error: 'not_found' }, 404);
    } catch (e) {
      console.error('cybrix-web-panel error:', e);
      return json({ error: 'internal' }, 500);
    }
  },
};

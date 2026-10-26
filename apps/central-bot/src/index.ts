/** CYBRIX Central Bot — Cloudflare Worker entrypoint. */
import type { Env, TgUpdate, TgMessage, TgCallbackQuery } from './types';
import { ensureSchema, now, audit } from './db';
import { Tg, kb } from './tg';
import { t, type Lang } from '../../../packages/shared/src/i18n';
import {
  ensureUser, isOwner, passesJoinGate, rateLimited, joinGateKeyboard, mainMenuKeyboard, mandatoryChannels,
} from './users';
import { getWallet, total, txHistory, redeemCode } from './wallet';
import {
  wizardStart, wizardInput, wizardCallback, handleStartChallenge, rejoinCheck, castVote, answerQuiz,
  handleReferral, sweepExpired, esc, getWizard,
} from './challenges';
import {
  makePanelCode, broadcast, adminGrant, makeGiftCode, myStats, openTicketsList, replyTicket, platformStats,
} from './admin';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const PANEL_URL_FALLBACK = 'https://cybrix-web-panel.official-cybrix.workers.dev';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      await ensureSchema(env.DB);
      let db = 'ok';
      try { await env.DB.prepare(`SELECT 1`).first(); } catch { db = 'fail'; }
      return new Response(JSON.stringify({ ok: true, service: 'cybrix-central-bot', version: env.VERSION, db, time: now() }), { headers: JSON_HEADERS });
    }

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(
        `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CYBRIX Central Bot</title><style>body{background:#071007;color:#39ff8b;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center}h1{letter-spacing:6px}p{color:#9adf9a}</style></head>
<body><div><h1>CYBRIX</h1><p>Code. Security. Innovation.</p><p>✅ Central challenge bot is running — v${env.VERSION}</p></div></body></html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } }
      );
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (secret !== env.WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      const update = (await request.json()) as TgUpdate;
      // idempotency
      try {
        await ensureSchema(env.DB);
        const dup = await env.DB.prepare(`INSERT INTO webhook_events (update_id, processed_at) VALUES (?,?) ON CONFLICT DO NOTHING`)
          .bind(update.update_id, now()).run();
        if ((dup.meta?.changes ?? 0) === 0) return new Response('ok'); // duplicate
      } catch {
        return new Response('ok'); // fail-safe: never block Telegram retries forever
      }
      ctx.waitUntil(
        handleUpdate(env, update).catch(async (e) => {
          console.error('update failed', e);
          try {
            await env.DB.prepare(`INSERT INTO audit_events (actor_tid, action, target_type, target_id, meta, created_at) VALUES (NULL,'update.error','','',?,?)`)
              .bind(String(e?.stack || e).slice(0, 800), now()).run();
          } catch { /* ignore */ }
        })
      );
      return new Response('ok');
    }

    return new Response(JSON.stringify({ service: 'cybrix-central-bot', version: env.VERSION }), { headers: JSON_HEADERS });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    await ensureSchema(env.DB);
    const tg = new Tg(env);
    ctx.waitUntil(sweepExpired(env, tg));
  },
};

/* -------------------------- Special input flows --------------------------- */

async function handleSpecialInput(env: Env, tg: Tg, chatId: number, tid: number, lang: Lang, text: string, step: string): Promise<boolean> {
  const { setWizard } = await import('./challenges');

  if (step === 'channel_add') {
    const ref = text.trim();
    if (!/^(@[A-Za-z0-9_]{3,64}|-100\d{6,})$/.test(ref)) {
      await tg.sendMessage(chatId, t(lang, 'channel_add'));
      return true;
    }
    const chat = await tg.getChat(ref);
    if (!chat) { await tg.sendMessage(chatId, t(lang, 'channel_not_admin')); return true; }
    const chatIdStr = String(chat.id);
    // requester must be admin/creator of that channel
    const userMember = await tg.getChatMember(chatIdStr, tid);
    if (!userMember || !['administrator', 'creator'].includes(userMember.status)) {
      await tg.sendMessage(chatId, t(lang, 'channel_not_admin'));
      return true;
    }
    // bot must be admin with post rights
    const me = await tg.getMe();
    const botMember = me ? await tg.getChatMember(chatIdStr, me.id) : null;
    if (!botMember || !['administrator', 'creator'].includes(botMember.status) || botMember.can_post_messages === false) {
      await tg.sendMessage(chatId, t(lang, 'channel_not_admin'));
      return true;
    }
    const dup = await env.DB.prepare(`SELECT id FROM channels WHERE chat_id=?`).bind(chatIdStr).first();
    if (dup) { await tg.sendMessage(chatId, t(lang, 'channel_dup'), mainMenuKeyboard(lang, 'user')); await setWizard(env, tid, null, {}); return true; }
    await env.DB.prepare(`INSERT INTO channels (org_id, chat_id, title, username, owner_tid, status, added_at) VALUES (NULL,?,?,?,?, 'active', ?)`)
      .bind(chatIdStr, chat.title || '', chat.username || '', tid, now()).run();
    await setWizard(env, tid, null, {});
    await audit(env.DB, tid, 'channel.register', 'channel', chatIdStr, chat.title || '');
    await tg.sendMessage(chatId, t(lang, 'channel_added', { title: esc(chat.title || chatIdStr) }), mainMenuKeyboard(lang, 'user'));
    return true;
  }

  if (step === 'support_msg') {
    const ins = await env.DB.prepare(`INSERT INTO support_tickets (telegram_id, subject, status, created_at, updated_at) VALUES (?,?, 'open', ?, ?)`)
      .bind(tid, text.slice(0, 80), now(), now()).run();
    const ticketId = ins.meta?.last_row_id ?? 0;
    await env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, sender_tid, from_role, text, created_at) VALUES (?,?,?,?,?)`)
      .bind(ticketId, tid, 'user', text.slice(0, 2000), now()).run();
    await setWizard(env, tid, null, {});
    await tg.sendMessage(chatId, t(lang, 'support_saved', { id: ticketId }), mainMenuKeyboard(lang, 'user'));
    return true;
  }

  if (step === 'broadcast_msg') {
    if (!(await isOwner(env, tid))) { await setWizard(env, tid, null, {}); return true; }
    await setWizard(env, tid, null, {});
    await tg.sendMessage(chatId, '⏳ ...');
    const res = await broadcast(env, tg, text);
    await tg.sendMessage(chatId, t(lang, 'broadcast_done', { ok: res.ok, fail: res.fail }));
    return true;
  }
  return false;
}

/* --------------------------------- Handler -------------------------------- */

async function handleUpdate(env: Env, u: TgUpdate): Promise<void> {
  const tg = new Tg(env);

  if (u.callback_query) return handleCallback(env, tg, u.callback_query);
  const msg = u.message;
  if (!msg?.from || msg.from.is_bot) return;
  if (msg.chat.type !== 'private') return; // channel posts & groups handled separately later

  const tid = msg.from.id;
  const chatId = msg.chat.id;

  if (rateLimited(tid)) {
    await tg.sendMessage(chatId, t('fa', 'rate_limited'));
    return;
  }

  const user = await ensureUser(env, msg.from);
  if (!user) return;
  const lang: Lang = user.lang ?? 'fa';

  if (user.status === 'banned') {
    await tg.sendMessage(chatId, t(lang, 'blocked', { reason: 'policy violation' }));
    return;
  }

  const text = (msg.text || '').trim();

  // /start with deep-link payloads: ch{id} | ref{chid}_{inviter}
  if (text.startsWith('/start')) {
    const payload = text.split(' ')[1] || '';
    const gate = await passesJoinGate(env, tg, tid);
    if (!gate && !(await isOwner(env, tid))) {
      await tg.sendMessage(chatId, t(lang, 'welcome', { name: 'CYBRIX' }) + '\n\n' + t(lang, 'join_required', { name: 'CYBRIX' }), joinGateKeyboard(env, lang));
      return;
    }
    if (payload.startsWith('ch')) {
      const chId = parseInt(payload.slice(2), 10);
      if (Number.isInteger(chId)) { await handleStartChallenge(env, tg, chatId, tid, chId); return; }
    }
    if (payload.startsWith('ref')) {
      const m = payload.slice(3).match(/^(\d+)_(\d+)$/);
      if (m) { await handleReferral(env, tg, chatId, tid, parseInt(m[1], 10), parseInt(m[2], 10)); }
    }
    await tg.sendMessage(chatId, t(lang, 'welcome', { name: 'CYBRIX' }) + '\n\n' + t(lang, 'main_menu'), mainMenuKeyboard(lang, user.role));
    return;
  }

  // wizard / special input state (commands always take precedence over wizard input)
  const wiz = await getWizard(env, tid);
  const isCommand = text.startsWith('/') && text !== '/cancel';

  // special wizard inputs (channel registration / support / broadcast)
  if (!isCommand && wiz && ['channel_add', 'support_msg', 'broadcast_msg'].includes(wiz.step)) {
    if (text === '/cancel') {
      const { setWizard } = await import('./challenges');
      await setWizard(env, tid, null, {});
      await tg.sendMessage(chatId, t(lang, 'wz_cancelled'), mainMenuKeyboard(lang, 'user'));
      return;
    }
    const handled = await handleSpecialInput(env, tg, chatId, tid, lang, text, wiz.step);
    if (handled) return;
  }

  // challenge wizard text input
  if (!isCommand && wiz && wiz.step !== 'confirm' && !['channel_add', 'support_msg', 'broadcast_msg'].includes(wiz.step)) {
    if (text === '/cancel') {
      const { setWizard } = await import('./challenges');
      await setWizard(env, tid, null, {});
      await tg.sendMessage(chatId, t(lang, 'wz_cancelled'), mainMenuKeyboard(lang, 'user'));
      return;
    }
    const handled = await wizardInput(env, tg, chatId, tid, lang, text);
    if (handled) return;
  }

  switch (text.split(' ')[0].split('@')[0]) {
    case '/help':
      await tg.sendMessage(chatId, t(lang, 'help_text', { name: 'CYBRIX' }));
      return;
    case '/panel': {
      const code = await makePanelCode(env, tid);
      const panelUrl = (env as any).PANEL_URL || PANEL_URL_FALLBACK;
      await tg.sendMessage(chatId, t(lang, 'panel_code', { code, url: panelUrl }));
      return;
    }
    case '/wallet': {
      const w = await getWallet(env, tid);
      const rows = [[{ text: '🎟 /redeem CODE', callback_data: 'noop' }]];
      await tg.sendMessage(chatId, t(lang, 'wallet_empty', {
        free: w.free, gift: w.gift, purchased: w.purchased, total: total(w),
      }), kb(rows));
      return;
    }
    case '/lang':
      await tg.sendMessage(chatId, t(lang, 'lang_choose'), kb([
        [{ text: 'فارسی 🇮🇷', callback_data: 'lang:fa' }, { text: 'English 🇬🇧', callback_data: 'lang:en' }],
      ]));
      return;
    case '/mychannels': {
      const chans = await env.DB.prepare(`SELECT title, chat_id FROM channels WHERE owner_tid=? AND status='active' ORDER BY id DESC`).bind(tid).all<{ title: string; chat_id: string }>();
      const rows: any = [[{ text: '➕ افزودن کانال / Add', callback_data: 'menu:chadd' }]];
      await tg.sendMessage(chatId, chans.results.length
        ? t(lang, 'channels_list', { list: chans.results.map((c) => `• ${esc(c.title || c.chat_id)}`).join('\n') })
        : t(lang, 'channels_none'), kb(rows));
      return;
    }
    case '/create':
      await wizardStart(env, tg, chatId, tid);
      return;
    case '/mystats':
      await myStats(env, chatId, tid);
      return;
    case '/support':
      await env.DB.prepare(`INSERT INTO wizard_state (telegram_id, step, data, updated_at) VALUES (?,?,?,?)
        ON CONFLICT(telegram_id) DO UPDATE SET step=excluded.step, data=excluded.data, updated_at=excluded.updated_at`)
        .bind(tid, 'support_msg', '{}', now()).run();
      await tg.sendMessage(chatId, t(lang, 'support_intro'));
      return;
    case '/redeem': {
      const code = text.split(' ')[1] || '';
      const amt = code ? await redeemCode(env, tid, code) : null;
      await tg.sendMessage(chatId, amt ? t(lang, 'redeem_ok', { amount: amt }) : t(lang, 'redeem_bad'));
      return;
    }
    // owner commands
    case '/stats':
      if (await isOwner(env, tid)) await tg.sendMessage(chatId, `<pre>${await platformStats(env)}</pre>`);
      return;
    case '/grant':
      await adminGrant(env, tg, chatId, tid, text.split(' ').slice(1));
      return;
    case '/gencode':
      await makeGiftCode(env, tg, chatId, tid, text.split(' ').slice(1));
      return;
    case '/broadcast': {
      if (!(await isOwner(env, tid))) return;
      await env.DB.prepare(`INSERT INTO wizard_state (telegram_id, step, data, updated_at) VALUES (?,?,?,?)
        ON CONFLICT(telegram_id) DO UPDATE SET step=excluded.step, data=excluded.data, updated_at=excluded.updated_at`)
        .bind(tid, 'broadcast_msg', '{}', now()).run();
      await tg.sendMessage(chatId, t(lang, 'broadcast_ask'));
      return;
    }
    case '/tickets':
      await openTicketsList(env, tg, chatId, tid);
      return;
    case '/reply': {
      const parts = text.split(' ');
      await replyTicket(env, tg, chatId, tid, [parts[1]], text);
      return;
    }
    case '/version':
      await tg.sendMessage(chatId, `CYBRIX v${env.VERSION} • Worker: central-bot`);
      return;
  }
}

/* -------------------------------- Callbacks ------------------------------- */

async function handleCallback(env: Env, tg: Tg, cb: TgCallbackQuery): Promise<void> {
  if (!cb.message) { await tg.answerCallback(cb.id, ''); return; }
  const chatId = cb.message.chat.id;
  const tid = cb.from.id;
  const data = cb.data || '';

  if (rateLimited(tid)) { await tg.answerCallback(cb.id, t('fa', 'rate_limited'), true); return; }
  const user = await ensureUser(env, cb.from);
  const lang: Lang = user?.lang ?? 'fa';

  // language
  if (data.startsWith('lang:')) {
    const l = data.slice(5) === 'en' ? 'en' : 'fa';
    await env.DB.prepare(`UPDATE users SET lang=? WHERE telegram_id=?`).bind(l, tid).run();
    await tg.answerCallback(cb.id, '');
    await tg.sendMessage(chatId, t(l, 'main_menu'), mainMenuKeyboard(l, user?.role ?? 'user'));
    return;
  }

  if (data === 'menu:start' || data.startsWith('menu:') || data === 'noop') {
    if (data === 'menu:start') {
      const gate = await passesJoinGate(env, tg, tid);
      if (!gate && !(await isOwner(env, tid))) {
        await tg.answerCallback(cb.id, '');
        await tg.sendMessage(chatId, t(lang, 'join_required', { name: 'CYBRIX' }), joinGateKeyboard(env, lang));
        return;
      }
      await tg.answerCallback(cb.id, '');
      await tg.sendMessage(chatId, t(lang, 'main_menu'), mainMenuKeyboard(lang, user?.role ?? 'user'));
      return;
    }
    await tg.answerCallback(cb.id, '');
    switch (data) {
      case 'menu:challenges': {
        const chs = await env.DB.prepare(`SELECT id, title, type, end_at FROM challenges WHERE status='active' ORDER BY id DESC LIMIT 10`).all<{ id: number; title: string; type: string; end_at: number }>();
        if (!chs.results.length) { await tg.sendMessage(chatId, t(lang, 'no_challenges')); return; }
        const rows = chs.results.map((c) => [{ text: `${c.title} (${c.type})`, callback_data: `ch:open:${c.id}` }]);
        await tg.sendMessage(chatId, t(lang, 'challenges_list', { list: '' }), kb(rows));
        return;
      }
      case 'menu:mychannels':
        await tg.sendMessage(chatId, t(lang, 'channel_add'));
        return;
      case 'menu:chadd': {
        await env.DB.prepare(`INSERT INTO wizard_state (telegram_id, step, data, updated_at) VALUES (?,?,?,?)
          ON CONFLICT(telegram_id) DO UPDATE SET step=excluded.step, data='', updated_at=excluded.updated_at`)
          .bind(tid, 'channel_add', '{}', now()).run();
        await tg.sendMessage(chatId, t(lang, 'channel_add'));
        return;
      }
      case 'menu:wallet': {
        const w = await getWallet(env, tid);
        const tx = await txHistory(env, tid, 10);
        const list = tx.results.map((r) => `${r.kind === 'spend' ? '➖' : '➕'} ${r.amount} (${r.wallet_kind}) — ${r.reason}`).join('\n');
        await tg.sendMessage(chatId, t(lang, 'wallet_empty', { free: w.free, gift: w.gift, purchased: w.purchased, total: total(w) }) + '\n\n' + (list ? t(lang, 'tx_history', { list }) : ''));
        return;
      }
      case 'menu:stats':
        await myStats(env, chatId, tid);
        return;
      case 'menu:support':
        await env.DB.prepare(`INSERT INTO wizard_state (telegram_id, step, data, updated_at) VALUES (?,?,?,?)
          ON CONFLICT(telegram_id) DO UPDATE SET step=excluded.step, data=excluded.data, updated_at=excluded.updated_at`)
          .bind(tid, 'support_msg', '{}', now()).run();
        await tg.sendMessage(chatId, t(lang, 'support_intro'));
        return;
      case 'menu:lang':
        await tg.sendMessage(chatId, t(lang, 'lang_choose'), kb([
          [{ text: 'فارسی 🇮🇷', callback_data: 'lang:fa' }, { text: 'English 🇬🇧', callback_data: 'lang:en' }],
        ]));
        return;
    }
    return;
  }

  // wizard callbacks
  if (data.startsWith('wz:')) {
    const [, action, arg] = data.split(':');
    await wizardCallback(env, tg, chatId, tid, cb.message.message_id, cb.id, action, arg ?? '');
    return;
  }

  // challenge callbacks
  if (data.startsWith('ch:')) {
    const [, action, a1, a2] = data.split(':');
    if (action === 'open') {
      await tg.answerCallback(cb.id, '');
      await handleStartChallenge(env, tg, chatId, tid, parseInt(a1, 10));
      return;
    }
    if (action === 'rejoin') {
      await rejoinCheck(env, tg, chatId, tid, cb.id, parseInt(a1, 10));
      return;
    }
    if (action === 'join') {
      await tg.answerCallback(cb.id, '');
      await handleStartChallenge(env, tg, chatId, tid, parseInt(a1, 10));
      return;
    }
    if (action === 'vote') {
      const ch = await env.DB.prepare(`SELECT * FROM challenges WHERE id=?`).bind(parseInt(a1, 10)).first<any>();
      if (!ch) { await tg.answerCallback(cb.id, t(lang, 'err_generic'), true); return; }
      await tg.answerCallback(cb.id, '');
      const { openVoteList } = await import('./challenges');
      await openVoteList(env, tg, chatId, ch, lang, parseInt(a2 || '0', 10));
      return;
    }
    if (action === 'votefor') {
      await castVote(env, tg, chatId, tid, cb.id, parseInt(a1, 10), parseInt(a2, 10));
      return;
    }
    if (action === 'mylink') {
      const ch = await env.DB.prepare(`SELECT * FROM challenges WHERE id=?`).bind(parseInt(a1, 10)).first<any>();
      if (ch) {
        await tg.answerCallback(cb.id, '');
        const { sendRefLink } = await import('./challenges') as any;
        // sendRefLink is private; replicate quickly
        const me = await tg.getMe();
        const link = `https://t.me/${me?.username}?start=ref${ch.id}_${tid}`;
        const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM referrals WHERE challenge_id=? AND inviter_tid=? AND valid=1`).bind(ch.id, tid).first<{ n: number }>();
        await tg.sendMessage(chatId, t(lang, 'ref_link', { title: esc(ch.title), link, count: count?.n ?? 0 }));
      }
      return;
    }
  }

  // quiz answers
  if (data.startsWith('qz:')) {
    const [, qid, idx] = data.split(':');
    await answerQuiz(env, tg, chatId, tid, cb.id, parseInt(qid, 10), parseInt(idx, 10));
    return;
  }
}

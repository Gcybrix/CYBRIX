/** CYBRIX Standalone Bot — self-contained challenge bot running on the customer's own Cloudflare account. */
import type { Env, TgUpdate, TgMessage, TgCallbackQuery } from './types';
import { ensureSchema, now, audit } from './db';
import { Tg, kb } from './tg';
import { t, type Lang } from '../../../packages/shared/src/i18n';
import {
  ensureUser, isOwner, passesJoinGate, rateLimited, joinGateKeyboard, mainMenuKeyboard,
  brandName, bootstrapOwner, getMandatoryChannels, addMandatoryChannel, removeMandatoryChannel,
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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      await ensureSchema(env.DB);
      let db = 'ok';
      try { await env.DB.prepare(`SELECT 1`).first(); } catch { db = 'fail'; }
      return new Response(JSON.stringify({ ok: true, service: 'cybrix-standalone-bot', version: env.VERSION, db, time: now() }), { headers: JSON_HEADERS });
    }

    if (request.method === 'GET' && url.pathname === '/') {
      const brand = brandName(env);
      return new Response(
        `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${brand} Standalone Bot</title><style>body{background:#071007;color:#39ff8b;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center}h1{letter-spacing:6px}p{color:#9adf9a}</style></head>
<body><div><h1>${brand}</h1><p>Code. Security. Innovation.</p><p>✅ Standalone challenge bot is running — v${env.VERSION}</p></div></body></html>`,
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
      ctx.waitUntil(handleUpdate(env, update).catch((e) => console.error('update failed', e)));
      return new Response('ok');
    }

    return new Response(JSON.stringify({ service: 'cybrix-standalone-bot', version: env.VERSION }), { headers: JSON_HEADERS });
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

  const text = (msg.text || '').trim();

  // Standalone owner bootstrap: when OWNER_TG_ID is empty or "0", the FIRST /start claims ownership.
  if (text.startsWith('/start')) await bootstrapOwner(env, tid);

  const user = await ensureUser(env, msg.from);
  if (!user) return;
  const lang: Lang = user.lang ?? 'fa';

  if (user.status === 'banned') {
    await tg.sendMessage(chatId, t(lang, 'blocked', { reason: 'policy violation' }));
    return;
  }

  // /start with deep-link payloads: ch{id} | ref{chid}_{inviter}
  if (text.startsWith('/start')) {
    const payload = text.split(' ')[1] || '';
    const brand = brandName(env);
    const gate = await passesJoinGate(env, tg, tid);
    if (!gate && !(await isOwner(env, tid))) {
      await tg.sendMessage(chatId, t(lang, 'welcome', { name: brand }) + '\n\n' + t(lang, 'join_required', { name: brand }), await joinGateKeyboard(env, lang));
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
    await tg.sendMessage(chatId, t(lang, 'welcome', { name: brand }) + '\n\n' + t(lang, 'main_menu'), mainMenuKeyboard(lang, user.role));
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
    case '/help': {
      const setch = lang === 'fa'
        ? '\n\nمالک (استندالون):\n/setchannels list | add @channel | remove @channel — مدیریت کانال‌های اجباری'
        : '\n\nOwner (standalone):\n/setchannels list | add @channel | remove @channel — manage mandatory channels';
      await tg.sendMessage(chatId, t(lang, 'help_text', { name: brandName(env) }) + setch);
      return;
    }
    case '/panel': {
      const code = await makePanelCode(env, tid); // always issue — valid even before panel deployment
      const panelUrl = (env.PANEL_URL || '').trim();
      if (panelUrl) {
        await tg.sendMessage(chatId, t(lang, 'panel_code', { code, url: panelUrl }));
      } else {
        await tg.sendMessage(chatId, lang === 'fa'
          ? `🔑 کد ورود پنل وب (۵ دقیقه اعتبار):\n\n${code}\n\nℹ️ آدرس پنل وب هنوز مستقر نشده است؛ پس از استقرار پنل، این کد را در صفحه ورود پنل وارد کنید.\n\nاین کد را با کسی به اشتراک نگذارید.`
          : `🔑 Web panel login code (valid 5 minutes):\n\n${code}\n\nℹ️ The panel URL is not deployed yet; once your web panel goes live, enter this code on its login page.\n\nDo not share this code.`);
      }
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
    case '/setchannels': {
      if (!(await isOwner(env, tid))) return;
      const parts = text.split(/\s+/);
      const sub = (parts[1] || 'list').toLowerCase();
      const arg = parts.slice(2).join(' ').trim();
      const usage = lang === 'fa'
        ? 'فرمت:\n/setchannels list — نمایش فهرست\n/setchannels add @channel — افزودن کانال\n/setchannels remove @channel — حذف کانال'
        : 'Usage:\n/setchannels list — show list\n/setchannels add @channel — add channel\n/setchannels remove @channel — remove channel';
      const numbered = (list: string[]) => list.map((c, i) => `${i + 1}. ${c}`).join('\n');
      if (sub === 'list') {
        const chans = await getMandatoryChannels(env);
        const body = chans.length ? numbered(chans) : (lang === 'fa' ? '— (فهرست خالی است)' : '— (list is empty)');
        await tg.sendMessage(chatId, lang === 'fa'
          ? `📢 کانال‌های اجباری فعلی:\n\n${body}`
          : `📢 Current mandatory channels:\n\n${body}`);
        return;
      }
      if (sub === 'add') {
        if (!arg) { await tg.sendMessage(chatId, usage); return; }
        const r = await addMandatoryChannel(env, tg, arg);
        if (r.ok) {
          const chans = await getMandatoryChannels(env);
          await tg.sendMessage(chatId, lang === 'fa'
            ? `✅ ${arg} به کانال‌های اجباری اضافه شد.\n\n📢 فهرست فعلی:\n${numbered(chans)}`
            : `✅ ${arg} added to mandatory channels.\n\n📢 Current list:\n${numbered(chans)}`);
        } else if (r.error === 'format') {
          await tg.sendMessage(chatId, lang === 'fa'
            ? '❌ فرمت نامعتبر است. مثال: @mychannel'
            : '❌ Invalid format. Example: @mychannel');
        } else if (r.error === 'not_found') {
          await tg.sendMessage(chatId, lang === 'fa'
            ? '❌ کانال یافت نشد یا بات به آن دسترسی ندارد.'
            : '❌ Channel not found, or the bot cannot see it.');
        } else {
          await tg.sendMessage(chatId, lang === 'fa'
            ? 'ℹ️ این کانال قبلاً در فهرست است.'
            : 'ℹ️ This channel is already in the list.');
        }
        return;
      }
      if (sub === 'remove') {
        if (!arg) { await tg.sendMessage(chatId, usage); return; }
        const ok = await removeMandatoryChannel(env, arg);
        await tg.sendMessage(chatId, ok
          ? (lang === 'fa' ? `✅ ${arg} از کانال‌های اجباری حذف شد.` : `✅ ${arg} removed from mandatory channels.`)
          : (lang === 'fa' ? '❌ این کانال در فهرست نیست یا فرمت نامعتبر است (مثال: @mychannel).' : '❌ Channel not in the list, or invalid format (e.g. @mychannel).'));
        return;
      }
      await tg.sendMessage(chatId, usage);
      return;
    }
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
      await tg.sendMessage(chatId, `${brandName(env)} v${env.VERSION} • Worker: standalone-bot`);
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
        await tg.sendMessage(chatId, t(lang, 'join_required', { name: brandName(env) }), await joinGateKeyboard(env, lang));
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

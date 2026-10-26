/**
 * Challenge engine — lifecycle, wizard FSM, participation (join/vote/referral/quiz),
 * secure lottery with commit–reveal, winner selection & announcements.
 */
import type { Env, DBUserRow } from './types';
import { now, audit } from './db';
import { t, type Lang } from '../../../packages/shared/src/i18n';
import {
  CREDIT_COSTS, CREDIT_LABELS, DEFAULT_CONFIG, parseJson, parseTehranDateTime, fmtTehranDateTime,
  randHex, sha256Hex, type ChallengeConfig, type ChallengeType,
} from '../../../packages/shared/src/config';
import { Tg, kb, userMention } from './tg';
import { passesJoinGate, mainMenuKeyboard } from './users';
import { spend, refund, getWallet, total, grant } from './wallet';

export interface ChallengeRow {
  id: number;
  channel_chat_id: string;
  created_by: number;
  type: ChallengeType;
  title: string;
  description: string;
  status: 'draft' | 'active' | 'paused' | 'finished' | 'cancelled';
  end_at: number;
  winners_count: number;
  prizes: string;
  rules_version: string;
  config: string;
  commit_hash: string | null;
  commit_salt: string | null;
  snapshot_hash: string | null;
  message_id: number | null;
  cost: number;
  reminded: number;
}

const WIZARD_STEPS = ['type', 'title', 'desc', 'channel', 'end', 'winners', 'prizes', 'quiz_questions', 'confirm'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export async function getWizard(env: Env, tid: number) {
  return env.DB.prepare(`SELECT step, data FROM wizard_state WHERE telegram_id=?`).bind(tid).first<{ step: WizardStep; data: string }>();
}
export async function setWizard(env: Env, tid: number, step: WizardStep | null, data: unknown) {
  if (!step) {
    await env.DB.prepare(`DELETE FROM wizard_state WHERE telegram_id=?`).bind(tid).run();
    return;
  }
  await env.DB
    .prepare(
      `INSERT INTO wizard_state (telegram_id, step, data, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(telegram_id) DO UPDATE SET step=excluded.step, data=excluded.data, updated_at=excluded.updated_at`
    )
    .bind(tid, step, JSON.stringify(data), now())
    .run();
}

export function previewText(lang: Lang, c: {
  title: string; description: string; type: string; end_at: number; winners_count: number; prizes: string; rules_version: string;
}): string {
  const prizes = c.prizes || '-';
  return t(lang, 'preview_tpl', {
    title: esc(c.title), desc: esc(c.description), type: CREDIT_LABELS[c.type]?.[lang] ?? c.type,
    end: fmtTehranDateTime(c.end_at), winners: c.winners_count, prizes: esc(prizes), rules_version: c.rules_version,
  });
}

export function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ------------------------------- Wizard (FSM) ------------------------------ */

export async function wizardStart(env: Env, tg: Tg, chatId: number, tid: number): Promise<void> {
  const chans = await env.DB.prepare(`SELECT chat_id, title FROM channels WHERE owner_tid=? AND status='active' ORDER BY id DESC LIMIT 20`).bind(tid).all<{ chat_id: string; title: string }>();
  if (!chans.results.length) {
    await tg.sendMessage(chatId, t('fa', 'wz_no_channel') + '\n\n' + t('en', 'wz_no_channel'), mainMenuKeyboard('fa', 'user'));
    return;
  }
  await setWizard(env, tid, 'type', {});
  const rows = (Object.keys(CREDIT_COSTS) as ChallengeType[]).map((tp) => [
    { text: `${CREDIT_LABELS[tp].fa} — ${CREDIT_COSTS[tp]} اعتبار`, callback_data: `wz:type:${tp}` },
  ]);
  rows.push([{ text: '✖️ لغو', callback_data: 'wz:cancel' }]);
  await tg.sendMessage(chatId, t('fa', 'ch_create_start'), kb(rows));
}

export async function wizardInput(env: Env, tg: Tg, chatId: number, tid: number, lang: Lang, text: string): Promise<boolean> {
  const w = await getWizard(env, tid);
  if (!w) return false;
  const data = parseJson<Record<string, any>>(w.data, {});

  switch (w.step) {
    case 'title': {
      if (text.trim().length < 3 || text.trim().length > 100) {
        await tg.sendMessage(chatId, t(lang, 'err_generic'));
        return true;
      }
      data.title = text.trim().slice(0, 100);
      await setWizard(env, tid, 'desc', data);
      await tg.sendMessage(chatId, t(lang, 'wz_desc'));
      return true;
    }
    case 'desc': {
      data.description = text.trim() === '-' ? '' : text.trim().slice(0, 500);
      await setWizard(env, tid, 'channel', data);
      const chans = await env.DB.prepare(`SELECT chat_id, title FROM channels WHERE owner_tid=? AND status='active' ORDER BY id DESC LIMIT 20`).bind(tid).all<{ chat_id: string; title: string }>();
      const rows = chans.results.map((c) => [{ text: c.title || c.chat_id, callback_data: `wz:ch:${c.chat_id}` }]);
      rows.push([{ text: t(lang, 'btn_cancel'), callback_data: 'wz:cancel' }]);
      await tg.sendMessage(chatId, t(lang, 'wz_channel'), kb(rows));
      return true;
    }
    case 'end': {
      const ep = parseTehranDateTime(text);
      if (!ep || ep <= Math.floor(Date.now() / 1000) + 60) {
        await tg.sendMessage(chatId, t(lang, 'wz_end_bad'));
        return true;
      }
      data.end_at = ep;
      await setWizard(env, tid, 'winners', data);
      await tg.sendMessage(chatId, t(lang, 'wz_winners'));
      return true;
    }
    case 'winners': {
      const n = parseInt(text.trim(), 10);
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        await tg.sendMessage(chatId, t(lang, 'wz_winners_bad'));
        return true;
      }
      data.winners_count = n;
      await setWizard(env, tid, 'prizes', data);
      await tg.sendMessage(chatId, t(lang, 'wz_prizes'));
      return true;
    }
    case 'prizes': {
      data.prizes = text.trim() === '-' ? '' : text.trim().slice(0, 800);
      await setWizard(env, tid, 'confirm', data);
      await confirmPreview(env, tg, chatId, tid, lang, data);
      return true;
    }
    case 'quiz_questions': {
      // format: question | opt1 | opt2 | opt3 | #2
      const parts = text.split('|').map((p) => p.trim());
      if (parts.length < 3) {
        await tg.sendMessage(chatId, lang === 'fa' ? '❌ فرمت نامعتبر. مثال: پایتخت ایران | تهران | شیراز | #1' : '❌ Invalid format. Example: Capital of Iran | Tehran | Shiraz | #1');
        return true;
      }
      const last = parts[parts.length - 1];
      const correct = parseInt(last.replace('#', ''), 10);
      if (!Number.isInteger(correct) || correct < 1 || correct > parts.length - 2) {
        await tg.sendMessage(chatId, lang === 'fa' ? '❌ شماره پاسخ درست با # نامعتبر است.' : '❌ Invalid correct answer index (#).');
        return true;
      }
      const opts = parts.slice(1, parts.length - 1);
      if (opts.length > 8) { await tg.sendMessage(chatId, lang === 'fa' ? 'حداکثر ۸ گزینه' : 'Max 8 options'); return true; }
      (data.questions = data.questions || []).push({ text: parts[0].slice(0, 300), options: opts, correct_idx: correct - 1 });
      await setWizard(env, tid, 'quiz_questions', data);
      const rows: any = [
        [{ text: lang === 'fa' ? `✅ پایان ورود سؤال‌ها (${data.questions.length})` : `✅ Finish questions (${data.questions.length})`, callback_data: 'wz:quizdone' }],
        [{ text: t(lang, 'btn_cancel'), callback_data: 'wz:cancel' }],
      ];
      await tg.sendMessage(chatId, lang === 'fa'
        ? `سؤال ${data.questions.length} ثبت شد ✅\n\nسؤال بعدی را بفرستید یا ورود را پایان دهید:`
        : `Question ${data.questions.length} saved ✅\n\nSend next question or finish:`, kb(rows));
      return true;
    }
  }
  return false;
}

export async function confirmPreview(env: Env, tg: Tg, chatId: number, tid: number, lang: Lang, data: Record<string, any>) {
  const type = data.type as ChallengeType;
  const cost = CREDIT_COSTS[type] ?? 1;
  const wallet = await getWallet(env, tid);
  const preview = previewText(lang, {
    title: data.title, description: data.description, type, end_at: data.end_at,
    winners_count: data.winners_count, prizes: data.prizes, rules_version: '1',
  });
  if (type === 'quiz') {
    await tg.sendMessage(chatId, preview + `\n\n🧠 سؤال‌ها: ${data.questions?.length ?? 0}`);
  }
  const rows = [[
    { text: t(lang, 'btn_confirm'), callback_data: 'wz:publish' },
    { text: t(lang, 'btn_cancel'), callback_data: 'wz:cancel' },
  ]];
  await tg.sendMessage(chatId, t(lang, 'wz_confirm', { preview, cost, balance: total(wallet) }), kb(rows));
}

export async function wizardCallback(env: Env, tg: Tg, chatId: number, tid: number, msgId: number, cbId: string, action: string, arg: string): Promise<void> {
  const lang: Lang = 'fa';
  const w = await getWizard(env, tid);
  const data = parseJson<Record<string, any>>(w?.data ?? '{}', {});

  switch (action) {
    case 'cancel':
      await setWizard(env, tid, null, {});
      await tg.answerCallback(cbId, '');
      await tg.sendMessage(chatId, t(lang, 'wz_cancelled'), mainMenuKeyboard(lang, 'user'));
      return;

    case 'type':
      data.type = arg;
      await setWizard(env, tid, 'title', data);
      await tg.answerCallback(cbId, '');
      await tg.editMessage(chatId, msgId, t(lang, 'wz_title'));
      return;

    case 'ch':
      data.channel_chat_id = arg;
      data.channel_title = (await env.DB.prepare(`SELECT title FROM channels WHERE chat_id=?`).bind(arg).first<{ title: string }>())?.title || arg;
      if (data.type === 'quiz') {
        await setWizard(env, tid, 'quiz_questions', data);
        await tg.answerCallback(cbId, '');
        await tg.editMessage(chatId, msgId, lang === 'fa'
          ? 'سؤال اول را بفرستید.\nفرمت: سؤال | گزینه۱ | گزینه۲ | گزینه۳ | #شماره‌درست'
          : 'Send first question.\nFormat: question | opt1 | opt2 | opt3 | #correctIdx');
      } else {
        await setWizard(env, tid, 'end', data);
        await tg.answerCallback(cbId, '');
        const rows: any = [
          [{ text: '+1h', callback_data: 'wz:endrel:3600' }, { text: '+6h', callback_data: 'wz:endrel:21600' }],
          [{ text: '+1d', callback_data: 'wz:endrel:86400' }, { text: '+3d', callback_data: 'wz:endrel:259200' }],
        ];
        await tg.editMessage(chatId, msgId, t(lang, 'wz_end'), kb(rows));
      }
      return;

    case 'endrel':
      data.end_at = Math.floor(Date.now() / 1000) + parseInt(arg, 10);
      await setWizard(env, tid, 'winners', data);
      await tg.answerCallback(cbId, '');
      await tg.editMessage(chatId, msgId, t(lang, 'wz_winners'));
      return;

    case 'quizdone':
      if (!data.questions?.length) { await tg.answerCallback(cbId, lang === 'fa' ? 'حداقل یک سؤال لازم است' : 'Need at least 1 question', true); return; }
      await setWizard(env, tid, 'end', data);
      await tg.answerCallback(cbId, '');
      await tg.sendMessage(chatId, t(lang, 'wz_end'), kb([
        [{ text: '+1h', callback_data: 'wz:endrel:3600' }, { text: '+6h', callback_data: 'wz:endrel:21600' }],
        [{ text: '+1d', callback_data: 'wz:endrel:86400' }, { text: '+3d', callback_data: 'wz:endrel:259200' }],
      ]));
      return;

    case 'publish': {
      await tg.answerCallback(cbId, '');
      await publishChallenge(env, tg, chatId, tid, lang, data);
      return;
    }
  }
}

/* --------------------------------- Publish -------------------------------- */

function channelPostText(lang: Lang, ch: ChallengeRow & { description: string }): string {
  const preview = previewText(lang, ch);
  const btns = ch.type === 'vote'
    ? `\n\n🗳 رأی‌دهی و شرکت با دکمه‌های زیر:`
    : ch.type === 'quiz'
      ? `\n\n🧠 برای شروع آزمون دکمه زیر را بزنید:`
      : ch.type === 'referral'
        ? `\n\n👥 با دکمه زیر وارد شوید و لینک دعوت بگیرید:`
        : `\n\n✍️ برای شرکت در قرعه‌کشی دکمه زیر را بزنید:`;
  return `${preview}${btns}`;
}

function channelPostButtons(ch: { id: number; type: string }, botUsername: string) {
  const rows: any[] = [[{ text: '🚀 ورود به چالش / Enter', url: `https://t.me/${botUsername}?start=ch${ch.id}` }]];
  return kb(rows);
}

export async function publishChallenge(env: Env, tg: Tg, chatId: number, tid: number, lang: Lang, data: Record<string, any>) {
  const type = data.type as ChallengeType;
  const cost = CREDIT_COSTS[type] ?? 1;

  // Pre-check bot can post to channel
  const chatIdStr = String(data.channel_chat_id);
  const me = await tg.getMe();
  const botMember = me ? await tg.getChatMember(chatIdStr, me.id) : null;
  const canPost = botMember && (botMember.status === 'administrator' || botMember.status === 'creator') && botMember.can_post_messages !== false;
  if (!canPost) {
    await tg.sendMessage(chatId, t(lang, 'publish_channel_fail'));
    return;
  }

  // Atomic spend
  const ok = await spend(env, tid, cost, `challenge publish (${type})`, 'challenge:create');
  if (!ok) {
    const wallet = await getWallet(env, tid);
    await tg.sendMessage(chatId, t(lang, 'publish_no_funds', { cost, balance: total(wallet) }));
    return;
  }

  const ts = now();
  const salt = randHex(16);
  const commit = await sha256Hex(`${salt}:${tid}:${cost}:${data.end_at}`);
  const ins = await env.DB.prepare(
    `INSERT INTO challenges (channel_chat_id, created_by, type, title, description, status, end_at, tz, winners_count, prizes, rules, rules_version, config, commit_hash, commit_salt, cost, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(chatIdStr, tid, type, data.title, data.description || '', 'active', data.end_at, 'Asia/Tehran',
      data.winners_count, data.prizes || '', '', '1', JSON.stringify({ ...DEFAULT_CONFIG }), commit, salt, cost, ts)
    .run();
  const chId = ins.meta?.last_row_id;
  if (!chId) {
    await refund(env, tid, cost, 'free', `challenge:create:fail:${ts}`);
    await tg.sendMessage(chatId, t(lang, 'err_generic'));
    return;
  }

  if (type === 'quiz' && Array.isArray(data.questions)) {
    for (let i = 0; i < data.questions.length; i++) {
      const q = data.questions[i];
      await env.DB.prepare(`INSERT INTO quiz_questions (challenge_id, idx, text, options, correct_idx, time_sec) VALUES (?,?,?,?,?,?)`)
        .bind(chId, i, q.text, JSON.stringify(q.options), q.correct_idx, 120)
        .run();
    }
  }

  const row = await env.DB.prepare(`SELECT * FROM challenges WHERE id=?`).bind(chId).first<ChallengeRow>();
  if (!row) { await tg.sendMessage(chatId, t(lang, 'err_generic')); return; }

  const post = await tg.sendMessage(chatIdStr, channelPostText(lang, row as any), channelPostButtons({ id: chId, type }, me?.username ?? 'like_cybrixbot'));
  if (!post) {
    // refund & cancel — channel delivery failed despite pre-check
    await env.DB.prepare(`UPDATE challenges SET status='cancelled' WHERE id=?`).bind(chId).run();
    await refund(env, tid, cost, 'free', `challenge:create:fail:${ts}`);
    await audit(env.DB, tid, 'challenge.publish_fail', 'challenge', chId, chatIdStr);
    await tg.sendMessage(chatId, t(lang, 'publish_channel_fail'));
    return;
  }
  await env.DB.prepare(`UPDATE challenges SET message_id=? WHERE id=?`).bind(post.message_id, chId).run();
  await setWizard(env, tid, null, {});
  await audit(env.DB, tid, 'challenge.publish', 'challenge', chId, `${type}:${cost}`);
  await tg.sendMessage(chatId, t(lang, 'publish_ok', { preview: previewText(lang, row) }), mainMenuKeyboard(lang, 'user'));
}

/* ------------------------------- Participation ----------------------------- */

export async function handleStartChallenge(env: Env, tg: Tg, chatId: number, tid: number, chId: number): Promise<void> {
  const u = await env.DB.prepare(`SELECT lang, role FROM users WHERE telegram_id=?`).bind(tid).first<{ lang: Lang; role: string }>();
  const lang: Lang = u?.lang ?? 'fa';
  const ch = await env.DB.prepare(`SELECT * FROM challenges WHERE id=?`).bind(chId).first<ChallengeRow>();
  if (!ch || ch.status !== 'active') {
    await tg.sendMessage(chatId, t(lang, 'ch_ended'));
    return;
  }
  const cfg = parseJson<ChallengeConfig>(ch.config, DEFAULT_CONFIG);

  // ensure participant row
  const ins = await env.DB.prepare(`INSERT INTO participants (challenge_id, telegram_id, joined_at) VALUES (?,?,?) ON CONFLICT DO NOTHING`)
    .bind(chId, tid, now()).run();
  const fresh = (ins.meta?.changes ?? 0) === 1;
  if (!fresh) {
    if (ch.type === 'referral') { await sendRefLink(env, tg, chatId, tid, lang, ch); return; }
    if (ch.type === 'vote') { await openVoteList(env, tg, chatId, ch, lang, 0); return; }
    if (ch.type === 'quiz') { await askQuizQuestion(env, tg, chatId, tid, ch, 0); return; }
    await tg.sendMessage(chatId, t(lang, 'ch_already'));
    return;
  }

  // membership gate (mandatory + extra channels)
  const ok = await passesJoinGate(env, tg, tid, cfg.extra_channels);
  if (!ok) {
    await env.DB.prepare(`UPDATE participants SET status='pending' WHERE challenge_id=? AND telegram_id=?`).bind(chId, tid).run();
    await tg.sendMessage(chatId, t(lang, 'ch_need_join'), {
      reply_markup: { inline_keyboard: [[{ text: t(lang, 'check_again'), callback_data: `ch:rejoin:${chId}` }]] },
    });
    return;
  }
  await env.DB.prepare(`UPDATE participants SET status='active' WHERE challenge_id=? AND telegram_id=?`).bind(chId, tid).run();
  await audit(env.DB, tid, 'challenge.join', 'challenge', chId, ch.type);

  if (ch.type === 'referral') { await sendRefLink(env, tg, chatId, tid, lang, ch); return; }
  if (ch.type === 'vote') { await tg.sendMessage(chatId, t(lang, 'ch_joined', { title: esc(ch.title) })); await openVoteList(env, tg, chatId, ch, lang, 0); return; }
  if (ch.type === 'quiz') { await tg.sendMessage(chatId, t(lang, 'ch_joined', { title: esc(ch.title) })); await askQuizQuestion(env, tg, chatId, tid, ch, 0); return; }
  await tg.sendMessage(chatId, t(lang, 'ch_joined', { title: esc(ch.title) }));
}

export async function rejoinCheck(env: Env, tg: Tg, chatId: number, tid: number, cbId: string, chId: number) {
  const ch = await env.DB.prepare(`SELECT * FROM challenges WHERE id=?`).bind(chId).first<ChallengeRow>();
  if (!ch || ch.status !== 'active') { await tg.answerCallback(cbId, t('fa', 'ch_ended'), true); return; }
  const cfg = parseJson<ChallengeConfig>(ch.config, DEFAULT_CONFIG);
  const ok = await passesJoinGate(env, tg, tid, cfg.extra_channels);
  if (!ok) { await tg.answerCallback(cbId, t('fa', 'ch_need_join'), true); return; }
  await env.DB.prepare(`UPDATE participants SET status='active' WHERE challenge_id=? AND telegram_id=?`).bind(chId, tid).run();
  await tg.answerCallback(cbId, t('fa', 'ch_joined', { title: ch.title }));
}

async function sendRefLink(env: Env, tg: Tg, chatId: number, tid: number, lang: Lang, ch: ChallengeRow) {
  const me = await tg.getMe();
  const link = `https://t.me/${me?.username ?? 'like_cybrixbot'}?start=ref${ch.id}_${tid}`;
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM referrals WHERE challenge_id=? AND inviter_tid=? AND valid=1`).bind(ch.id, tid).first<{ n: number }>();
  await tg.sendMessage(chatId, t(lang, 'ref_link', { title: esc(ch.title), link, count: count?.n ?? 0 }));
}

/* ---------------------------------- Votes --------------------------------- */

export async function openVoteList(env: Env, tg: Tg, chatId: number, ch: ChallengeRow, lang: Lang, page: number) {
  const parts = await env.DB
    .prepare(
      `SELECT p.id, p.telegram_id, u.first_name, u.username,
              (SELECT COUNT(*) FROM votes v WHERE v.challenge_id=p.challenge_id AND v.target_id=p.id AND v.status='active') AS votes
       FROM participants p JOIN users u ON u.telegram_id=p.telegram_id
       WHERE p.challenge_id=? AND p.status='active' AND p.telegram_id != ?
       ORDER BY votes DESC, p.id LIMIT 6 OFFSET ?`
    )
    .bind(ch.id, 0, page * 6)
    .all<{ id: number; telegram_id: number; first_name: string; username: string; votes: number }>();
  const totalR = await env.DB.prepare(`SELECT COUNT(*) AS n FROM participants WHERE challenge_id=? AND status='active'`).bind(ch.id).first<{ n: number }>();
  if (!totalR?.n) { await tg.sendMessage(chatId, t(lang, 'vote_none')); return; }

  const rows = parts.results.map((p) => [
    { text: `${userMention(p)} ${ch.type === 'vote' ? `· ${p.votes} رأی` : ''}`, callback_data: `ch:votefor:${ch.id}:${p.id}` },
  ]);
  const nav: any[] = [];
  if (page > 0) nav.push({ text: '◀️', callback_data: `ch:vote:${ch.id}:${page - 1}` });
  if ((page + 1) * 6 < (totalR?.n ?? 0)) nav.push({ text: '▶️', callback_data: `ch:vote:${ch.id}:${page + 1}` });
  if (nav.length) rows.push(nav);
  await tg.sendMessage(chatId, t(lang, 'vote_intro', { title: esc(ch.title) }), kb(rows));
}

export async function castVote(env: Env, tg: Tg, chatId: number, tid: number, cbId: string, chId: number, targetId: number) {
  const ch = await env.DB.prepare(`SELECT * FROM challenges WHERE id=?`).bind(chId).first<ChallengeRow>();
  if (!ch || ch.status !== 'active') { await tg.answerCallback(cbId, t('fa', 'ch_ended'), true); return; }
  const cfg = parseJson<ChallengeConfig>(ch.config, DEFAULT_CONFIG);
  const existing = await env.DB.prepare(`SELECT id, target_id FROM votes WHERE challenge_id=? AND voter_tid=?`).bind(chId, tid).first<{ id: number; target_id: number }>();

  if (existing && existing.target_id === targetId) { await tg.answerCallback(cbId, t('fa', 'ch_already'), true); return; }
  if (existing && !cfg.change_vote) { await tg.answerCallback(cbId, t('fa', 'ch_already'), true); return; }

  const ts = now();
  if (existing) {
    await env.DB.prepare(`UPDATE votes SET target_id=?, status='active', changed_at=? WHERE id=?`).bind(targetId, ts, existing.id).run();
    await audit(env.DB, tid, 'vote.change', 'challenge', chId, `${existing.target_id}->${targetId}`);
  } else {
    await env.DB.prepare(`INSERT INTO votes (challenge_id, voter_tid, target_id, created_at) VALUES (?,?,?,?)`).bind(chId, tid, targetId, ts).run();
  }
  await env.DB.prepare(`INSERT OR IGNORE INTO participants (challenge_id, telegram_id, joined_at) VALUES (?,?,?)`).bind(chId, tid, ts).run();
  const targetName = await env.DB
    .prepare(`SELECT u.first_name, u.username FROM participants p JOIN users u ON u.telegram_id=p.telegram_id WHERE p.id=?`)
    .bind(targetId).first<{ first_name: string; username: string }>();
  await tg.answerCallback(cbId, existing ? t('fa', 'vote_changed', { target: userMention(targetName ?? { id: 0 } as any) }) : t('fa', 'vote_done', { target: userMention(targetName ?? { id: 0 } as any) }));
  await audit(env.DB, tid, 'vote.cast', 'challenge', chId, `${targetId}`);
}

/* --------------------------------- Quiz ----------------------------------- */

async function askQuizQuestion(env: Env, tg: Tg, chatId: number, tid: number, ch: ChallengeRow, qIdx: number) {
  const qs = await env.DB
    .prepare(`SELECT id, idx, text, options, correct_idx FROM quiz_questions WHERE challenge_id=? ORDER BY idx`)
    .bind(ch.id).all<{ id: number; idx: number; text: string; options: string; correct_idx: number }>();
  const totalQ = qs.results.length;
  if (!totalQ) { await tg.sendMessage(chatId, t('fa', 'err_generic')); return; }
  if (qIdx >= totalQ) {
    const sc = await env.DB.prepare(`SELECT score FROM participants WHERE challenge_id=? AND telegram_id=?`).bind(ch.id, tid).first<{ score: number }>();
    await tg.sendMessage(chatId, t('fa', 'quiz_done', { score: sc?.score ?? 0 }));
    return;
  }
  const q = qs.results[qIdx];
  const opts = parseJson<string[]>(q.options, []);
  const answered = await env.DB.prepare(`SELECT id FROM quiz_answers WHERE question_id=? AND telegram_id=?`).bind(q.id, tid).first();
  if (answered) { await askQuizQuestion(env, tg, chatId, tid, ch, qIdx + 1); return; }
  const rows = opts.map((o, i) => [{ text: o, callback_data: `qz:${q.id}:${i}` }]);
  await tg.sendMessage(chatId, `${t('fa', 'quiz_next', { idx: qIdx + 1, total: totalQ })}\n\n${esc(q.text)}`, kb(rows));
}

export async function answerQuiz(env: Env, tg: Tg, chatId: number, tid: number, cbId: string, questionId: number, optionIdx: number) {
  const q = await env.DB.prepare(`SELECT id, challenge_id, idx, correct_idx FROM quiz_questions WHERE id=?`).bind(questionId).first<{ id: number; challenge_id: number; idx: number; correct_idx: number }>();
  if (!q) { await tg.answerCallback(cbId, t('fa', 'err_generic'), true); return; }
  const ch = await env.DB.prepare(`SELECT * FROM challenges WHERE id=?`).bind(q.challenge_id).first<ChallengeRow>();
  if (!ch || ch.status !== 'active') { await tg.answerCallback(cbId, t('fa', 'ch_ended'), true); return; }

  const ins = await env.DB.prepare(`INSERT INTO quiz_answers (question_id, telegram_id, option_idx, correct, answered_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING`)
    .bind(questionId, tid, optionIdx, optionIdx === q.correct_idx ? 1 : 0, now()).run();
  if ((ins.meta?.changes ?? 0) === 0) { await tg.answerCallback(cbId, t('fa', 'ch_already'), true); return; }

  const correct = optionIdx === q.correct_idx;
  if (correct) {
    await env.DB.prepare(`UPDATE participants SET score = score + 1 WHERE challenge_id=? AND telegram_id=?`).bind(ch.id, tid).run();
  }
  const qs = await env.DB.prepare(`SELECT COUNT(*) AS n FROM quiz_questions WHERE challenge_id=?`).bind(ch.id).first<{ n: number }>();
  const correctOpt = parseJson<string[]>( (await env.DB.prepare(`SELECT options FROM quiz_questions WHERE id=?`).bind(questionId).first<{options:string}>())?.options ?? '[]', [])[q.correct_idx] ?? '';
  await tg.answerCallback(cbId, correct ? t('fa', 'quiz_answered_ok') : t('fa', 'quiz_answered_bad', { correct: correctOpt }));
  await askQuizQuestion(env, tg, chatId, tid, ch, q.idx + 1);
}

/* ------------------------------ Referral credit ---------------------------- */

/** Called on /start with payload ref{chid}_{inviter} — record & validate referral. */
export async function handleReferral(env: Env, tg: Tg, chatId: number, invitee: number, chId: number, inviter: number): Promise<void> {
  if (invitee === inviter) return;
  const ch = await env.DB.prepare(`SELECT * FROM challenges WHERE id=?`).bind(chId).first<ChallengeRow>();
  if (!ch || ch.status !== 'active') return;
  const dup = await env.DB.prepare(`SELECT id FROM referrals WHERE invitee_tid=?`).bind(invitee).first();
  if (dup) return; // one Telegram ID can be referred only once (platform-wide)
  const valid = await passesJoinGate(env, tg, invitee);
  await env.DB
    .prepare(`INSERT INTO referrals (challenge_id, inviter_tid, invitee_tid, valid, reason, created_at) VALUES (?,?,?,?,?,?)`)
    .bind(chId, inviter, invitee, valid ? 1 : 0, valid ? '' : 'mandatory join pending', now())
    .run();
  await env.DB.prepare(`INSERT OR IGNORE INTO participants (challenge_id, telegram_id, joined_at) VALUES (?,?,?)`).bind(chId, invitee, now()).run();
  // notify inviter
  const inviterChat = await env.DB.prepare(`SELECT telegram_id FROM users WHERE telegram_id=?`).bind(inviter).first<{ telegram_id: number }>();
  if (inviterChat) {
    const lang = 'fa' as Lang;
    const link = `https://t.me/${(await tg.getMe())?.username}?start=ref${ch.id}_${inviter}`;
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM referrals WHERE challenge_id=? AND inviter_tid=? AND valid=1`).bind(ch.id, inviter).first<{ n: number }>();
    await tg.sendMessage(inviterChat.telegram_id, t(lang, 'ref_link', { title: esc(ch.title), link, count: count?.n ?? 0 }));
  }
}

/* ---------------------------- Finish & winners ----------------------------- */

export async function finishChallenge(env: Env, tg: Tg, ch: ChallengeRow): Promise<void> {
  if (ch.status !== 'active') return;
  const ts = now();
  const participants = await env.DB
    .prepare(`SELECT telegram_id, score FROM participants WHERE challenge_id=? AND status IN ('active','pending')`)
    .bind(ch.id).all<{ telegram_id: number; score: number }>();

  // Final membership re-check for pending/active (documented: Telegram does not push member-leave events reliably)
  const cfg = parseJson<ChallengeConfig>(ch.config, DEFAULT_CONFIG);
  for (const p of participants.results) {
    if (ch.type !== 'quiz') {
      const ok = await passesJoinGate(env, tg, p.telegram_id, cfg.extra_channels);
      if (!ok) {
        await env.DB.prepare(`UPDATE participants SET status='disqualified', score=0 WHERE challenge_id=? AND telegram_id=?`).bind(ch.id, p.telegram_id).run();
        await audit(env.DB, null, 'participant.disqualified', 'challenge', ch.id, String(p.telegram_id));
      }
    }
  }

  let pool = await env.DB.prepare(`SELECT telegram_id, score FROM participants WHERE challenge_id=? AND status='active'`).bind(ch.id).all<{ telegram_id: number; score: number }>();
  let tids = pool.results.map((p) => p.telegram_id);

  // snapshot hash of the final eligible list
  const sorted = [...tids].sort((a, b) => a - b);
  const snapshotHash = await sha256Hex(`${ch.id}:${ch.commit_salt ?? ''}:${sorted.join(',')}`);

  let ranked: Array<{ tid: number; key: string }> = [];
  if (ch.type === 'random') {
    const salt = ch.commit_salt ?? randHex(16);
    for (const tid of sorted) {
      ranked.push({ tid, key: await sha256Hex(`${salt}:${tid}`) });
    }
    ranked.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  } else {
    // score-based: vote counts / referral counts / quiz scores; ties broken by hash for verifiability
    let scores: Array<{ tid: number; sc: number }> = [];
    if (ch.type === 'vote') {
      const rows = await env.DB.prepare(
        `SELECT v.target_id AS pid, COUNT(*) AS sc FROM votes v WHERE v.challenge_id=? AND v.status='active' GROUP BY v.target_id`
      ).bind(ch.id).all<{ pid: number; sc: number }>();
      const pidToTid = new Map<number, number>();
      const parts = await env.DB.prepare(`SELECT id, telegram_id FROM participants WHERE challenge_id=?`).bind(ch.id).all<{ id: number; telegram_id: number }>();
      for (const p of parts.results) pidToTid.set(p.id, p.telegram_id);
      scores = rows.results.map((r) => ({ tid: pidToTid.get(r.pid) ?? 0, sc: r.sc }));
    } else if (ch.type === 'referral') {
      const rows = await env.DB.prepare(`SELECT inviter_tid AS tid, COUNT(*) AS sc FROM referrals WHERE challenge_id=? AND valid=1 GROUP BY inviter_tid`).bind(ch.id).all<{ tid: number; sc: number }>();
      scores = rows.results;
    } else {
      scores = pool.results.map((p) => ({ tid: p.telegram_id, sc: p.score }));
    }
    const maxScore = Math.max(0, ...scores.map((s) => s.sc));
    const salt = ch.commit_salt ?? randHex(16);
    for (const s of scores) {
      if (s.sc === maxScore && s.tid) ranked.push({ tid: s.tid, key: await sha256Hex(`${salt}:${s.tid}`) });
    }
    ranked.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  const winners = ranked.slice(0, ch.winners_count);
  const prizes = (ch.prizes || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const method = ch.type === 'random' ? 'commit-reveal hash sort' : `score + hash tiebreak`;

  await env.DB.batch([
    env.DB.prepare(`UPDATE challenges SET status='finished', snapshot_hash=? WHERE id=?`).bind(snapshotHash, ch.id),
    env.DB.prepare(`INSERT OR IGNORE INTO prizes (challenge_id, rank, title, value, status) VALUES (?,?,?,?,?)`).bind(ch.id, 0, '-', '', 'defined'),
  ].concat(winners.map((w, i) =>
    env.DB.prepare(`INSERT INTO winners (challenge_id, telegram_id, rank, selected_at, method, proof) VALUES (?,?,?,?,?,?)`)
      .bind(ch.id, w.tid, i + 1, ts, method, w.key)
  )));

  // reward credits if configured
  if (cfg.reward_credits > 0) {
    for (const w of winners) {
      await grant(env, w.tid, cfg.reward_credits, 'gift', `challenge:${ch.id}:rank-prize`);
    }
  }

  // announce
  const rankEmoji = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`);
  const nameFor = async (tid: number) => {
    const r = await env.DB.prepare(`SELECT first_name, username FROM users WHERE telegram_id=?`).bind(tid).first<{ first_name: string; username: string }>();
    return userMention(r ?? { id: tid } as any);
  };
  const lines: string[] = [];
  for (let i = 0; i < winners.length; i++) {
    lines.push(`${rankEmoji(i)} ${await nameFor(winners[i].tid)}${prizes[i] ? ` — ${esc(prizes[i])}` : ''}`);
  }
  if (!lines.length) lines.push(lang_line(ch, 'no_participants'));
  const announce = t('fa', 'result_announce', {
    title: esc(ch.title), winners_list: lines.join('\n'),
    commit: ch.commit_hash ?? '-', salt: ch.commit_salt ?? '-', snapshot: snapshotHash,
  });
  if (ch.message_id) await tg.sendMessage(ch.channel_chat_id, announce);
  // DM winners (best-effort)
  for (let i = 0; i < winners.length; i++) {
    await tg.sendMessage(winners[i].tid, t('fa', 'winner_dm', { title: esc(ch.title), rank: i + 1, prize: esc(prizes[i] ?? '-') }));
  }
  await audit(env.DB, null, 'challenge.finish', 'challenge', ch.id, `${method}:${winners.length}`);
}

function lang_line(ch: ChallengeRow, key: string): string {
  // minimal inline literal for rare case
  return key === 'no_participants' ? '— شرکت‌کننده واجد شرایطی نبود —' : key;
}

/* --------------------------------- Cron ----------------------------------- */

export async function sweepExpired(env: Env, tg: Tg): Promise<number> {
  const ts = now();
  const due = await env.DB
    .prepare(`SELECT * FROM challenges WHERE status='active' AND end_at <= ? ORDER BY end_at LIMIT 10`)
    .bind(ts).all<ChallengeRow>();
  let done = 0;
  for (const ch of due.results) {
    try {
      await finishChallenge(env, tg, ch);
      done++;
    } catch (e) {
      console.error('finish failed', ch.id, e);
      await audit(env.DB, null, 'challenge.finish_error', 'challenge', ch.id, String(e));
    }
  }
  // reminders for challenges ending within 1h, not yet reminded
  const soon = await env.DB
    .prepare(`SELECT id, title, channel_chat_id, message_id FROM challenges WHERE status='active' AND end_at > ? AND end_at <= ? AND reminded=0 LIMIT 10`)
    .bind(ts, ts + 3600).all<{ id: number; title: string; channel_chat_id: string; message_id: number | null }>();
  for (const s of soon.results) {
    await tg.sendMessage(s.channel_chat_id, t('fa', 'reminder', { title: esc(s.title) }));
    await env.DB.prepare(`UPDATE challenges SET reminded=1 WHERE id=?`).bind(s.id).run();
  }
  return done;
}

/**
 * Builder bot flows — join gate, /install wizard FSM, /status, /reinstall, /health.
 *
 * Security model:
 *  - Customer tokens live in wizard_state ONLY while a flow is running; the row is
 *    deleted on completion/cancel (see deploy.stepFinalize) and the /health check never
 *    stores the token at all.
 *  - Full tokens are never logged nor echoed into messages (masked as abc123***).
 *  - Tokens only ever appear in Telegram API calls (Telegram's own contract) and in the
 *    Cloudflare Authorization header / worker secret bindings.
 */
import type { Env, TgUpdate, TgCallbackQuery, InstallData, InstallationRow } from './types';
import { audit, getWizard, setWizard, type BuilderStep } from './db';
import { Tg, kb, CANCEL_KB } from './tg';
import { t, type Lang } from './strings';
import {
  ensureBuilderUser, passesJoinGate, joinGateKeyboard, mainMenuKeyboard, rateLimited, builderMe,
} from './users';
import { Cf } from './cf';
import type { CfAccount } from './types';
import { runPipeline, checkHealth, standaloneVersion } from './deploy';
import { esc, maskToken, shortErr, proposeBase, customBase, workerUrlFor } from './util';

/* -------------------------------------------------------------------------- */
/*  Update entrypoint                                                         */
/* -------------------------------------------------------------------------- */

export async function handleUpdate(env: Env, u: TgUpdate): Promise<void> {
  const tg = new Tg(env.BOT_TOKEN);
  if (u.callback_query) return handleCallback(env, tg, u.callback_query);

  const msg = u.message;
  if (!msg?.from || msg.from.is_bot) return;
  if (msg.chat.type !== 'private') return;

  const tid = msg.from.id;
  const chatId = msg.chat.id;
  if (rateLimited(tid)) {
    await tg.sendMessage(chatId, t('fa', 'b_rate_limited'));
    return;
  }

  const user = await ensureBuilderUser(env, msg.from);
  if (!user) return;
  const lang: Lang = user.lang ?? 'fa';
  const text = (msg.text || '').trim();

  // /cancel always works and wipes transient tokens
  if (text === '/cancel') {
    await setWizard(env.DB, tid, null, {});
    await tg.sendMessage(chatId, t(lang, 'b_cancelled'), mainMenuKeyboard(lang));
    return;
  }

  if (text.startsWith('/')) {
    await handleCommand(env, tg, chatId, tid, lang, text);
    return;
  }

  const wiz = await getWizard(env.DB, tid);
  if (wiz && (await wizardText(env, tg, chatId, tid, lang, wiz.step, wiz.data, text))) return;

  await tg.sendMessage(chatId, t(lang, 'b_menu'), mainMenuKeyboard(lang));
}

/* -------------------------------------------------------------------------- */
/*  Commands                                                                  */
/* -------------------------------------------------------------------------- */

async function handleCommand(env: Env, tg: Tg, chatId: number, tid: number, lang: Lang, text: string): Promise<void> {
  const cmd = text.split(' ')[0].split('@')[0];

  if (cmd === '/start') {
    if (!(await passesJoinGate(env, tg, tid))) {
      await tg.sendMessage(chatId, t(lang, 'b_welcome') + '\n\n' + t(lang, 'b_join_required'), joinGateKeyboard(env, lang));
      return;
    }
    await tg.sendMessage(chatId, t(lang, 'b_welcome') + '\n\n' + t(lang, 'b_menu'), mainMenuKeyboard(lang));
    return;
  }

  if (cmd === '/help') {
    await tg.sendMessage(chatId, t(lang, 'b_help'), mainMenuKeyboard(lang));
    return;
  }

  if (cmd === '/install') {
    if (!(await passesJoinGate(env, tg, tid))) {
      await tg.sendMessage(chatId, t(lang, 'b_join_required'), joinGateKeyboard(env, lang));
      return;
    }
    await startInstall(env, tg, chatId, tid, lang);
    return;
  }

  if (cmd === '/status') {
    if (!(await passesJoinGate(env, tg, tid))) {
      await tg.sendMessage(chatId, t(lang, 'b_join_required'), joinGateKeyboard(env, lang));
      return;
    }
    await sendStatusList(env, tg, chatId, lang, tid);
    return;
  }

  if (cmd === '/reinstall') {
    if (!(await passesJoinGate(env, tg, tid))) {
      await tg.sendMessage(chatId, t(lang, 'b_join_required'), joinGateKeyboard(env, lang));
      return;
    }
    const id = parseInt(text.split(' ')[1] || '', 10);
    if (!Number.isInteger(id)) {
      await tg.sendMessage(chatId, t(lang, 'b_reinstall_usage'));
      return;
    }
    const row = await getInstallation(env, tid, id);
    if (!row) {
      await tg.sendMessage(chatId, t(lang, 'b_reinstall_notfound', { id }));
      return;
    }
    await setWizard(env.DB, tid, 'b:re:bot', { inst_id: id, bot_username: row.bot_username });
    await tg.sendMessage(chatId, t(lang, 'b_reinstall_ask_bot', { id, bot: esc(row.bot_username) }), CANCEL_KB);
    return;
  }

  if (cmd === '/health') {
    if (!(await passesJoinGate(env, tg, tid))) {
      await tg.sendMessage(chatId, t(lang, 'b_join_required'), joinGateKeyboard(env, lang));
      return;
    }
    const id = parseInt(text.split(' ')[1] || '', 10);
    if (!Number.isInteger(id)) {
      await tg.sendMessage(chatId, t(lang, 'b_health_usage'));
      return;
    }
    const row = await getInstallation(env, tid, id);
    if (!row) {
      await tg.sendMessage(chatId, t(lang, 'b_health_notfound', { id }));
      return;
    }
    const workerOk = row.subdomain ? await checkHealth(workerUrlFor(row.worker_name, row.subdomain)) : false;
    const panelOk = row.subdomain && row.panel_name ? await checkHealth(workerUrlFor(row.panel_name, row.subdomain)) : false;
    await setWizard(env.DB, tid, 'b:health_token', { inst_id: id, bot_username: row.bot_username });
    await tg.sendMessage(
      chatId,
      t(lang, 'b_health_ask_token', {
        id,
        worker_ok: workerOk ? t(lang, 'b_health_ok') : t(lang, 'b_health_fail'),
        panel_ok: panelOk ? t(lang, 'b_health_ok') : t(lang, 'b_health_fail'),
      }),
      CANCEL_KB
    );
    return;
  }

  if (cmd === '/version') {
    await tg.sendMessage(chatId, `CYBRIX Builder v${env.VERSION} • standalone bundle: ${standaloneVersion()}`);
    return;
  }

  await tg.sendMessage(chatId, t(lang, 'b_unknown'), mainMenuKeyboard(lang));
}

/* -------------------------------------------------------------------------- */
/*  Wizard — text input                                                       */
/* -------------------------------------------------------------------------- */

async function wizardText(
  env: Env,
  tg: Tg,
  chatId: number,
  tid: number,
  lang: Lang,
  step: BuilderStep,
  data: InstallData,
  text: string
): Promise<boolean> {
  switch (step) {
    case 'b:bot_token':
      await stepBotToken(env, tg, chatId, tid, lang, data, text, 'install');
      return true;

    case 'b:re:bot':
      await stepBotToken(env, tg, chatId, tid, lang, data, text, 'reinstall');
      return true;

    case 'b:cf_token':
      await stepCfToken(env, tg, chatId, tid, lang, data, text, 'install');
      return true;

    case 'b:re:cf':
      await stepCfToken(env, tg, chatId, tid, lang, data, text, 'reinstall');
      return true;

    case 'b:cf_account':
      await tg.sendMessage(chatId, t(lang, 'b_pick_account'));
      return true;

    case 'b:names': {
      const base = customBase(text);
      if (!base) {
        await tg.sendMessage(chatId, t(lang, 'b_names_bad'), CANCEL_KB);
        return true;
      }
      const cf = new Cf(data.cf_token || '');
      await applyNames(env, tg, chatId, tid, lang, data, cf, base);
      return true;
    }

    case 'b:confirm':
      await tg.sendMessage(chatId, t(lang, 'b_send_text'));
      return true;

    case 'b:exec':
    case 'b:re:exec':
      await tg.sendMessage(chatId, t(lang, 'b_exec_running'));
      return true;

    case 'b:health_token': {
      // transient check — the token is used in-memory and NEVER written to the DB
      const row = typeof data.inst_id === 'number' ? await getInstallation(env, tid, data.inst_id) : null;
      if (!row) {
        await setWizard(env.DB, tid, null, {});
        await tg.sendMessage(chatId, t(lang, 'b_err_generic'));
        return true;
      }
      const fmtOk = /^\d+:[\w-]{20,}$/.test(text);
      const cust = new Tg(text);
      const me = fmtOk ? await cust.getMeInfo() : { ok: false as const, error: 'bad format' };
      if (!me.ok || !me.user) {
        await tg.sendMessage(chatId, t(lang, 'b_health_invalid_token', { err: esc(shortErr(undefined, me.error)) }), CANCEL_KB);
        return true;
      }
      if ((me.user.username || '').toLowerCase() !== row.bot_username.toLowerCase()) {
        await tg.sendMessage(chatId, t(lang, 'b_health_bad_token', {
          bot: esc(me.user.username || '?'),
          expect: esc(row.bot_username),
        }), CANCEL_KB);
        return true;
      }
      const hook = await cust.getWebhookInfo();
      const expected = row.subdomain ? `${workerUrlFor(row.worker_name, row.subdomain)}/webhook` : '';
      const url = hook.ok && hook.info ? hook.info.url : '';
      const hookTxt = !url
        ? t(lang, 'b_hook_empty')
        : expected && url === expected
          ? t(lang, 'b_hook_ok')
          : t(lang, 'b_hook_mismatch', { url: esc(url) });
      await setWizard(env.DB, tid, null, {}); // nothing token-shaped was ever stored
      await audit(env.DB, tid, 'builder.health', 'installation', row.worker_name, '');
      await tg.sendMessage(chatId, t(lang, 'b_health_report', {
        id: row.id,
        bot: esc(row.bot_username),
        hook: hookTxt,
        url: esc(url || expected || '—'),
      }), mainMenuKeyboard(lang));
      return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/*  Wizard — step: customer bot token                                         */
/* -------------------------------------------------------------------------- */

async function stepBotToken(
  env: Env,
  tg: Tg,
  chatId: number,
  tid: number,
  lang: Lang,
  data: InstallData,
  text: string,
  mode: 'install' | 'reinstall'
): Promise<void> {
  const token = text.trim();

  const fmtOk = /^\d+:[\w-]{20,}$/.test(token);
  const cust = new Tg(token);
  const me = fmtOk ? await cust.getMeInfo() : { ok: false as const, error: 'bad format' };

  if (!me.ok || !me.user) {
    await tg.sendMessage(chatId, t(lang, 'b_bad_bot_token', { err: esc(shortErr(undefined, me.error)) }), CANCEL_KB);
    return;
  }

  // reject the builder bot's own token / identity
  if (token === env.BOT_TOKEN) {
    await tg.sendMessage(chatId, t(lang, 'b_own_bot_reject'), CANCEL_KB);
    return;
  }
  const meSelf = await builderMe(tg);
  if (meSelf && me.user.id === meSelf.id) {
    await tg.sendMessage(chatId, t(lang, 'b_own_bot_reject'), CANCEL_KB);
    return;
  }

  // reinstall: the token must belong to the recorded bot
  if (mode === 'reinstall' && data.bot_username) {
    if ((me.user.username || '').toLowerCase() !== data.bot_username.toLowerCase()) {
      await tg.sendMessage(chatId, t(lang, 'b_health_bad_token', {
        bot: esc(me.user.username || '?'),
        expect: esc(data.bot_username),
      }), CANCEL_KB);
      return;
    }
  }

  // webhook check — warn if an existing webhook points elsewhere (we will overwrite it)
  let webhookWarn = '';
  const hook = await cust.getWebhookInfo();
  if (hook.ok && hook.info && hook.info.url) webhookWarn = hook.info.url;

  const next: InstallData = {
    ...data,
    bot_id: me.user.id,
    bot_username: me.user.username || data.bot_username || '',
    customer_bot_token: token, // transient — wiped when the flow ends
    webhook_warn: webhookWarn || undefined,
  };
  await setWizard(env.DB, tid, mode === 'install' ? 'b:cf_token' : 'b:re:cf', next);

  const botLine = t(lang, 'b_bot_ok', { bot: esc(next.bot_username || '?') });
  const warnLine = webhookWarn ? '\n\n' + t(lang, 'b_webhook_warn', { url: esc(webhookWarn) }) : '';
  const cfAsk = t(lang, 'b_ask_cf_token');
  await tg.sendMessage(chatId, `${botLine}${warnLine}\n\n${cfAsk}`, CANCEL_KB);
  await audit(env.DB, tid, 'builder.wizard.bot_token', mode, next.bot_username, `token ${maskToken(token)}`);
}

/* -------------------------------------------------------------------------- */
/*  Wizard — step: Cloudflare token (+ account pick + permission probes)      */
/* -------------------------------------------------------------------------- */

async function stepCfToken(
  env: Env,
  tg: Tg,
  chatId: number,
  tid: number,
  lang: Lang,
  data: InstallData,
  text: string,
  mode: 'install' | 'reinstall'
): Promise<void> {
  const token = text.trim();
  const cf = new Cf(token);

  const v = await cf.verifyToken();
  if (!v.ok) {
    await tg.sendMessage(chatId, t(lang, 'b_cf_invalid', { err: esc(shortErr(v.code, v.message)) }), CANCEL_KB);
    return;
  }

  const accs = await cf.listAccounts();
  if (!accs.ok || !accs.result) {
    await tg.sendMessage(chatId, t(lang, 'b_cf_accounts_fail', { err: esc(shortErr(accs.code, accs.message)) }), CANCEL_KB);
    return;
  }
  const accounts = accs.result.map((a) => ({ id: a.id, name: a.name || a.id }));
  if (accounts.length === 0) {
    await tg.sendMessage(chatId, t(lang, 'b_cf_no_accounts'), CANCEL_KB);
    return;
  }

  const next: InstallData = { ...data, cf_token: token, accounts }; // transient token
  if (accounts.length === 1) {
    await afterAccountChosen(env, tg, chatId, tid, lang, next, accounts[0], mode);
    return;
  }
  await setWizard(env.DB, tid, 'b:cf_account', next);
  const rows = accounts.slice(0, 20).map((a, i) => [
    { text: `☁️ ${a.name}`, callback_data: `b:acc:${i}` },
  ]);
  await tg.sendMessage(chatId, t(lang, 'b_pick_account'), kb(rows));
}

/** Probe permissions for the chosen account, then continue install or reinstall. */
async function afterAccountChosen(
  env: Env,
  tg: Tg,
  chatId: number,
  tid: number,
  lang: Lang,
  data: InstallData,
  account: CfAccount,
  mode: 'install' | 'reinstall'
): Promise<void> {
  const cf = new Cf(data.cf_token || '');
  const probe = await probePerms(cf, account.id);
  if (!probe.ok) {
    // stop with a short guide; wizard goes back to the cf-token step so a new token can be sent
    await setWizard(env.DB, tid, mode === 'install' ? 'b:cf_token' : 'b:re:cf', { ...data, cf_token: undefined });
    await tg.sendMessage(chatId, t(lang, 'b_perm_missing', { missing: esc(probe.missing) }), CANCEL_KB);
    await audit(env.DB, tid, 'builder.wizard.perms_missing', mode, account.id, probe.missing);
    return;
  }

  if (mode === 'reinstall' && typeof data.inst_id === 'number') {
    const row = await getInstallation(env, tid, data.inst_id);
    if (!row) {
      await setWizard(env.DB, tid, null, {});
      await tg.sendMessage(chatId, t(lang, 'b_err_generic'));
      return;
    }
    const next: InstallData = {
      ...data,
      account_id: account.id,
      account_name: account.name,
      worker_name: row.worker_name,
      panel_name: row.panel_name,
      db_name: row.db_name,
    };
    await tg.sendMessage(chatId, `⏳ ${esc(account.name)} — ${t(lang, 'b_exec_running')}`);
    await runPipeline(env, tg, chatId, tid, lang, next, 1);
    return;
  }

  // install mode → propose resource names
  const next: InstallData = { ...data, account_id: account.id, account_name: account.name };
  const base = proposeBase(next.bot_username || 'bot');
  await applyNames(env, tg, chatId, tid, lang, next, cf, base);
}

async function probePerms(cf: Cf, accountId: string): Promise<{ ok: true } | { ok: false; missing: string }> {
  const missing: string[] = [];
  const w = await cf.probeWorkers(accountId);
  if (!w.ok) missing.push('Workers Scripts');
  const d = await cf.probeD1(accountId);
  if (!d.ok) missing.push('D1');
  if (missing.length) return { ok: false, missing: missing.join(' + ') };
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*  Wizard — step: resource names + confirm                                   */
/* -------------------------------------------------------------------------- */

async function applyNames(
  env: Env,
  tg: Tg,
  chatId: number,
  tid: number,
  lang: Lang,
  data: InstallData,
  cf: Cf,
  base: string
): Promise<void> {
  const worker = base;
  const panel = `${base}-panel`;
  const db = `${base}-db`;

  // availability: reuse existing D1 (warn), warn on worker overwrite
  let dbExists = false;
  let workerExists = false;
  const d1 = await cf.listD1(data.account_id || '');
  if (d1.ok && d1.result) dbExists = d1.result.some((x) => x.name === db);
  const wl = await cf.listWorkers(data.account_id || '');
  if (wl.ok && wl.result) workerExists = wl.result.some((x) => x.id === worker);

  const next: InstallData = { ...data, worker_name: worker, panel_name: panel, db_name: db, db_exists: dbExists, worker_exists: workerExists };
  await setWizard(env.DB, tid, 'b:names', next);

  const warn =
    (dbExists ? t(lang, 'b_names_warn_db') : '') +
    (workerExists ? t(lang, 'b_names_warn_worker') : '');
  await tg.sendMessage(chatId, t(lang, 'b_names_intro', { worker, panel, db, warn }), kb([
    [{ text: t(lang, 'b_btn_names_ok'), callback_data: 'b:names:ok' }],
  ]));
}

async function sendConfirm(env: Env, tg: Tg, chatId: number, tid: number, lang: Lang, data: InstallData): Promise<void> {
  await setWizard(env.DB, tid, 'b:confirm', data);
  const dbwarn = data.db_exists ? `♻️ ${t(lang, 'b_exec_detail_reused')}: ${data.db_name}\n` : '';
  await tg.sendMessage(chatId, t(lang, 'b_confirm', {
    bot: esc(data.bot_username || '?'),
    account: esc(data.account_name || data.account_id || '?'),
    worker: data.worker_name || '',
    panel: data.panel_name || '',
    db: data.db_name || '',
    version: standaloneVersion(),
    dbwarn,
  }), kb([[{ text: t(lang, 'b_btn_confirm'), callback_data: 'b:do' }]]));
}

/* -------------------------------------------------------------------------- */
/*  Misc helpers                                                              */
/* -------------------------------------------------------------------------- */

async function startInstall(env: Env, tg: Tg, chatId: number, tid: number, lang: Lang): Promise<void> {
  await setWizard(env.DB, tid, 'b:bot_token', {});
  await tg.sendMessage(chatId, t(lang, 'b_ask_bot_token'), CANCEL_KB);
}

async function getInstallation(env: Env, tid: number, id: number): Promise<InstallationRow | null> {
  return env.DB
    .prepare(`SELECT * FROM bot_installations WHERE id=? AND owner_tid=?`)
    .bind(id, tid)
    .first<InstallationRow>();
}

async function sendStatusList(env: Env, tg: Tg, chatId: number, lang: Lang, tid: number): Promise<void> {
  const rows = await env.DB
    .prepare(
      `SELECT id, bot_username, worker_name, panel_name, subdomain, version, status
       FROM bot_installations WHERE owner_tid=? ORDER BY id DESC LIMIT 20`
    )
    .bind(tid)
    .all<{ id: number; bot_username: string; worker_name: string; panel_name: string; subdomain: string; version: string; status: string }>();
  if (!rows.results.length) {
    await tg.sendMessage(chatId, t(lang, 'b_status_none'), kb([[{ text: t(lang, 'b_btn_install'), callback_data: 'menu:install' }]]));
    return;
  }
  const list = rows.results
    .map((r) =>
      t(lang, 'b_status_item', {
        id: r.id,
        bot: esc(r.bot_username),
        status: esc(r.status),
        version: esc(r.version),
        worker_url: r.subdomain ? workerUrlFor(r.worker_name, r.subdomain) : '—',
        panel_url: r.subdomain && r.panel_name ? workerUrlFor(r.panel_name, r.subdomain) : '—',
      })
    )
    .join('\n');
  await tg.sendMessage(chatId, t(lang, 'b_status_list', { list }), mainMenuKeyboard(lang));
}

/* -------------------------------------------------------------------------- */
/*  Callbacks                                                                 */
/* -------------------------------------------------------------------------- */

async function handleCallback(env: Env, tg: Tg, cb: TgCallbackQuery): Promise<void> {
  if (!cb.message) {
    await tg.answerCallback(cb.id);
    return;
  }
  const chatId = cb.message.chat.id;
  const tid = cb.from.id;
  const data = cb.data || '';

  if (rateLimited(tid)) {
    await tg.answerCallback(cb.id, t('fa', 'b_rate_limited'), true);
    return;
  }
  const user = await ensureBuilderUser(env, cb.from);
  const lang: Lang = user?.lang ?? 'fa';

  // join gate re-check
  if (data === 'b:check') {
    await tg.answerCallback(cb.id);
    if (await passesJoinGate(env, tg, tid)) {
      await tg.sendMessage(chatId, t(lang, 'b_menu'), mainMenuKeyboard(lang));
    } else {
      await tg.sendMessage(chatId, t(lang, 'b_join_required'), joinGateKeyboard(env, lang));
    }
    return;
  }

  if (data === 'menu:start') {
    await tg.answerCallback(cb.id);
    if (await passesJoinGate(env, tg, tid)) {
      await tg.sendMessage(chatId, t(lang, 'b_menu'), mainMenuKeyboard(lang));
    } else {
      await tg.sendMessage(chatId, t(lang, 'b_join_required'), joinGateKeyboard(env, lang));
    }
    return;
  }

  if (data === 'menu:install') {
    await tg.answerCallback(cb.id);
    if (!(await passesJoinGate(env, tg, tid))) {
      await tg.sendMessage(chatId, t(lang, 'b_join_required'), joinGateKeyboard(env, lang));
      return;
    }
    await startInstall(env, tg, chatId, tid, lang);
    return;
  }

  if (data === 'menu:status') {
    await tg.answerCallback(cb.id);
    if (!(await passesJoinGate(env, tg, tid))) {
      await tg.sendMessage(chatId, t(lang, 'b_join_required'), joinGateKeyboard(env, lang));
      return;
    }
    await sendStatusList(env, tg, chatId, lang, tid);
    return;
  }

  if (data === 'menu:help') {
    await tg.answerCallback(cb.id);
    await tg.sendMessage(chatId, t(lang, 'b_help'), mainMenuKeyboard(lang));
    return;
  }

  if (data === 'b:cancel') {
    await tg.answerCallback(cb.id);
    await setWizard(env.DB, tid, null, {}); // wipes transient tokens
    await audit(env.DB, tid, 'builder.wizard.cancel', 'wizard', '', '');
    await tg.sendMessage(chatId, t(lang, 'b_cancelled'), mainMenuKeyboard(lang));
    return;
  }

  const wiz = await getWizard(env.DB, tid);

  if (data.startsWith('b:acc:')) {
    const idx = parseInt(data.slice(6), 10);
    if (!wiz || wiz.step !== 'b:cf_account' || !wiz.data.accounts || !wiz.data.accounts[idx]) {
      await tg.answerCallback(cb.id, t(lang, 'b_err_generic'), true);
      return;
    }
    await tg.answerCallback(cb.id);
    const mode: 'install' | 'reinstall' = typeof wiz.data.inst_id === 'number' ? 'reinstall' : 'install';
    await afterAccountChosen(env, tg, chatId, tid, lang, wiz.data, wiz.data.accounts[idx], mode);
    return;
  }

  if (data === 'b:names:ok') {
    if (!wiz || wiz.step !== 'b:names' || !wiz.data.worker_name) {
      await tg.answerCallback(cb.id, t(lang, 'b_err_generic'), true);
      return;
    }
    await tg.answerCallback(cb.id);
    await sendConfirm(env, tg, chatId, tid, lang, wiz.data);
    return;
  }

  if (data === 'b:do') {
    if (!wiz || wiz.step !== 'b:confirm' || !wiz.data.account_id || !wiz.data.customer_bot_token || !wiz.data.cf_token) {
      await tg.answerCallback(cb.id, t(lang, 'b_err_generic'), true);
      return;
    }
    await tg.answerCallback(cb.id);
    await runPipeline(env, tg, chatId, tid, lang, wiz.data, 1);
    return;
  }

  if (data.startsWith('b:retry:')) {
    const n = parseInt(data.slice(8), 10);
    if (!wiz || !(wiz.step === 'b:exec' || wiz.step === 'b:re:exec') || !Number.isInteger(n)) {
      await tg.answerCallback(cb.id, t(lang, 'b_err_generic'), true);
      return;
    }
    await tg.answerCallback(cb.id);
    await runPipeline(env, tg, chatId, tid, lang, wiz.data, n);
    return;
  }

  await tg.answerCallback(cb.id);
}

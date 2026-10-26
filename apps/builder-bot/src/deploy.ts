/**
 * Deployment pipeline — provisions the customer's standalone CYBRIX (bot worker + panel
 * worker + D1) on THEIR Cloudflare account, then points the customer bot webhook at it.
 *
 * Tokens are used transiently: they arrive via wizard_state, and step 8 wipes the wizard
 * row so no token survives the install. Nothing token-shaped is ever logged.
 *
 * __BUILD_INJECT__ — the three constants below are replaced by scripts/build.sh with the
 * compiled standalone bot bundle, the web-panel bundle and its version string.
 */
import { OFFICIAL_CHANNELS, randHex } from '../../../packages/shared/src/config';
import type { Env, InstallData } from './types';
import { now, audit, setWizard } from './db';
import { Cf, type D1DbInfo } from './cf';
import { Tg, kb } from './tg';
import { t, type Lang } from './strings';
import { esc, sleep, shortErr, workerUrlFor } from './util';

// __BUILD_INJECT__ — replaced by scripts/build.sh
const STANDALONE_BUNDLE = '__STANDALONE_BUNDLE__';
const PANEL_BUNDLE = '__PANEL_BUNDLE__';
const STANDALONE_VERSION = '__STANDALONE_VERSION__';

export function standaloneVersion(): string {
  return STANDALONE_VERSION;
}

export const PIPELINE_STEPS = 8;
const STEP_KEYS = [
  'b_step_d1',
  'b_step_bot',
  'b_step_subdomain',
  'b_step_panel',
  'b_step_panel_sub',
  'b_step_webhook',
  'b_step_health',
  'b_step_save',
] as const;

interface StepState {
  status: 'pending' | 'run' | 'ok' | 'fail';
  detail?: string;
}

interface StepOutcome {
  ok: boolean;
  code?: number | string;
  message?: string;
}

interface PipelineCtx {
  dbUuid: string;
  subdomain: string;
  workerUrl: string;
  panelUrl: string;
  webhookSecret: string;
  dbReused: boolean;
}

type StepFn = (n: number) => Promise<StepOutcome>;

/* -------------------------------------------------------------------------- */
/*  Public entrypoints                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Install mode: full pipeline (steps 1-8). Reinstall mode (data.inst_id set):
 * same 8 steps, but step 1 reuses/recreates the recorded D1 and step 8 updates the row.
 * startStep > 1 resumes after a failure (retry button `b:retry:<n>`).
 */
export async function runPipeline(
  env: Env,
  tg: Tg,
  chatId: number,
  tid: number,
  lang: Lang,
  data: InstallData,
  startStep = 1
): Promise<void> {
  const reinstall = typeof data.inst_id === 'number';
  const cf = new Cf(data.cf_token || '');
  const cx: PipelineCtx = {
    dbUuid: '',
    subdomain: '',
    workerUrl: '',
    panelUrl: '',
    webhookSecret: data.webhook_secret || randHex(16), // 32 hex chars
    dbReused: false,
  };

  // Persist the webhook secret so a retry keeps the same one.
  await setWizard(env.DB, tid, reinstall ? 'b:re:exec' : 'b:exec', { ...data, webhook_secret: cx.webhookSecret });

  const progress = await tg.sendMessage(chatId, renderProgress(lang, blankStates(), true));
  const msgId = progress?.message_id;
  const states: StepState[] = blankStates();

  const steps: StepFn[] = [
    (n) => stepD1(cf, states, data, cx),
    (n) => stepUploadBot(cf, states, data, cx),
    (n) => stepSubdomain(cf, states, data, cx, false),
    (n) => stepUploadPanel(cf, states, data, cx),
    (n) => stepSubdomain(cf, states, data, cx, true),
    (n) => stepWebhook(states, data, cx),
    (n) => stepHealth(states, cx),
    (n) => stepFinalize(env, tg, chatId, tid, lang, states, data, cx, reinstall),
  ];

  for (let n = Math.max(1, startStep); n <= PIPELINE_STEPS; n++) {
    states[n - 1].status = 'run';
    await editProgress(tg, chatId, msgId, lang, states, true);
    const out = await steps[n - 1](n);
    if (!out.ok) {
      states[n - 1].status = 'fail';
      const failText = t(lang, 'b_exec_failed', {
        step: t(lang, STEP_KEYS[n - 1]),
        err: esc(shortErr(out.code, out.message)),
      });
      await editProgress(tg, chatId, msgId, lang, states, false, failText, kb([
        [{ text: t(lang, 'b_btn_retry'), callback_data: `b:retry:${n}` }],
        [{ text: '✖️ لغو / Cancel', callback_data: 'b:cancel' }],
      ]));
      await audit(env.DB, tid, reinstall ? 'builder.reinstall.fail' : 'builder.install.fail', 'installation',
        data.worker_name || '', JSON.stringify({ step: n, code: out.code ?? '' }));
      return;
    }
    states[n - 1].status = 'ok';
  }
  await editProgress(tg, chatId, msgId, lang, states, true);
}

/* -------------------------------------------------------------------------- */
/*  Progress rendering                                                        */
/* -------------------------------------------------------------------------- */

function blankStates(): StepState[] {
  return STEP_KEYS.map(() => ({ status: 'pending' as const }));
}

function renderProgress(lang: Lang, states: StepState[], running: boolean, failText?: string): string {
  const lines = states.map((s, i) => {
    const icon = s.status === 'ok' ? '✅' : s.status === 'run' ? '⏳' : s.status === 'fail' ? '❌' : '▫️';
    return `${icon} ${t(lang, STEP_KEYS[i])}${s.detail ? ` — ${esc(s.detail)}` : ''}`;
  });
  const head = running ? t(lang, 'b_exec_running') : t(lang, 'b_exec_stopped');
  return `${head}\n\n${lines.join('\n')}${failText ? `\n\n${failText}` : ''}`;
}

async function editProgress(
  tg: Tg,
  chatId: number,
  msgId: number | undefined,
  lang: Lang,
  states: StepState[],
  running: boolean,
  failText?: string,
  opts: Record<string, unknown> = {}
): Promise<void> {
  if (!msgId) return;
  await tg.editMessage(chatId, msgId, renderProgress(lang, states, running, failText), opts);
}

/* -------------------------------------------------------------------------- */
/*  Steps                                                                     */
/* -------------------------------------------------------------------------- */

/** Step 1 — create the D1 database (or reuse an existing one with the same name). */
async function stepD1(cf: Cf, states: StepState[], data: InstallData, cx: PipelineCtx): Promise<StepOutcome> {
  const aid = data.account_id || '';
  let uuid = '';
  // list-first: reuse if a database with the same name exists
  const list = await cf.listD1(aid);
  if (list.ok && list.result) {
    const hit = list.result.find((d: D1DbInfo) => d.name === data.db_name);
    if (hit) {
      uuid = hit.uuid;
      cx.dbReused = true;
    }
  }
  if (!uuid) {
    const created = await cf.createD1(aid, data.db_name || '');
    if (created.ok && created.result?.uuid) {
      uuid = created.result.uuid;
    } else {
      // maybe created concurrently / already exists — one re-list before failing
      const again = await cf.listD1(aid);
      const hit = again.ok && again.result ? again.result.find((d) => d.name === data.db_name) : undefined;
      if (hit) {
        uuid = hit.uuid;
        cx.dbReused = true;
      } else {
        return { ok: false, code: created.code, message: created.message };
      }
    }
  }
  cx.dbUuid = uuid;
  return { ok: true };
}

/** Step 2 — upload the standalone bot worker with its bindings. */
async function stepUploadBot(cf: Cf, states: StepState[], data: InstallData, cx: PipelineCtx): Promise<StepOutcome> {
  const metadata = {
    main_module: 'main.js',
    compatibility_date: '2025-01-01',
    bindings: [
      { type: 'd1', name: 'DB', id: cx.dbUuid },
      { type: 'secret_text', name: 'BOT_TOKEN', text: data.customer_bot_token || '' },
      { type: 'secret_text', name: 'OWNER_TG_ID', text: '0' },
      { type: 'secret_text', name: 'WEBHOOK_SECRET', text: cx.webhookSecret },
      { type: 'plain_text', name: 'MANDATORY_CHANNELS', text: JSON.stringify(OFFICIAL_CHANNELS) },
      { type: 'plain_text', name: 'BRAND_NAME', text: 'CYBRIX' },
      { type: 'plain_text', name: 'VERSION', text: STANDALONE_VERSION },
      { type: 'plain_text', name: 'PANEL_URL', text: '' }, // standalone handles empty PANEL_URL gracefully
    ],
  };
  const up = await cf.uploadWorker(data.account_id || '', data.worker_name || '', metadata, STANDALONE_BUNDLE);
  if (!up.ok) return { ok: false, code: up.code, message: up.message };
  states[1].detail = 'main.js';
  return { ok: true };
}

/** Step 3 / 5 — fetch the account workers.dev subdomain and enable it for a script. */
async function stepSubdomain(
  cf: Cf,
  states: StepState[],
  data: InstallData,
  cx: PipelineCtx,
  panel: boolean
): Promise<StepOutcome> {
  if (!cx.subdomain) {
    const sub = await cf.getSubdomain(data.account_id || '');
    if (!sub.ok || !sub.result?.subdomain) return { ok: false, code: sub.code, message: sub.message };
    cx.subdomain = sub.result.subdomain;
  }
  const name = panel ? data.panel_name || '' : data.worker_name || '';
  const en = await cf.enableSubdomain(data.account_id || '', name);
  if (!en.ok) return { ok: false, code: en.code, message: en.message };
  const url = workerUrlFor(name, cx.subdomain);
  if (panel) cx.panelUrl = url;
  else cx.workerUrl = url;
  states[panel ? 4 : 2].detail = url.replace('https://', '');
  return { ok: true };
}

/** Step 4 — upload the web-panel worker (shares the same D1). */
async function stepUploadPanel(cf: Cf, states: StepState[], data: InstallData, cx: PipelineCtx): Promise<StepOutcome> {
  const metadata = {
    main_module: 'main.js',
    compatibility_date: '2025-01-01',
    bindings: [
      { type: 'd1', name: 'DB', id: cx.dbUuid },
      { type: 'plain_text', name: 'VERSION', text: STANDALONE_VERSION },
    ],
  };
  const up = await cf.uploadWorker(data.account_id || '', data.panel_name || '', metadata, PANEL_BUNDLE);
  if (!up.ok) return { ok: false, code: up.code, message: up.message };
  states[3].detail = 'main.js';
  return { ok: true };
}

/** Step 6 — point the customer bot webhook at the new worker (GET, fully URL-encoded). */
async function stepWebhook(states: StepState[], data: InstallData, cx: PipelineCtx): Promise<StepOutcome> {
  const hookUrl = `${cx.workerUrl}/webhook`;
  const res = await new Tg(data.customer_bot_token || '').setWebhookGet(hookUrl, cx.webhookSecret);
  if (!res.ok) return { ok: false, message: res.description || 'setWebhook failed' };
  states[5].detail = hookUrl;
  return { ok: true };
}

/** Step 7 — health checks with retries (3 attempts, 2s apart). */
async function stepHealth(states: StepState[], cx: PipelineCtx): Promise<StepOutcome> {
  const botOk = await checkHealth(cx.workerUrl);
  const panelOk = await checkHealth(cx.panelUrl);
  states[6].detail = `bot ${botOk ? '✅' : '❌'} / panel ${panelOk ? '✅' : '❌'}`;
  if (!botOk || !panelOk) {
    return {
      ok: false,
      message: `health check failed — bot: ${botOk ? 'ok' : 'no response'}, panel: ${panelOk ? 'ok' : 'no response'}`,
    };
  }
  return { ok: true };
}

/** Step 8 — persist the installation row, wipe transient tokens, audit, send the final guide. */
async function stepFinalize(
  env: Env,
  tg: Tg,
  chatId: number,
  tid: number,
  lang: Lang,
  states: StepState[],
  data: InstallData,
  cx: PipelineCtx,
  reinstall: boolean
): Promise<StepOutcome> {
  const ts = now();
  const webhookUrl = `${cx.workerUrl}/webhook`;
  const version = STANDALONE_VERSION;
  if (reinstall && typeof data.inst_id === 'number') {
    await env.DB
      .prepare(
        `UPDATE bot_installations SET subdomain=?, version=?, status='installed', webhook_url=?, updated_at=? WHERE id=? AND owner_tid=?`
      )
      .bind(cx.subdomain, version, webhookUrl, ts, data.inst_id, tid)
      .run();
  } else {
    await env.DB
      .prepare(
        `INSERT INTO bot_installations (owner_tid, bot_username, account_id, worker_name, panel_name, db_name, subdomain, version, status, webhook_url, installed_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?, 'installed', ?, ?, ?)`
      )
      .bind(tid, data.bot_username || '', data.account_id || '', data.worker_name || '', data.panel_name || '',
        data.db_name || '', cx.subdomain, version, webhookUrl, ts, ts)
      .run();
  }
  // Wipe transient tokens (whole wizard row) — nothing token-shaped survives.
  await setWizard(env.DB, tid, null, {});
  await audit(env.DB, tid, reinstall ? 'builder.reinstall' : 'builder.install', 'installation', data.worker_name || '',
    JSON.stringify({ bot: data.bot_username || '', account: data.account_id || '', db: cx.dbReused ? 'reused' : 'created' }));
  states[7].detail = 'tokens wiped';

  const finalText = reinstall
    ? t(lang, 'b_reinstall_done', {
        id: data.inst_id ?? 0,
        bot: esc(data.bot_username || ''),
        worker_url: cx.workerUrl,
        panel_url: cx.panelUrl,
        version,
      })
    : t(lang, 'b_install_done', {
        bot: esc(data.bot_username || ''),
        worker_url: cx.workerUrl,
        panel_url: cx.panelUrl,
        version,
      });
  await tg.sendMessage(chatId, finalText);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*  Health probe (reused by /health)                                          */
/* -------------------------------------------------------------------------- */

export async function checkHealth(base: string): Promise<boolean> {
  if (!base) return false;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${base}/health`, { headers: { 'user-agent': 'cybrix-builder-bot/1.0' } });
      if (r.status === 200) return true;
    } catch {
      /* retry */
    }
    if (i < 2) await sleep(2000);
  }
  return false;
}

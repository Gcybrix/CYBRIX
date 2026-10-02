/**
 * Inline-keyboard callback dispatch (Prompt 6 §6).
 * EVERY callback is re-authorized before rendering — forged or stale
 * callback data is rejected at the parser or the allowlist gate.
 */

import { PanelApi } from '../api/client'
import { CybrixApi } from '../api/panel'
import { checkAuthorization } from '../auth/authorize'
import { makeLogger } from '../log'
import { fireReport } from '../reporting/reporter'
import type { BotView } from '../telegram/keyboard'
import { mainMenu, parseCallbackData } from '../telegram/keyboard'
import { answerCallback, editMessage, reply } from '../telegram/send'
import type { Env, WaitCtx } from '../types'
import { checkRateLimit } from '../state/rate'
import { setSession } from '../state/session'
import { handleApiFailure } from './commands'
import { viewAudit, viewConfigs, viewDashboard, viewRelays, viewSettings, viewUsage, viewUsers } from './views'

export interface CallbackContext {
  env: Env
  ctx: WaitCtx
  chatId: number
  userId: number
  callbackId: string
  messageId?: number
  api: CybrixApi
  log: ReturnType<typeof makeLogger>
}

export async function handleCallback(
  data: string | undefined,
  base: Omit<CallbackContext, 'api' | 'log'>,
): Promise<void> {
  const log = makeLogger(base.env)
  const parsed = parseCallbackData(data)
  if (!parsed) {
    await answerCallback(base.env, base.callbackId, 'Expired or invalid action.', false, log)
    return
  }

  const client = new PanelApi({
    baseUrl: base.env.CYBRIX_API_BASE_URL,
    token: base.env.CYBRIX_BOT_API_TOKEN,
  })
  const api = new CybrixApi(client)

  // ---- re-authorization on EVERY callback (Prompt 6 §6) ----
  const auth = await checkAuthorization(base.env, api, base.userId, log)
  if (auth.result !== 'allowed') {
    await answerCallback(base.env, base.callbackId, 'Not authorized.', true, log)
    if (auth.result === 'backend_error') {
      log.error('callback_auth_backend_error', { status: auth.status, userId: base.userId })
      fireReport(base.env, base.ctx, {
        severity: 'CRITICAL',
        title: 'Bot Authorization Backend Error',
        component: 'auth',
        dedupeKey: `auth-backend|${auth.status ?? 'x'}`,
        fields: [
          { label: 'Status', value: String(auth.status ?? 'unknown') },
          { label: 'Action Required', value: 'Check bot API token / telegram_admins:read scope (GAP-B1).' },
        ],
      })
    }
    return
  }

  if (!(await checkRateLimit(base.env, base.userId))) {
    await answerCallback(base.env, base.callbackId, 'Slow down.', false, log)
    return
  }

  try {
    const view = await renderView(parsed.view, api, parsed.cursor)
    await setSession(base.env, base.userId, parsed.view, parsed.cursor)
    const edited =
      base.messageId !== undefined &&
      (await editMessage(base.env, base.chatId, base.messageId, view.text, view.keyboard, log))
    if (!edited) {
      await reply(base.env, base.chatId, view.text, view.keyboard, log)
    }
    await answerCallback(base.env, base.callbackId, undefined, false, log)
  } catch (err) {
    await answerCallback(base.env, base.callbackId, 'Action failed.', false, log)
    await handleApiFailure(
      {
        env: base.env,
        ctx: base.ctx,
        chatId: base.chatId,
        userId: base.userId,
        api,
        log,
      },
      err,
    )
  }
}

async function renderView(
  view: BotView,
  api: CybrixApi,
  cursor?: string,
): Promise<{ text: string; keyboard?: ReturnType<typeof mainMenu> }> {
  switch (view) {
    case 'menu':
      return { text: '<b>🤖 CYBRIX Bot</b>\nManagement menu:', keyboard: mainMenu() }
    case 'dash':
      return viewDashboard(api)
    case 'users':
      return viewUsers(api, cursor)
    case 'relays':
      return viewRelays(api)
    case 'stats':
      return viewUsage(api)
    case 'audit':
      return viewAudit(api, cursor)
    case 'cfg':
      return viewConfigs(api, cursor)
    case 'settings':
      return viewSettings(api)
    case 'help':
      return { text: HELP_TEXT_VIEW }
  }
}

const HELP_TEXT_VIEW = [
  '<b>❓ CYBRIX Bot</b>',
  '',
  'Use the buttons above or these commands:',
  '/status /users /user &lt;name&gt; /config &lt;name&gt;',
  '/subscription &lt;name&gt; /relays /stats /audit',
  '',
  '<i>Read-only management via the official API.</i>',
].join('\n')

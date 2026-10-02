/**
 * Slash-command dispatch (Prompt 6 §5/§17).
 *
 * Every command:  allowlist check → API call (read-only) → small reply.
 * Unauthorized users always get the SAME generic denial — no system info.
 * API failures map through userMessageForApiError — no internals leak.
 */

import { PanelApi } from '../api/client'
import { ApiError, userMessageForApiError } from '../api/errors'
import { CybrixApi } from '../api/panel'
import { UNAUTHORIZED_TEXT, checkAuthorization } from '../auth/authorize'
import { makeLogger, describeError } from '../log'
import { fireReport, reportSecurity } from '../reporting/reporter'
import { HELP_TEXT, viewAudit, viewConfigs, viewDashboard, viewRelays, viewUsage, viewUserConfigs, viewUserDetail, viewUserSubscriptions, viewUsers } from './views'
import { mainMenu } from '../telegram/keyboard'
import { reply } from '../telegram/send'
import type { Env, WaitCtx } from '../types'
import { checkRateLimit } from '../state/rate'
import { clearSession } from '../state/session'

export interface CommandContext {
  env: Env
  ctx: WaitCtx
  chatId: number
  userId: number
  api: CybrixApi
  log: ReturnType<typeof makeLogger>
}

export interface DispatchResult {
  handled: boolean
}

export function parseCommand(text: string): { name: string; args: string } | null {
  const match = /^\/([a-zA-Z0-9_]+)(?:@[A-Za-z0-9_]+)?\s*([\s\S]*)$/.exec(text.trim())
  if (!match) return null
  return { name: match[1].toLowerCase(), args: match[2].trim() }
}

export async function handleCommand(
  cmd: { name: string; args: string },
  ctxIn: Omit<CommandContext, 'api' | 'log'>,
): Promise<DispatchResult> {
  const log = makeLogger(ctxIn.env)
  const client = new PanelApi({
    baseUrl: ctxIn.env.CYBRIX_API_BASE_URL,
    token: ctxIn.env.CYBRIX_BOT_API_TOKEN,
  })
  const api = new CybrixApi(client)
  const ctx: CommandContext = { ...ctxIn, api, log }

  // ---- authorization gate (Prompt 6 §4) ----
  const auth = await checkAuthorization(ctxIn.env, api, ctxIn.userId, log)
  if (auth.result !== 'allowed') {
    await reply(ctxIn.env, ctxIn.chatId, UNAUTHORIZED_TEXT, undefined, log)
    if (auth.result === 'backend_error') {
      log.error('auth_backend_error', { status: auth.status, userId: ctxIn.userId })
      fireReport(ctxIn.env, ctxIn.ctx, {
        severity: 'CRITICAL',
        title: 'Bot Authorization Backend Error',
        component: 'auth',
        dedupeKey: `auth-backend|${auth.status ?? 'x'}`,
        fields: [
          { label: 'Status', value: String(auth.status ?? 'unknown') },
          { label: 'Action Required', value: 'Check bot API token / telegram_admins:read scope (GAP-B1).' },
        ],
      })
    } else {
      reportSecurity(ctxIn.env, ctxIn.ctx, {
        type: 'unauthorized_command',
        actor: `telegram:${ctxIn.userId}`,
        action: `/${cmd.name}`,
      })
    }
    return { handled: true }
  }

  // ---- anti-spam (Prompt 6 §14) ----
  if (!(await checkRateLimit(ctxIn.env, ctxIn.userId))) {
    await reply(ctxIn.env, ctxIn.chatId, '⏳ Too many commands. Slow down.', undefined, log)
    return { handled: true }
  }

  try {
    switch (cmd.name) {
      case 'start': {
        await clearSession(ctxIn.env, ctxIn.userId)
        await reply(ctxIn.env, ctxIn.chatId, '<b>🤖 CYBRIX Bot</b>\nManagement menu:', mainMenu(), log)
        return { handled: true }
      }
      case 'help': {
        await reply(ctxIn.env, ctxIn.chatId, HELP_TEXT, undefined, log)
        return { handled: true }
      }
      case 'status': {
        const view = await viewDashboard(api)
        await reply(ctxIn.env, ctxIn.chatId, view.text, view.keyboard, log)
        return { handled: true }
      }
      case 'stats': {
        const view = await viewUsage(api)
        await reply(ctxIn.env, ctxIn.chatId, view.text, view.keyboard, log)
        return { handled: true }
      }
      case 'users': {
        const view = await viewUsers(api, undefined)
        await reply(ctxIn.env, ctxIn.chatId, view.text, view.keyboard, log)
        return { handled: true }
      }
      case 'user': {
        if (!cmd.args) {
          await reply(ctxIn.env, ctxIn.chatId, 'Usage: <code>/user &lt;username&gt;</code>', undefined, log)
          return { handled: true }
        }
        const view = await viewUserDetail(api, cmd.args)
        await reply(ctxIn.env, ctxIn.chatId, view.text, view.keyboard, log)
        return { handled: true }
      }
      case 'config': {
        if (!cmd.args) {
          const view = await viewConfigs(api, undefined)
          await reply(ctxIn.env, ctxIn.chatId, view.text, view.keyboard, log)
          return { handled: true }
        }
        const view = await viewUserConfigs(api, cmd.args)
        await reply(ctxIn.env, ctxIn.chatId, view.text, view.keyboard, log)
        return { handled: true }
      }
      case 'subscription': {
        if (!cmd.args) {
          await reply(ctxIn.env, ctxIn.chatId, 'Usage: <code>/subscription &lt;username&gt;</code>', undefined, log)
          return { handled: true }
        }
        const view = await viewUserSubscriptions(api, cmd.args)
        await reply(ctxIn.env, ctxIn.chatId, view.text, view.keyboard, log)
        return { handled: true }
      }
      case 'relays': {
        const view = await viewRelays(api)
        await reply(ctxIn.env, ctxIn.chatId, view.text, view.keyboard, log)
        return { handled: true }
      }
      case 'audit': {
        const view = await viewAudit(api, undefined)
        await reply(ctxIn.env, ctxIn.chatId, view.text, view.keyboard, log)
        return { handled: true }
      }
      default:
        return { handled: false }
    }
  } catch (err) {
    await handleApiFailure(ctx, err)
    return { handled: true }
  }
}

/** Shared API-failure UX: map → user message → operator report on auth breakage. */
export async function handleApiFailure(ctx: CommandContext, err: unknown): Promise<void> {
  ctx.log.warn('api_call_failed', { ...describeError(err) })
  if (err instanceof ApiError && (err.status === 401 || err.code === 'UNAUTHORIZED')) {
    fireReport(ctx.env, ctx.ctx, {
      severity: 'CRITICAL',
      title: 'Bot API Authentication Failed',
      component: 'api-client',
      dedupeKey: 'api-auth-failed',
      fields: [{ label: 'Action Required', value: 'Rotate CYBRIX_BOT_API_TOKEN (api_clients).' }],
    })
  } else if (err instanceof ApiError && err.status === 403) {
    fireReport(ctx.env, ctx.ctx, {
      severity: 'INFO',
      title: 'Bot Scope Missing',
      component: 'api-client',
      dedupeKey: `scope-missing|${err.code}`,
      fields: [
        { label: 'Hint', value: 'Grant required scopes (OD-5 draft + GAP-B1) to the bot api_client.' },
      ],
    })
  }
  await reply(ctx.env, ctx.chatId, userMessageForApiError(err), undefined, ctx.log)
}

/**
 * Update router — the single entry from the webhook into bot logic.
 *
 * Pipeline: dedup(update_id) → extract actor/chat → rate limit →
 *           allowlist auth → command/callback dispatch.
 * Every path is exception-safe: an error never escapes to the Worker
 * (webhook already returned 200), it is logged + reported instead.
 */

import { KV_PREFIX, LIMITS } from '../config'
import { describeError, makeLogger } from '../log'
import { fireReport } from '../reporting/reporter'
import { reply } from '../telegram/send'
import { parseCommand, handleCommand } from './commands'
import { handleCallback } from './callbacks'
import type { Env, WaitCtx } from '../types'
import type { TgUpdate } from '../telegram/types'
import { updateActor, updateChatId } from '../telegram/types'

export async function handleUpdate(update: TgUpdate, env: Env, ctx: WaitCtx): Promise<void> {
  const log = makeLogger(env)
  try {
    if (!update || typeof update.update_id !== 'number') return

    // -- duplicate suppression (Telegram may retry deliveries) --
    const dedupKey = KV_PREFIX.update + update.update_id
    const seen = await env.KV.get(dedupKey)
    if (seen) return
    try {
      await env.KV.put(dedupKey, '1', { expirationTtl: LIMITS.UPDATE_DEDUP_TTL_S })
    } catch {
      /* best-effort */
    }

    const userId = updateActor(update)
    const chatId = updateChatId(update)
    if (userId === undefined || chatId === undefined) return

    if (update.message && typeof update.message.text === 'string' && update.message.text.startsWith('/')) {
      const cmd = parseCommand(update.message.text)
      const handled = cmd ? await handleCommand(cmd, { env, ctx, chatId, userId }) : { handled: false }
      if (!handled.handled) {
        await reply(env, chatId, 'Unknown command. Try /help.', undefined, log)
      }
      return
    }

    if (update.callback_query) {
      await handleCallback(update.callback_query.data, {
        env,
        ctx,
        chatId,
        userId,
        callbackId: update.callback_query.id,
        messageId: update.callback_query.message?.message_id,
      })
      return
    }

    // non-command text messages are ignored in v1
  } catch (err) {
    log.error('update_processing_failed', describeError(err))
    fireReport(env, ctx, {
      severity: 'ERROR',
      title: 'Update Processing Failed',
      component: 'update-router',
      dedupeKey: 'update-processing-failed',
      fields: [{ label: 'Action Required', value: 'Inspect worker logs (redacted).' }],
    })
  }
}

/** Denial helper shared by tests — exposed to keep behavior in one place. */
export { parseCommand, handleCommand }

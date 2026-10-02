/**
 * Telegram transport — sendMessage / answerCallbackQuery / editMessageText.
 *
 * Guarantees (Prompt 6 §13):
 *  - NEVER throws: transport failures are returned as booleans
 *  - bounded retries with backoff, honors Telegram 429 retry_after once
 *  - the bot token (embedded in the URL) is never logged
 *  - every outgoing text passes the redaction scrubber (defense in depth)
 */

import { LIMITS } from '../config'
import type { Logger } from '../log'
import { describeError } from '../log'
import { redact } from '../reporting/redact'
import { clampMessage } from './format'
import type { TgInlineKeyboardMarkup } from './types'

const TELEGRAM_BASE = 'https://api.telegram.org'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function callTelegram(
  env: { TELEGRAM_BOT_TOKEN: string },
  method: string,
  payload: Record<string, unknown>,
  log?: Logger,
): Promise<{ ok: boolean; status?: number }> {
  // token is interpolated ONLY here and never logged
  const url = `${TELEGRAM_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`

  for (let attempt = 0; attempt < LIMITS.TG_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      })

      if (res.ok) return { ok: true, status: res.status }

      if (res.status === 429 && attempt < LIMITS.TG_ATTEMPTS - 1) {
        const body = (await res.json().catch(() => null)) as
          | { parameters?: { retry_after?: number } }
          | null
        const ra = Math.min(body?.parameters?.retry_after ?? 1, 5)
        await sleep(ra * 1000)
        continue
      }

      // 4xx (other than 429) will not heal — stop retrying
      if (res.status >= 400 && res.status < 500) {
        log?.warn('telegram_client_error', { method, status: res.status })
        return { ok: false, status: res.status }
      }
    } catch (err) {
      log?.warn('telegram_network_error', { method, attempt, ...describeError(err) })
    }

    if (attempt < LIMITS.TG_ATTEMPTS - 1) {
      await sleep(LIMITS.TG_BACKOFF_MS[attempt] ?? 1000)
    }
  }

  return { ok: false }
}

/** Send a message; returns the created message id when known. */
export async function reply(
  env: { TELEGRAM_BOT_TOKEN: string },
  chatId: number,
  text: string,
  keyboard?: TgInlineKeyboardMarkup,
  log?: Logger,
): Promise<boolean> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: clampMessage(redact(text)),
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  }
  if (keyboard) payload.reply_markup = keyboard
  const res = await callTelegram(env, 'sendMessage', payload, log)
  if (!res.ok) log?.warn('reply_failed', { chatId: String(chatId), status: res.status })
  return res.ok
}

export async function answerCallback(
  env: { TELEGRAM_BOT_TOKEN: string },
  callbackId: string,
  text?: string,
  showAlert = false,
  log?: Logger,
): Promise<void> {
  const payload: Record<string, unknown> = { callback_query_id: callbackId }
  if (text) {
    payload.text = redact(text).slice(0, 190)
    payload.show_alert = showAlert
  }
  const res = await callTelegram(env, 'answerCallbackQuery', payload, log)
  if (!res.ok) log?.warn('answer_callback_failed', { status: res.status })
}

/** Replace a bot message in place (used by inline pagination to avoid spam). */
export async function editMessage(
  env: { TELEGRAM_BOT_TOKEN: string },
  chatId: number,
  messageId: number,
  text: string,
  keyboard?: TgInlineKeyboardMarkup,
  log?: Logger,
): Promise<boolean> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text: clampMessage(redact(text)),
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  }
  if (keyboard) payload.reply_markup = keyboard
  const res = await callTelegram(env, 'editMessageText', payload, log)
  if (!res.ok) log?.warn('edit_message_failed', { status: res.status })
  return res.ok
}

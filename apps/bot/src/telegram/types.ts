/**
 * Minimal Telegram Bot API types (only what the webhook consumes).
 * Deliberately narrow — we never echo raw update objects back to users.
 */

export interface TgUser {
  id: number
  is_bot?: boolean
  first_name?: string
  username?: string
}

export interface TgChat {
  id: number
  type?: string
}

export interface TgMessage {
  message_id: number
  from?: TgUser
  chat: TgChat
  date?: number
  text?: string
}

export interface TgCallbackQuery {
  id: string
  from: TgUser
  message?: TgMessage
  data?: string
}

export interface TgUpdate {
  update_id: number
  message?: TgMessage
  callback_query?: TgCallbackQuery
}

export interface TgInlineKeyboardButton {
  text: string
  callback_data: string
}

export interface TgInlineKeyboardMarkup {
  inline_keyboard: TgInlineKeyboardButton[][]
}

/** Extracts the acting telegram user id from any supported update kind. */
export function updateActor(update: TgUpdate): number | undefined {
  return update.message?.from?.id ?? update.callback_query?.from?.id
}

/** Reply target chat id (callback may have no message → fall back to private chat). */
export function updateChatId(update: TgUpdate): number | undefined {
  return update.message?.chat.id ?? update.callback_query?.message?.chat.id ?? update.callback_query?.from?.id
}

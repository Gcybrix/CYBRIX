/** Minimal Telegram Bot API client for Cloudflare Workers (no deps). */
import type { Env, TgMessage, TgUser } from './types';

const API = 'https://api.telegram.org';

export class Tg {
  constructor(private env: Env) {}

  async call<T = any>(method: string, payload: Record<string, unknown>): Promise<T | null> {
    try {
      const res = await fetch(`${API}/bot${this.env.BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = (await res.json()) as { ok: boolean; result?: T; description?: string };
      if (!j.ok) {
        console.error(`TG ${method} failed: ${j.description}`);
        return null;
      }
      return j.result ?? null;
    } catch (e) {
      console.error(`TG ${method} error`, e);
      return null;
    }
  }

  sendMessage(chatId: number | string, text: string, opts: Record<string, unknown> = {}) {
    return this.call<TgMessage>('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...opts,
    });
  }

  editMessage(chatId: number | string, messageId: number, text: string, opts: Record<string, unknown> = {}) {
    return this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...opts,
    });
  }

  answerCallback(id: string, text = '', showAlert = false) {
    return this.call('answerCallbackQuery', { callback_query_id: id, text, show_alert: showAlert });
  }

  getMe() {
    return this.call<TgUser>('getMe', {});
  }

  getChatMember(chatId: string | number, userId: number) {
    return this.call<{ status: string; can_post_messages?: boolean }>('getChatMember', {
      chat_id: chatId,
      user_id: userId,
    });
  }

  getChat(chatId: string | number) {
    return this.call<{ id: number; title?: string; username?: string; type: string }>('getChat', { chat_id: chatId });
  }

  setWebhook(url: string, secret: string) {
    return this.call('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
  }
}

export function userMention(u: { first_name?: string; username?: string; id: number }): string {
  const name = u.first_name || u.username || `user${u.id}`;
  return u.username ? `@${u.username}` : name;
}

export function kb(rows: Array<Array<{ text: string; callback_data?: string; url?: string }>>) {
  return { reply_markup: { inline_keyboard: rows } };
}

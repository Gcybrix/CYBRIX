/**
 * Minimal Telegram Bot API client — works with ANY bot token.
 * Used both for the builder bot itself (env.BOT_TOKEN) and, transiently,
 * for the customer bot token (getMe / getWebhookInfo / setWebhook).
 * The token is never logged and never appears in error messages.
 */
import type { TgMessage, TgUser } from './types';

const API = 'https://api.telegram.org';

interface TgEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export class Tg {
  constructor(private token: string) {}

  /** Generic POST call. Returns null on failure (description logged, token never). */
  async call<T = any>(method: string, payload: Record<string, unknown> = {}): Promise<T | null> {
    try {
      const res = await fetch(`${API}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = (await res.json()) as TgEnvelope<T>;
      if (!j.ok) {
        console.error(`TG ${method} failed: ${j.description ?? 'unknown'}`);
        return null;
      }
      return j.result ?? null;
    } catch (e) {
      console.error(`TG ${method} error`, e);
      return null;
    }
  }

  /** getMe with explicit error reporting — used to validate customer bot tokens. */
  async getMeInfo(): Promise<{ ok: boolean; user?: TgUser; error?: string }> {
    try {
      const res = await fetch(`${API}/bot${this.token}/getMe`);
      const j = (await res.json()) as TgEnvelope<TgUser>;
      if (j.ok && j.result) return { ok: true, user: j.result };
      return { ok: false, error: (j.description || `HTTP ${res.status}`).slice(0, 120) };
    } catch {
      return { ok: false, error: 'network error' };
    }
  }

  /** getWebhookInfo with explicit error reporting. */
  async getWebhookInfo(): Promise<{ ok: boolean; info?: { url: string; pending_update_count?: number }; error?: string }> {
    try {
      const res = await fetch(`${API}/bot${this.token}/getWebhookInfo`);
      const j = (await res.json()) as TgEnvelope<{ url: string; pending_update_count?: number }>;
      if (j.ok && j.result) return { ok: true, info: j.result };
      return { ok: false, error: (j.description || `HTTP ${res.status}`).slice(0, 120) };
    } catch {
      return { ok: false, error: 'network error' };
    }
  }

  /**
   * setWebhook via GET with a fully URL-encoded query string
   * (spec: bot<token>/setWebhook?url=...&secret_token=...&allowed_updates=["message","callback_query"]).
   */
  async setWebhookGet(url: string, secret: string): Promise<{ ok: boolean; description?: string }> {
    const q = new URLSearchParams({
      url,
      secret_token: secret,
      allowed_updates: JSON.stringify(['message', 'callback_query']),
    });
    try {
      const res = await fetch(`${API}/bot${this.token}/setWebhook?${q.toString()}`);
      const j = (await res.json()) as TgEnvelope<true>;
      if (!j.ok) {
        console.error('TG setWebhook failed:', j.description ?? 'unknown');
        return { ok: false, description: (j.description || `HTTP ${res.status}`).slice(0, 160) };
      }
      return { ok: true };
    } catch {
      return { ok: false, description: 'network error' };
    }
  }

  /* ---------------- builder-bot messaging helpers ---------------- */

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
    return this.call<{ status: string }>('getChatMember', { chat_id: chatId, user_id: userId });
  }
}

export function kb(rows: Array<Array<{ text: string; callback_data?: string; url?: string }>>) {
  return { reply_markup: { inline_keyboard: rows } };
}

export const CANCEL_KB = kb([[{ text: '✖️ لغو / Cancel', callback_data: 'b:cancel' }]]);

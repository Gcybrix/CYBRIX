/** Central bot env & minimal Telegram update types. */
export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  OWNER_TG_ID: string;
  WEBHOOK_SECRET: string;
  MANDATORY_CHANNELS: string; // JSON array string
  VERSION: string;
}

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  forward_from_chat?: TgChat;
  reply_to_message?: TgMessage;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface DBUserRow {
  telegram_id: number;
  first_name: string;
  username: string;
  lang: 'fa' | 'en';
  role: 'user' | 'admin' | 'owner';
  status: 'active' | 'banned';
  risk_score: number;
}

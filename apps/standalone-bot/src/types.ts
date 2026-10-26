/** CYBRIX Standalone Bot env (customer's own Cloudflare account) & minimal Telegram update types. */
export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  OWNER_TG_ID: string; // may be "0" or empty → first user sending /start becomes owner (meta key owner_tid)
  WEBHOOK_SECRET: string;
  MANDATORY_CHANNELS: string; // JSON array string — initial mandatory channels (seeded into meta on first run)
  BRAND_NAME: string; // plain_text var, default "CYBRIX"
  PANEL_URL: string; // optional web panel URL; empty until the panel is deployed
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

export interface TgPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  photo?: TgPhotoSize[];
  caption?: string;
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

/** Builder bot env & minimal Telegram update types (adapted from central bot). */

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  /** JSON array string of mandatory channels, e.g. ["@cybrix_official", ...] */
  MANDATORY_CHANNELS: string;
  VERSION: string;
  /** Optional: when set, the Telegram webhook secret-token is enforced on POST /webhook. */
  WEBHOOK_SECRET?: string;
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

export interface BuilderUserRow {
  telegram_id: number;
  first_name: string;
  username: string;
  lang: 'fa' | 'en';
}

export interface InstallationRow {
  id: number;
  owner_tid: number;
  bot_username: string;
  account_id: string;
  worker_name: string;
  panel_name: string;
  db_name: string;
  subdomain: string;
  version: string;
  status: string;
  webhook_url: string;
  installed_at: number;
  updated_at: number;
}

export interface CfAccount {
  id: string;
  name: string;
}

/**
 * Wizard data (transient). Token fields (customer_bot_token / cf_token) live here ONLY
 * while a flow is running and are wiped on completion, cancel and the /health check
 * (which never stores them at all).
 */
export interface InstallData {
  bot_id?: number;
  bot_username?: string;
  customer_bot_token?: string;
  /** existing webhook URL found on the customer bot (will be overwritten) */
  webhook_warn?: string;
  cf_token?: string;
  accounts?: CfAccount[];
  account_id?: string;
  account_name?: string;
  worker_name?: string;
  panel_name?: string;
  db_name?: string;
  db_exists?: boolean;
  worker_exists?: boolean;
  /** 32-hex webhook secret for the installed bot (kept across retries) */
  webhook_secret?: string;
  /** installation row id — present in reinstall / health flows */
  inst_id?: number;
}

/**
 * cybrix-bot — environment bindings & shared app types.
 *
 * SECURITY (Prompt 6 §2): every value below arrives from Cloudflare env /
 * Secrets at runtime. None of them may ever be hardcoded, logged or echoed.
 */

export interface Env {
  /** KV namespace — temporary state ONLY (sessions, rate limits, dedup, allowlist cache) */
  KV: KVNamespace

  /* ---- Secrets (wrangler secret put) ---- */
  /** Telegram Bot token from @BotFather — Owner-only */
  TELEGRAM_BOT_TOKEN: string
  /** Webhook secret_token; Telegram echoes it in X-Telegram-Bot-Api-Secret-Token */
  TELEGRAM_WEBHOOK_SECRET: string
  /** Raw API Client token (api_clients) shown once at creation in the panel */
  CYBRIX_BOT_API_TOKEN: string

  /* ---- Vars (non-secret) ---- */
  /** Panel REST API base URL, e.g. https://cybrix-panel.example.workers.dev/api/v1 */
  CYBRIX_API_BASE_URL: string
  /** Chat id receiving CYBRIX reports (Owner's admin chat) — may be secret or var */
  TELEGRAM_REPORT_CHAT_ID: string
  LOG_LEVEL?: string
}

/** Minimal execution context surface we rely on (also satisfiable in tests). */
export interface WaitCtx {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

export interface AppEnv {
  env: Env
  ctx: WaitCtx
}

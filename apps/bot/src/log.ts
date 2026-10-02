/**
 * Structured, redacted logging (Prompt 6 §2/§13).
 * Everything passes through the redaction scrubber BEFORE it reaches stdout.
 * Never log: TELEGRAM_BOT_TOKEN, CYBRIX_BOT_API_TOKEN, relay/subscription
 * tokens, passwords, credential material, full Telegram API URLs.
 */

import { redact } from './reporting/redact'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export interface Logger {
  debug(msg: string, data?: unknown): void
  info(msg: string, data?: unknown): void
  warn(msg: string, data?: unknown): void
  error(msg: string, data?: unknown): void
}

export function makeLogger(env: { LOG_LEVEL?: string }): Logger {
  const configured = LEVEL_ORDER[(env.LOG_LEVEL as LogLevel) ?? 'info'] ?? LEVEL_ORDER.info

  const emit = (lvl: LogLevel, msg: string, data?: unknown) => {
    if (LEVEL_ORDER[lvl] < configured) return
    const line = JSON.stringify({
      t: new Date().toISOString(),
      lvl,
      svc: 'cybrix-bot',
      msg,
      ...(data !== undefined ? { data } : {}),
    })
    // single scrubber chokepoint — secret-shaped substrings never survive
    // eslint-disable-next-line no-console
    console.log(redact(line))
  }

  return {
    debug: (m, d) => emit('debug', m, d),
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
  }
}

/** Best-effort error description safe for logs — strips stack noise, redacts. */
export function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: String(err.message).slice(0, 200),
    }
  }
  return { message: redact(String(err)).slice(0, 200) }
}

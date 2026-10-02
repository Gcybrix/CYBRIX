/**
 * Structured JSON logger — Prompt 7 §28.
 * One JSON object per line on stdout. Every line is redacted before emit.
 * Required fields: ts, level, component, event (+ relay_id from base).
 */

import { redactValue } from './security/redact'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export interface LogFields {
  [key: string]: unknown
}

export class Logger {
  constructor(
    private readonly level: LogLevel,
    private readonly base: LogFields = {},
    private readonly sink: (line: string) => void = (l) => process.stdout.write(l + '\n'),
  ) {}

  child(extra: LogFields): Logger {
    return new Logger(this.level, { ...this.base, ...extra }, this.sink)
  }

  private emit(level: LogLevel, event: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return
    const line: LogFields = {
      ts: new Date().toISOString(),
      level,
      event,
      ...this.base,
      ...(fields ? (redactValue(fields) as LogFields) : {}),
    }
    try {
      this.sink(JSON.stringify(line))
    } catch {
      /* logging must never crash the relay */
    }
  }

  debug(event: string, fields?: LogFields): void {
    this.emit('debug', event, fields)
  }
  info(event: string, fields?: LogFields): void {
    this.emit('info', event, fields)
  }
  warn(event: string, fields?: LogFields): void {
    this.emit('warn', event, fields)
  }
  error(event: string, fields?: LogFields): void {
    this.emit('error', event, fields)
  }
}

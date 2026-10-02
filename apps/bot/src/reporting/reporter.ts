/**
 * TelegramReporter — central notification-delivery layer (Prompt 6 §8–§14).
 *
 * PRINCIPLES
 *  - NO business logic: formats + delivers, nothing else.
 *  - Fire-and-forget: `fire*` helpers run via ctx.waitUntil and swallow all
 *    errors → "Notification failure != Core system failure" (Prompt 6 §13).
 *  - Bounded retries with backoff on Telegram API failures; final failure
 *    goes to structured (redacted) logging.
 *  - Dedup + aggregation of similar reports; CRITICAL reports are never
 *    dropped silently (hard cap protects the Telegram API, skips are logged).
 *  - Destination abstraction: v1 = single TELEGRAM_REPORT_CHAT_ID; the
 *    destinations() seam is where multi-destination lands later (Prompt 6 §19).
 *  - No central service: reports go to THIS deployment's own bot/chat (§20).
 *
 * FUTURE STAGES (Prompt 6 §9): import the exported `fire*` functions from
 * `@cybrix/bot/reporting` — no re-implementation required.
 */

import type { Env } from '../types'
import { KV_PREFIX, LIMITS } from '../config'
import { makeLogger, describeError } from '../log'
import { redact } from './redact'
import { esc } from '../telegram/format'
import { callTelegram } from '../telegram/send'

export type Severity = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'CRITICAL'

const SEVERITY_EMOJI: Record<Severity, string> = {
  INFO: 'ℹ️',
  SUCCESS: '✅',
  WARNING: '⚠️',
  ERROR: '❌',
  CRITICAL: '🚨',
}

export interface ReportField {
  label: string
  value: string
}

export interface Report {
  severity: Severity
  title: string
  component?: string
  fields: ReportField[]
  requestId?: string
  /** stable key for dedup/aggregation; derived from title+component when omitted */
  dedupeKey?: string
}

export interface ReportEnv extends Env {}

/** v1: single destination; extend here for multi-destination (Prompt 6 §19). */
export function reportDestinations(env: Pick<Env, 'TELEGRAM_REPORT_CHAT_ID'>): number[] {
  const raw = env.TELEGRAM_REPORT_CHAT_ID
  if (!raw) return []
  const ids = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  return ids.length > 0 ? ids : []
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function formatReport(report: Report): string {
  const emoji = SEVERITY_EMOJI[report.severity] ?? 'ℹ️'
  const lines: string[] = []
  lines.push(`<b>${emoji} CYBRIX ${esc(report.title)}</b>`)
  lines.push(`Severity: <b>${esc(report.severity)}</b>`)
  if (report.component) lines.push(`Component: <code>${esc(report.component)}</code>`)
  for (const f of report.fields) {
    lines.push(`${esc(f.label)}: <code>${esc(f.value)}</code>`)
  }
  lines.push(`Time: ${new Date().toISOString()}`)
  if (report.requestId) lines.push(`Request ID: <code>${esc(report.requestId)}</code>`)
  return redact(lines.join('\n'))
}

/* ------------------------------------------------------------------ */
/* Delivery core                                                       */
/* ------------------------------------------------------------------ */

/**
 * Deliver one report with dedup/aggregation. Resolves to:
 *  - 'sent'        delivered to at least one destination
 *  - 'deduped'     identical report already sent in the window
 *  - 'aggregated'  summary sent (Nth occurrence)
 *  - 'dropped'     CRITICAL cap hit (logged, never silent for the operator)
 *  - 'failed'      Telegram delivery failed after bounded retries
 */
export async function deliverReport(
  env: ReportEnv,
  report: Report,
): Promise<'sent' | 'deduped' | 'aggregated' | 'dropped' | 'failed'> {
  const log = makeLogger(env)
  const destinations = reportDestinations(env)
  if (destinations.length === 0) {
    log.error('report_no_destination', { title: report.title })
    return 'failed'
  }

  if (report.severity === 'CRITICAL') {
    // never silently dropped; hard cap only protects the Telegram API
    try {
      const minute = Math.floor(Date.now() / 60_000)
      const capKey = `${KV_PREFIX.reportCritical}${minute}`
      const count = Number((await env.KV.get(capKey)) ?? '0')
      if (count >= LIMITS.CRITICAL_CAP_PER_MIN) {
        log.error('report_critical_capped', { title: report.title })
        return 'dropped'
      }
      await env.KV.put(capKey, String(count + 1), { expirationTtl: 120 })
    } catch (err) {
      log.warn('report_kv_error', describeError(err)) // KV failure never blocks delivery
    }
  } else {
    try {
      const key = report.dedupeKey ?? `${report.title}|${report.component ?? ''}`
      const dedupKV = KV_PREFIX.reportDedup + fnv1a(key)
      const prev = Number((await env.KV.get(dedupKV)) ?? '0')
      if (prev > 0) {
        const next = prev + 1
        await env.KV.put(dedupKV, String(next), { expirationTtl: LIMITS.REPORT_DEDUP_TTL_S })
        if (next % LIMITS.REPORT_AGGREGATE_STRIDE === 0) {
          const aggregate = formatReport({
            ...report,
            fields: [...report.fields, { label: 'Occurrences', value: `${next} in window` }],
          })
          const ok = await sendAll(env, destinations, aggregate)
          return ok ? 'aggregated' : 'failed'
        }
        return 'deduped'
      }
      await env.KV.put(dedupKV, '1', { expirationTtl: LIMITS.REPORT_DEDUP_TTL_S })
    } catch (err) {
      log.warn('report_kv_error', describeError(err)) // deliver anyway — dedup is best-effort
    }
  }

  const ok = await sendAll(env, destinations, formatReport(report))
  return ok ? 'sent' : 'failed'
}

async function sendAll(env: ReportEnv, chatIds: number[], text: string): Promise<boolean> {
  let anyOk = false
  for (const chatId of chatIds) {
    // callTelegram already performs the bounded retry/backoff loop internally
    const res = await callTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    })
    if (res.ok) anyOk = true
  }
  return anyOk
}

/** Fire-and-forget wrapper — reporting must never break the calling flow. */
export function fireReport(env: ReportEnv, ctx: { waitUntil(p: Promise<unknown>): void }, report: Report): void {
  ctx.waitUntil(
    deliverReport(env, report).catch((err) => {
      makeLogger(env).error('report_unexpected_failure', describeError(err))
    }),
  )
}

/* ------------------------------------------------------------------ */
/* Domain report helpers (Prompt 6 deliverables 12–16)                 */
/* ------------------------------------------------------------------ */

export function reportStageStarted(
  env: ReportEnv,
  ctx: { waitUntil(p: Promise<unknown>): void },
  p: { stage: string; component?: string; requestId?: string; details?: string },
): void {
  fireReport(env, ctx, {
    severity: 'INFO',
    title: 'Stage Update',
    component: p.component,
    requestId: p.requestId,
    dedupeKey: `stage-started|${p.stage}`,
    fields: [
      { label: 'Stage', value: p.stage },
      { label: 'Status', value: 'STARTED' },
      ...(p.details ? [{ label: 'Details', value: p.details }] : []),
    ],
  })
}

export function reportStageCompleted(
  env: ReportEnv,
  ctx: { waitUntil(p: Promise<unknown>): void },
  p: {
    stage: string
    components?: string[]
    durationMs?: number
    requestId?: string
  },
): void {
  fireReport(env, ctx, {
    severity: 'SUCCESS',
    title: 'Stage Completed',
    requestId: p.requestId,
    dedupeKey: `stage-done|${p.stage}`,
    fields: [
      { label: 'Stage', value: p.stage },
      { label: 'Status', value: 'SUCCESS' },
      ...(p.components ? [{ label: 'Components', value: p.components.join(', ') }] : []),
      ...(p.durationMs !== undefined
        ? [{ label: 'Duration', value: `${(p.durationMs / 1000).toFixed(1)}s` }]
        : []),
    ],
  })
}

export function reportStageFailed(
  env: ReportEnv,
  ctx: { waitUntil(p: Promise<unknown>): void },
  p: {
    stage: string
    component?: string
    errorCode?: string
    requestId?: string
    actionRequired?: string
  },
): void {
  fireReport(env, ctx, {
    severity: 'CRITICAL',
    title: 'Stage Failed',
    component: p.component,
    requestId: p.requestId,
    dedupeKey: `stage-failed|${p.stage}|${p.errorCode ?? ''}`,
    fields: [
      { label: 'Stage', value: p.stage },
      { label: 'Status', value: 'FAILED' },
      ...(p.errorCode ? [{ label: 'Error Code', value: p.errorCode }] : []),
      { label: 'Action Required', value: p.actionRequired ?? 'Check deployment logs.' },
    ],
  })
}

export function reportDeployment(
  env: ReportEnv,
  ctx: { waitUntil(p: Promise<unknown>): void },
  p: { service: string; version: string; environment: string; status: 'SUCCESS' | 'FAILED' },
): void {
  fireReport(env, ctx, {
    severity: p.status === 'SUCCESS' ? 'SUCCESS' : 'ERROR',
    title: 'Deployment',
    component: p.service,
    dedupeKey: `deploy|${p.service}|${p.version}|${p.status}`,
    fields: [
      { label: 'Service', value: p.service },
      { label: 'Version', value: p.version },
      { label: 'Environment', value: p.environment },
      { label: 'Status', value: p.status },
    ],
  })
}

export function reportRelayHealth(
  env: ReportEnv,
  ctx: { waitUntil(p: Promise<unknown>): void },
  p: { relay: string; status: string; lastHeartbeat?: string | null; usage?: string | null },
): void {
  const severity: Severity = p.status === 'ONLINE' ? 'INFO' : p.status === 'DEGRADED' ? 'WARNING' : 'ERROR'
  fireReport(env, ctx, {
    severity,
    title: 'Relay Health',
    component: p.relay,
    dedupeKey: `relay|${p.relay}|${p.status}`,
    fields: [
      { label: 'Relay', value: p.relay },
      { label: 'Status', value: p.status },
      { label: 'Last Heartbeat', value: p.lastHeartbeat ?? 'unknown' },
      ...(p.usage ? [{ label: 'Usage', value: p.usage }] : []),
    ],
  })
}

export function reportUsage(
  env: ReportEnv,
  ctx: { waitUntil(p: Promise<unknown>): void },
  p: { period: string; users: string; configs: string; traffic: string; activeRelays: string },
): void {
  fireReport(env, ctx, {
    severity: 'INFO',
    title: 'Usage Report',
    dedupeKey: `usage|${p.period}`,
    fields: [
      { label: 'Period', value: p.period },
      { label: 'Users', value: p.users },
      { label: 'Configs', value: p.configs },
      { label: 'Traffic', value: p.traffic },
      { label: 'Active Relays', value: p.activeRelays },
    ],
  })
}

export function reportSecurity(
  env: ReportEnv,
  ctx: { waitUntil(p: Promise<unknown>): void },
  p: { type: string; actor: string; action: string; resource?: string; requestId?: string },
): void {
  fireReport(env, ctx, {
    severity: 'WARNING',
    title: 'Security Event',
    requestId: p.requestId,
    dedupeKey: `security|${p.type}|${p.actor}|${p.action}`,
    fields: [
      { label: 'Type', value: p.type },
      { label: 'Actor', value: p.actor },
      { label: 'Action', value: p.action },
      ...(p.resource ? [{ label: 'Resource', value: p.resource }] : []),
    ],
  })
}

/* ------------------------------------------------------------------ */

/** FNV-1a — short stable key for dedup entries (non-cryptographic). */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

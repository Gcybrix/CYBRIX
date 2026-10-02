/**
 * View renderers — shared by slash commands and inline-keyboard callbacks.
 * Read-only; every list is paginated and small (Prompt 6 §17).
 * Renderers never receive or render secret material.
 */

import type { AuditLogEntry, Config, Relay, User } from '@cybrix/shared-types'
import type { CybrixApi } from '../api/panel'
import { bytesHuman, esc, fmtDate, shortId, timeAgo, truncate, usedPercent } from '../telegram/format'
import { paginationKeyboard } from '../telegram/keyboard'
import type { TgInlineKeyboardMarkup } from '../telegram/types'

export interface ViewOutcome {
  text: string
  keyboard?: TgInlineKeyboardMarkup
}

export const HELP_TEXT = [
  '<b>❓ CYBRIX Bot — Commands</b>',
  '',
  '/start — main menu',
  '/help — this help',
  '/status — system status',
  '/users — user list',
  '/user &lt;username&gt; — user details',
  '/config &lt;username&gt; — user configs',
  '/subscription &lt;username&gt; — user subscriptions',
  '/relays — relay health',
  '/stats — usage summary',
  '/audit — recent audit events',
  '',
  '<i>Read-only bot. All actions run through the official CYBRIX API.</i>',
].join('\n')

export async function viewDashboard(api: CybrixApi): Promise<ViewOutcome> {
  const s = await api.dashboard()
  const c = s.counts
  const lines = [
    '<b>📊 CYBRIX Status</b>',
    '',
    `👥 Users: <b>${c.users.total}</b> · ${c.users.active} active · ${c.users.disabled} disabled`,
    `🔌 Configs: <b>${c.configs.total}</b> · ${c.configs.enabled} enabled`,
    `🚀 Relays: <b>${c.relays.total}</b> · ${c.relays.online} online · ${c.relays.offline} offline`,
    `🔗 Subscriptions: <b>${c.subscriptions.total}</b> · ${c.subscriptions.active} active`,
    '',
    `📈 Traffic today: <b>${esc(bytesHuman(s.traffic.today))}</b>`,
    `📈 Last 7d: ${esc(bytesHuman(s.traffic.last_7d))} · Last 30d: ${esc(bytesHuman(s.traffic.last_30d))}`,
    '',
    `<i>Updated: ${esc(fmtDate(new Date().toISOString()))}</i>`,
  ]
  return { text: lines.join('\n') }
}

export async function viewUsage(api: CybrixApi): Promise<ViewOutcome> {
  const s = await api.dashboard()
  const online = s.relays_health.filter((r) => r.status === 'online').length
  const lines = [
    '<b>📈 Usage Report</b>',
    '',
    `Today: <b>${esc(bytesHuman(s.traffic.today))}</b>`,
    `Last 7 days: <b>${esc(bytesHuman(s.traffic.last_7d))}</b>`,
    `Last 30 days: <b>${esc(bytesHuman(s.traffic.last_30d))}</b>`,
    '',
    `Active relays: <b>${online}</b> / ${s.relays_health.length}`,
    `Active subscriptions: <b>${s.counts.subscriptions.active}</b>`,
  ]
  return { text: lines.join('\n') }
}

export async function viewUsers(
  api: CybrixApi,
  cursor?: string,
): Promise<ViewOutcome> {
  const res = await api.users({ cursor, limit: 5 })
  const users = res.data
  if (users.length === 0) {
    return { text: '👥 No users found.' }
  }
  const lines = ['<b>👥 Users</b>', '']
  for (const u of users) {
    const pct = usedPercent(u.traffic_used_bytes, u.traffic_limit_bytes)
    const pctTxt = pct === null ? '' : ` (${pct}%)`
    const expiry = u.expiry_at ? ` · exp ${fmtDate(u.expiry_at).slice(0, 10)}` : ''
    lines.push(
      `${u.enabled ? '🟢' : '⛔'} <b>${esc(u.username)}</b>${expiry}\n    ${esc(bytesHuman(u.traffic_used_bytes))} / ${esc(bytesHuman(u.traffic_limit_bytes))}${pctTxt}`,
    )
  }
  return {
    text: lines.join('\n'),
    keyboard: paginationKeyboard('users', res.meta.pagination?.next_cursor ?? null),
  }
}

export async function viewUserDetail(api: CybrixApi, query: string): Promise<ViewOutcome> {
  // resolve by username search (Prompt 4: GET /users?q=); fall back to direct id
  const res = await api.users({ q: query, limit: 5 })
  const exact = res.data.find((u) => u.username.toLowerCase() === query.toLowerCase())
  const user: User | undefined = exact ?? res.data[0]
  if (!user) return { text: `❓ No user matching <b>${esc(truncate(query, 32))}</b>.` }
  return renderUser(user)
}

export function renderUser(u: User): ViewOutcome {
  const pct = usedPercent(u.traffic_used_bytes, u.traffic_limit_bytes)
  const lines = [
    `👤 <b>${esc(u.username)}</b>`,
    '',
    `Status: ${u.enabled ? '🟢 Active' : '⛔ Disabled'}`,
    `Traffic: ${esc(bytesHuman(u.traffic_used_bytes))} / ${esc(bytesHuman(u.traffic_limit_bytes))}${pct !== null ? ` (${pct}%)` : ''}`,
    `Reset day: ${u.traffic_reset_day ?? 'default'}`,
    `Last reset: ${esc(fmtDate(u.traffic_last_reset_at))}`,
    `Expires: ${esc(fmtDate(u.expiry_at))}`,
    `Created: ${esc(fmtDate(u.created_at))}`,
  ]
  return { text: lines.join('\n') }
}

export async function viewConfigs(api: CybrixApi, cursor?: string): Promise<ViewOutcome> {
  const res = await api.configs({ cursor, limit: 5 })
  const configs = res.data
  if (configs.length === 0) {
    return { text: '🔌 No configs found.' }
  }
  const lines = ['<b>🔌 Configs</b>', '']
  for (const cfg of configs) {
    lines.push(
      `${cfg.enabled ? '🟢' : '⛔'} <b>${esc(truncate(String(cfg.name ?? cfg.id), 40))}</b>\n    path: ${pathLabel(cfg)} · user ${esc(shortId(cfg.user_id))}`,
    )
  }
  return {
    text: lines.join('\n'),
    keyboard: paginationKeyboard('cfg', res.meta.pagination?.next_cursor ?? null),
  }
}

export async function viewUserConfigs(api: CybrixApi, query: string): Promise<ViewOutcome> {
  const user = await resolveUser(api, query)
  if (!user) return { text: `❓ No user matching <b>${esc(truncate(query, 32))}</b>.` }
  const res = await api.configs({ userId: user.id, limit: 5 })
  if (res.data.length === 0) return { text: `🔌 No configs for <b>${esc(user.username)}</b>.` }
  const lines = [`<b>🔌 Configs — ${esc(user.username)}</b>`, '']
  for (const cfg of res.data) {
    lines.push(
      `${cfg.enabled ? '🟢' : '⛔'} <b>${esc(truncate(String(cfg.name ?? cfg.id), 40))}</b> · ${pathLabel(cfg)}`,
    )
  }
  return {
    text: lines.join('\n'),
    keyboard: paginationKeyboard('cfg', res.meta.pagination?.next_cursor ?? null),
  }
}

export async function viewUserSubscriptions(api: CybrixApi, query: string): Promise<ViewOutcome> {
  const user = await resolveUser(api, query)
  if (!user) return { text: `❓ No user matching <b>${esc(truncate(query, 32))}</b>.` }
  const res = await api.userSubscriptions(user.id)
  const subs = res.data
  if (subs.length === 0) return { text: `🔗 No subscriptions for <b>${esc(user.username)}</b>.` }
  const lines = [`<b>🔗 Subscriptions — ${esc(user.username)}</b>`, '']
  for (const s of subs) {
    lines.push(
      `${s.enabled ? '🟢' : '🔴'} <b>${esc(truncate(String(s.name ?? s.id), 32))}</b> · ${s.enabled ? 'Active' : 'Revoked/Disabled'}\n    created ${esc(fmtDate(s.created_at).slice(0, 10))}`,
    )
  }
  // SECURITY: tokens/URLs are NEVER rendered (Prompt 6 §12)
  lines.push('', '<i>Subscription tokens are never shown here.</i>')
  return { text: lines.join('\n') }
}

export async function viewRelays(api: CybrixApi): Promise<ViewOutcome> {
  const res = await api.relays({ limit: 50 })
  const relays: Relay[] = res.data
  if (relays.length === 0) {
    return { text: '🚀 No relays connected.' }
  }
  const lines = ['<b>🚀 Relays</b>', '']
  for (const r of relays) {
    const [emoji, label] = relayBadge(r)
    lines.push(
      `${emoji} <b>${esc(r.name)}</b> · ${label}\n    seen ${esc(timeAgo(r.last_seen_at))}${r.agent_version ? ` · v${esc(String(r.agent_version))}` : ''}`,
    )
  }
  return { text: lines.join('\n') }
}

export async function viewAudit(api: CybrixApi, cursor?: string): Promise<ViewOutcome> {
  const res = await api.auditLogs({ cursor, limit: 5 })
  const entries: AuditLogEntry[] = res.data
  if (entries.length === 0) {
    return { text: '📋 No audit events found.' }
  }
  const lines = ['<b>📋 Audit (read-only)</b>', '']
  for (const e of entries) {
    lines.push(
      `<code>${esc(fmtDate(e.created_at))}</code> · ${esc(e.actor_type)}\n    ${esc(truncate(e.action, 48))}${e.resource_type ? ` → ${esc(e.resource_type)}:${esc(shortId(e.resource_id))}` : ''}`,
    )
  }
  return {
    text: lines.join('\n'),
    keyboard: paginationKeyboard('audit', res.meta.pagination?.next_cursor ?? null),
  }
}

export async function viewSettings(api: CybrixApi): Promise<ViewOutcome> {
  const s = await api.settings()
  const lines = ['<b>⚙️ Settings (read-only view)</b>', '']
  const editableKeys = Object.keys(s.editable ?? {})
  if (editableKeys.length > 0) {
    lines.push('<b>Editable</b>')
    for (const k of editableKeys.slice(0, 10)) {
      lines.push(`• ${esc(k)}: <code>${esc(String(s.editable[k]))}</code>`)
    }
  }
  const roKeys = Object.keys(s.read_only ?? {})
  if (roKeys.length > 0) {
    lines.push('', '<b>Read-only</b>')
    for (const k of roKeys.slice(0, 6)) lines.push(`• ${esc(k)}`)
  }
  const internal = (s.internal_only ?? []).map((x) => x.key)
  if (internal.length > 0) {
    lines.push('', '<b>Secret-managed (values never exposed)</b>')
    for (const k of internal.slice(0, 8)) lines.push(`🔒 ${esc(k)}`)
  }
  return { text: lines.join('\n') }
}

/* ------------------------------------------------------------------ */

async function resolveUser(api: CybrixApi, query: string): Promise<User | undefined> {
  const res = await api.users({ q: query, limit: 5 })
  const exact = res.data.find((u) => u.username.toLowerCase() === query.toLowerCase())
  return exact ?? res.data[0]
}

function pathLabel(cfg: Config): string {
  if (cfg.upstream_id) return '→ upstream'
  if (cfg.relay_id) return '→ relay'
  return 'no path'
}

export function relayBadge(r: Relay): [string, string] {
  // String() guard: the panel may evolve status labels (Prompt 3 keeps enums open)
  switch (String(r.status)) {
    case 'online':
    case 'healthy':
      return ['🟢', 'ONLINE']
    case 'stale':
    case 'degraded':
      return ['🟡', 'DEGRADED']
    case 'disabled':
      return ['⚪', 'DISABLED']
    default:
      return ['🔴', 'OFFLINE']
  }
}

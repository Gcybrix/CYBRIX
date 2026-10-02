/**
 * Typed CYBRIX panel API service (Prompt 4 endpoints via shared-types).
 * Read-only surface — the bot performs ZERO mutations in v1 (Prompt 6 §1).
 */

import type {
  ApiClientRecord,
  AuditLogEntry,
  Config,
  DashboardSummary,
  Relay,
  SettingsView,
  Subscription,
  TelegramAdmin,
  UsageDailyRow,
  User,
} from '@cybrix/shared-types'
import { API } from '@cybrix/shared-types'
import type { ApiResult } from './client'
import type { PanelApi } from './client'

export interface ListQuery {
  cursor?: string
  limit?: number
  q?: string
  enabled?: boolean | undefined
  userId?: string
  relayId?: string
  from?: string
  to?: string
  granularity?: 'daily' | 'raw'
}

export class CybrixApi {
  constructor(private readonly client: PanelApi) {}

  dashboard(): Promise<DashboardSummary> {
    return this.client.get<DashboardSummary>(API.dashboardSummary)
  }

  users(
    q: ListQuery = {},
  ): Promise<ApiResult<User[]>> {
    return this.client.getWithMeta<User[]>(API.users, {
      cursor: q.cursor,
      limit: q.limit ?? 5,
      q: q.q,
      enabled: q.enabled === undefined ? undefined : String(q.enabled),
    })
  }

  user(id: string): Promise<User> {
    return this.client.get<User>(API.userById(id))
  }

  configs(q: ListQuery = {}): Promise<ApiResult<Config[]>> {
    return this.client.getWithMeta<Config[]>(API.configs, {
      cursor: q.cursor,
      limit: q.limit ?? 5,
      user_id: q.userId,
      relay_id: q.relayId,
      enabled: q.enabled === undefined ? undefined : String(q.enabled),
    })
  }

  upstreams(q: ListQuery = {}): Promise<ApiResult<UpstreamRow[]>> {
    return this.client.getWithMeta<UpstreamRow[]>(API.upstreams, {
      cursor: q.cursor,
      limit: q.limit ?? 20,
    })
  }

  relays(q: ListQuery = {}): Promise<ApiResult<Relay[]>> {
    return this.client.getWithMeta<Relay[]>(API.relays, {
      cursor: q.cursor,
      limit: q.limit ?? 50,
    })
  }

  userSubscriptions(userId: string): Promise<ApiResult<Subscription[]>> {
    return this.client.getWithMeta<Subscription[]>(API.userSubscriptions(userId), {
      limit: 20,
    })
  }

  usageDaily(q: ListQuery = {}): Promise<ApiResult<UsageDailyRow[]>> {
    return this.client.getWithMeta<UsageDailyRow[]>(API.usage, {
      granularity: q.granularity ?? 'daily',
      user_id: q.userId,
      relay_id: q.relayId,
      from: q.from,
      to: q.to,
      cursor: q.cursor,
      limit: q.limit ?? 100,
    })
  }

  auditLogs(q: ListQuery = {}): Promise<ApiResult<AuditLogEntry[]>> {
    return this.client.getWithMeta<AuditLogEntry[]>(API.auditLogs, {
      cursor: q.cursor,
      limit: q.limit ?? 5,
      from: q.from,
      to: q.to,
    })
  }

  telegramAdmins(): Promise<TelegramAdmin[]> {
    return this.client.get<TelegramAdmin[]>(API.telegramAdmins)
  }

  settings(): Promise<SettingsView> {
    return this.client.get<SettingsView>(API.settings)
  }

  apiClients(q: ListQuery = {}): Promise<ApiResult<ApiClientRecord[]>> {
    return this.client.getWithMeta<ApiClientRecord[]>('/api-clients', {
      cursor: q.cursor,
      limit: q.limit ?? 20,
    })
  }
}

/** minimal upstream shape the bot needs (no credentials, ever) */
export interface UpstreamRow {
  id: string
  name: string
  type: string
  host: string
  port: number
  enabled?: boolean
  has_credentials?: boolean
}

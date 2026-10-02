/**
 * API endpoint paths — mirrors Prompt 4 ch.48 Endpoint Inventory.
 * Use these constants instead of magic strings.
 */

export const API = {
  // auth (admin session — NOT used by the bot)
  authLogin: '/auth/login',
  authLogout: '/auth/logout',
  authMe: '/auth/me',
  authPasswordChange: '/auth/password/change',

  // users
  users: '/users',
  userById: (id: string) => `/users/${encodeURIComponent(id)}`,
  userSubscriptions: (userId: string) => `/users/${encodeURIComponent(userId)}/subscriptions`,

  // configs / upstreams / relays
  configs: '/configs',
  configById: (id: string) => `/configs/${encodeURIComponent(id)}`,
  upstreams: '/upstreams',
  upstreamById: (id: string) => `/upstreams/${encodeURIComponent(id)}`,
  relays: '/relays',
  relayById: (id: string) => `/relays/${encodeURIComponent(id)}`,
  relayToken: (id: string) => `/relays/${encodeURIComponent(id)}/token`,
  relayTokenRotate: (id: string) => `/relays/${encodeURIComponent(id)}/token/rotate`,
  relayTokenRevoke: (id: string) => `/relays/${encodeURIComponent(id)}/token/revoke`,

  // relay data plane (Prompt 4 §10.7–§10.9) — Relay(self), outbound-only
  relaySync: (id: string) => `/relays/${encodeURIComponent(id)}/sync`,
  relayHeartbeat: (id: string) => `/relays/${encodeURIComponent(id)}/heartbeat`,
  relayUsage: (id: string) => `/relays/${encodeURIComponent(id)}/usage`,

  // settings / telegram admins
  settings: '/settings',
  telegramAdmins: '/telegram-admins',
  telegramAdminById: (id: string) => `/telegram-admins/${encodeURIComponent(id)}`,

  // usage / audit / dashboard / health
  usage: '/usage',
  auditLogs: '/audit-logs',
  dashboardSummary: '/dashboard/summary',
  healthz: '/healthz',
  readyz: '/readyz',
} as const

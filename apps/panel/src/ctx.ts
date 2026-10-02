/**
 * Shared Hono environment typing (bindings + custom variables).
 */
import type { Env } from './env'

export interface AdminActor {
  kind: 'admin'
  adminId: string
  sessionKey: string
  session: { admin_id: string; iat: number; exp: number; csrf: string }
}
export interface BotActor {
  kind: 'bot'
  clientId: string
  name: string
  scopes: string[]
}
export interface RelayActor {
  kind: 'relay'
  relayId: string
  tokenId: string
}
export interface SubscriptionActor {
  kind: 'subscription'
  subscriptionId: string
  userId: string
  status: string
}
export type Actor = AdminActor | BotActor | RelayActor | SubscriptionActor

export interface Ctx {
  env: Env
  actor: Actor
  now: number
  requestId: string
  waitUntil(p: Promise<unknown>): void
}

export interface CybEnv {
  Bindings: Env
  Variables: { ctx: Ctx; requestId: string }
}

export interface HelperCtx {
  env: Env
  req: { raw: Request; url: string }
}

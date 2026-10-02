/**
 * Row → JSON serialization for the admin plane.
 *
 * Timestamp convention (documented as GAP-C0): the Prompt 4 design doc
 * specified epoch seconds, but the IMPLEMENTED consumers (Prompt 6 bot +
 * Prompt 5 panel UI, via packages/shared-types api.ts) serialize admin-plane
 * timestamps as ISO 8601 UTC strings — while the relay data plane (§10.7–10.9)
 * keeps epoch seconds as designed. This module emits the ISO form; every row
 * also carries the documented compat aliases (username/enabled/expiry_at) so
 * the already-implemented bot renders correctly. All aliases are additive
 * response fields (non-breaking, §17).
 */

export type Row = Record<string, unknown>

export function iso(epoch: unknown): string | null {
  if (epoch === null || epoch === undefined) return null
  const n = typeof epoch === 'bigint' ? Number(epoch) : (epoch as number)
  return new Date(n * 1000).toISOString()
}

export function int(v: unknown): number {
  if (typeof v === 'bigint') return Number(v)
  return (v as number) ?? 0
}

/** i64 byte counter → decimal string (Prompt 4 §1.2). */
export function bytesStr(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'number') return String(Math.round(v))
  return String(v)
}

function baseRow(r: Row): Row {
  return {
    id: r.id as string,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    deleted_at: iso(r.deleted_at),
    version: int(r.version),
  }
}

export function userOut(r: Row): Row {
  const status = (r.status as string) ?? 'active'
  return {
    ...baseRow(r),
    contact: r.contact,
    // compat aliases (bot/UI, GAP-C1): username≡contact, enabled≡status
    username: r.contact,
    enabled: status === 'active',
    status,
    expires_at: iso(r.expires_at),
    expiry_at: iso(r.expires_at),
    traffic_limit_bytes: bytesStr(r.traffic_limit_bytes),
    traffic_used_bytes: bytesStr(r.traffic_used_bytes) ?? '0',
    traffic_reset_day: r.traffic_reset_day ?? null,
    traffic_last_reset_at: iso(r.traffic_last_reset_at),
  }
}

export function upstreamOut(r: Row): Row {
  return {
    ...baseRow(r),
    type: r.type,
    host: r.host,
    port: int(r.port),
    status: r.status,
    enabled: r.status === 'active',
    has_credentials: false,
  }
}

export function relayOut(r: Row, now: number): Row {
  const last = r.last_heartbeat_at as number | null | undefined
  let health: string
  if (last === null || last === undefined) health = 'unknown'
  else if (now - last <= 180) health = 'online'
  else health = 'offline'
  return {
    ...baseRow(r),
    name: r.name,
    provider: r.provider ?? null,
    public_endpoint: r.public_endpoint ?? null,
    public_port: r.public_port ?? null,
    status: r.status,
    health,
    last_heartbeat_at: iso(last),
    last_health_status: r.last_health_status ?? null,
    agent_version: r.agent_version ?? null,
  }
}

export function configOut(r: Row, includeCredential = false, credential: Record<string, unknown> | null = null): Row {
  return {
    ...baseRow(r),
    user_id: r.user_id,
    protocol: r.protocol,
    upstream_id: r.upstream_id ?? null,
    relay_id: r.relay_id ?? null,
    enabled: int(r.enabled) === 1,
    has_credentials: r.credential_encrypted !== null && r.credential_encrypted !== undefined,
    credential_key_id: r.credential_key_id ?? null,
    ...(includeCredential ? { credential } : {}),
  }
}

export function subscriptionOut(r: Row): Row {
  const status = (r.status as string) ?? 'active'
  return {
    ...baseRow(r),
    user_id: r.user_id,
    status,
    enabled: status === 'active',
    name: null,
    token_prefix: r.token_prefix ?? null,
    last_accessed_at: iso(r.last_accessed_at),
  }
}

export function telegramAdminOut(r: Row): Row {
  return {
    ...baseRow(r),
    telegram_user_id: r.telegram_user_id,
    username: r.username ?? null,
    note: r.note ?? null,
    status: r.status,
    added_by: r.added_by ?? null,
  }
}

export function apiClientOut(r: Row): Row {
  let scopes: string[] = []
  try {
    scopes = JSON.parse((r.scopes as string) ?? '[]') as string[]
  } catch {
    scopes = []
  }
  return {
    ...baseRow(r),
    name: r.name,
    scopes,
    status: r.status,
    token_prefix: r.token_prefix ?? null,
    last_used_at: iso(r.last_used_at),
    created_by: r.created_by ?? null,
  }
}

export function auditOut(r: Row): Row {
  let metadata: unknown = null
  if (r.metadata) {
    try {
      metadata = JSON.parse(r.metadata as string)
    } catch {
      metadata = null
    }
  }
  return {
    id: typeof r.id === 'bigint' ? Number(r.id) : r.id,
    created_at: iso(r.created_at),
    actor_type: r.actor_type,
    actor_id: r.actor_id ?? null,
    action: r.action,
    entity_type: r.entity_type ?? null,
    entity_id: r.entity_id ?? null,
    metadata,
    // compat aliases (bot/UI, GAP-C2): resource_* ≡ entity_*, details ≡ metadata
    resource_type: r.entity_type ?? null,
    resource_id: r.entity_id ?? null,
    details: metadata,
    request_id: r.request_id ?? null,
    ip: r.ip ?? null,
    user_agent: r.user_agent ?? null,
  }
}

export function settingsView(rows: Row[], schemaVersion: number): Row {
  const values: Record<string, unknown> = {}
  for (const r of rows) {
    try {
      values[r.key as string] = JSON.parse(r.value as string)
    } catch {
      values[r.key as string] = r.value
    }
  }
  const editable: Record<string, unknown> = {}
  for (const k of ['traffic_reset_default_day']) editable[k] = values[k] ?? null
  const read_only: Record<string, unknown> = { schema_version: schemaVersion }
  return {
    settings: { traffic_reset_default_day: values['traffic_reset_default_day'] ?? 1, schema_version: schemaVersion },
    editable,
    read_only,
    internal_only: [{ key: 'ADMIN_PEPPER' }, { key: 'DATA_ENCRYPTION_KEY' }],
    internal_only_count: 2,
  }
}

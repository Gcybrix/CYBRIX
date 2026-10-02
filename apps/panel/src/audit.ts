/**
 * Audit trail writer (Prompt 4 §13): actor from auth context (never from body),
 * sanitized metadata (secret-looking keys stripped), written outside the
 * mutating transaction; failure only logs (never breaks the mutation).
 */

const SENSITIVE_KEY = /(password|token|secret|credential|authorization|api[-_]?key|cookie|pepper|key)/i

export interface AuditEvent {
  actor_type: 'admin' | 'bot' | 'relay' | 'subscription' | 'system'
  actor_id?: string | null
  action: string
  entity_type?: string | null
  entity_id?: string | null
  metadata?: Record<string, unknown> | null
  request_id?: string | null
  ip?: string | null
  user_agent?: string | null
}

export function sanitizeMetadata(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(metadata)) {
    if (SENSITIVE_KEY.test(k)) continue
    clean[k] = typeof v === 'string' && v.length > 512 ? v.slice(0, 512) : v
  }
  const json = JSON.stringify(clean)
  return json.length <= 4096 ? json : null
}

export function writeAudit(db: D1Database, event: AuditEvent, waitUntil: (p: Promise<unknown>) => void): void {
  const created = Math.floor(Date.now() / 1000)
  const metadata = sanitizeMetadata(event.metadata)
  const p = db
    .prepare(
      `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata, request_id, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      event.actor_type,
      event.actor_id ?? null,
      event.action,
      event.entity_type ?? null,
      event.entity_id ?? null,
      metadata,
      event.request_id ?? null,
      event.ip ?? null,
      event.user_agent ? event.user_agent.slice(0, 256) : null,
      created,
    )
    .run()
    .catch((err) => {
      console.error(JSON.stringify({ event: 'audit_write_failed', action: event.action, message: err instanceof Error ? err.message : 'unknown' }))
    })
  waitUntil(p)
}

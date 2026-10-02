/**
 * HTTP contract plumbing — envelopes, error registry, request ids, secure
 * headers (Prompt 4 §5, §9.3). The 11-code registry is locked; unknown codes
 * are treated as INTERNAL_ERROR by clients.
 */

export interface ReqLike {
  method: string
  headers: Headers
  url: string
  text(): Promise<string>
}

/** Accepts a raw Request OR a Hono Context (which wraps req.raw). */
export type Reqish = ReqLike | { req: { raw: Request } }

function toReq(x: Reqish): ReqLike {
  if ('method' in x && 'headers' in x && 'text' in x) return x as ReqLike
  const raw = (x as { req: { raw: Request } }).req.raw
  return { method: raw.method, headers: raw.headers, url: raw.url, text: () => raw.text() }
}

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'SESSION_EXPIRED'
  | 'TOKEN_INVALID'
  | 'TOKEN_REVOKED'
  | 'TOKEN_EXPIRED'
  | 'CSRF_FAILED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RESOURCE_DELETED'
  | 'VALIDATION_ERROR'
  | 'CURSOR_INVALID'
  | 'CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RATE_LIMITED'
  | 'REQUEST_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR'

const STATUS: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  SESSION_EXPIRED: 401,
  TOKEN_INVALID: 401,
  TOKEN_REVOKED: 401,
  TOKEN_EXPIRED: 401,
  CSRF_FAILED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RESOURCE_DELETED: 410,
  VALIDATION_ERROR: 400,
  CURSOR_INVALID: 400,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  REQUEST_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
}

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly details?: unknown
  readonly headers?: Record<string, string>
  constructor(
    code: ApiErrorCode,
    message?: string,
    details?: unknown,
    headers?: Record<string, string>,
    /** Prompt 4 §5.4: semantic validation failures use HTTP 422 with code VALIDATION_ERROR */
    statusOverride?: number,
  ) {
    super(message ?? code)
    this.code = code
    this.status = statusOverride ?? STATUS[code]
    this.details = details
    this.headers = headers
  }
}

export interface ValidationIssue {
  location: 'body' | 'query' | 'path' | 'header'
  field?: string
  issue: string
}

export function validationError(issues: ValidationIssue[]): ApiError {
  return new ApiError('VALIDATION_ERROR', 'Request validation failed', issues)
}

export function newRequestId(req: Reqish): string {
  const ray = toReq(req).headers.get('cf-ray')
  if (ray) return ray.split('-')[0] ?? ray
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

/** Prompt 4 §9.3 — applied on every API response. */
export function secureHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...extra,
  }
}

export function json(
  req: Reqish,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  const r = toReq(req)
  const requestId = extraHeaders['X-Request-Id'] ?? newRequestId(r)
  const headers = secureHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'X-Request-Id': requestId, ...extraHeaders })
  return new Response(JSON.stringify(body), { status, headers })
}

export function ok<T>(req: Reqish, data: T, meta?: Record<string, unknown>, status = 200, extraHeaders: Record<string, string> = {}): Response {
  const body: Record<string, unknown> = { data }
  if (meta && Object.keys(meta).length > 0) body.meta = meta
  return json(req, body, status, extraHeaders)
}

export function noContent(req: Reqish, extraHeaders: Record<string, string> = {}): Response {
  const requestId = extraHeaders['X-Request-Id'] ?? newRequestId(req)
  return new Response(null, { status: 204, headers: secureHeaders({ 'X-Request-Id': requestId, ...extraHeaders }) })
}

export function errorResponse(req: Reqish, err: ApiError): Response {
  const requestId = newRequestId(req)
  const body = {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
      request_id: requestId,
    },
  }
  return json(req, body, err.status, { ...(err.headers ?? {}), 'X-Request-Id': requestId })
}

export function internalError(req: Reqish, err: unknown): Response {
  // Never leak internals (§9.7): log server-side only, generic body.
  console.error(
    JSON.stringify({ event: 'unhandled_error', request_id: newRequestId(req), message: err instanceof Error ? err.message : 'unknown' }),
  )
  return errorResponse(req, new ApiError('INTERNAL_ERROR', 'Internal server error'))
}

/* ------------------------- body helpers ------------------------- */

export async function readJsonBody(req: Reqish, limitBytes: number): Promise<{ body: unknown; issues: ValidationIssue[] }> {
  const issues: ValidationIssue[] = []
  const r = toReq(req)
  const contentType = r.headers.get('content-type') ?? ''
  if (r.method !== 'GET' && r.method !== 'DELETE' && r.headers.get('content-length')) {
    const declared = Number(r.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > limitBytes) {
      throw new ApiError('REQUEST_TOO_LARGE')
    }
  }
  if (contentType && !/application\/(json|.*\+json)/i.test(contentType)) {
    throw new ApiError('UNSUPPORTED_MEDIA_TYPE')
  }
  const raw = await r.text()
  if (raw.length > limitBytes) throw new ApiError('REQUEST_TOO_LARGE')
  if (raw.trim() === '') return { body: {}, issues }
  try {
    return { body: JSON.parse(raw), issues }
  } catch {
    issues.push({ location: 'body', issue: 'invalid JSON' })
    return { body: undefined, issues }
  }
}

/** Prompt 4 §6.1 — opaque pagination cursor (base64url JSON, tie-broken by id). */
export function encodeCursor(sortValue: string | number | null, id: string): string {
  const payload = { v: 1, s: sortValue, i: id }
  const json = JSON.stringify(payload)
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeCursor(cursor: string): { v: number; s: string | number | null; i: string } {
  let parsed: unknown
  try {
    const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const bin = atob(padded)
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
    parsed = JSON.parse(json)
  } catch {
    throw new ApiError('CURSOR_INVALID', 'cursor is corrupt')
  }
  const c = parsed as { v?: number; s?: string | number | null; i?: string } | null
  if (!c || typeof c !== 'object' || c.v !== 1 || typeof c.i !== 'string' || !c.i) {
    throw new ApiError('CURSOR_INVALID', 'cursor is corrupt')
  }
  return c as { v: number; s: string | number | null; i: string }
}

/**
 * Normalized API error + user-safe message mapping (Prompt 6 §16).
 * The raw backend message is NEVER shown to Telegram users — only the
 * mapped generic text plus a short request-id reference for support.
 */

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown
  readonly requestId?: string
  readonly retryAfter?: number

  constructor(args: {
    status: number
    code: string
    message?: string
    details?: unknown
    requestId?: string
    retryAfter?: number
  }) {
    super(args.message ?? `API error ${args.status}`)
    this.name = 'ApiError'
    this.status = args.status
    this.code = args.code
    this.details = args.details
    this.requestId = args.requestId
    this.retryAfter = args.retryAfter
  }

  get isRetryable(): boolean {
    return this.status === 503 || this.status === 429 || this.status === 0
  }
}

export function userMessageForApiError(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return '🛠 Upstream error. The operator has been notified.'
  }
  let base: string
  switch (err.code) {
    case 'UNAUTHORIZED':
    case 'TOKEN_EXPIRED':
    case 'TOKEN_REVOKED':
      base = '⚠️ Panel authentication failed. The operator has been notified.'
      break
    case 'FORBIDDEN':
      base = '⛔ This action is not permitted for the bot (missing API scope).'
      break
    case 'NOT_FOUND':
    case 'RESOURCE_DELETED':
      base = '❓ Not found.'
      break
    case 'VALIDATION_ERROR':
      base = '⚠️ Invalid request.'
      break
    case 'CONFLICT':
    case 'IDEMPOTENCY_CONFLICT':
      base = '⚠️ Conflict. Please retry shortly.'
      break
    case 'RATE_LIMITED':
      base = '⏳ Panel rate limit reached. Please slow down.'
      break
    default:
      base = '🛠 Upstream error. The operator has been notified.'
  }
  return err.requestId ? `${base}\n<i>ref: ${escapeRef(err.requestId)}</i>` : base
}

/** request ids are hex/uuid-ish; show only a short prefix, defensively escaped */
function escapeRef(rid: string): string {
  return rid.replace(/&/g, '&amp;').replace(/</g, '&lt;').slice(0, 8)
}

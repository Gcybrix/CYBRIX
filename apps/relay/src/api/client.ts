/**
 * Relay API client — the ONLY door from the relay to CYBRIX (Prompt 7 §2/§7).
 *
 * Speaks the Prompt 4 relay-plane endpoints (§10.7–§10.9) with:
 *  - per-request timeout (AbortController)
 *  - bounded retry with exponential backoff + jitter for 429/5xx/network
 *  - NO retry for 401/403/404/409/410/413/422/400 (Prompt 7 §18/§30)
 *  - Retry-After respected on 429
 *  - X-Request-Id per attempt for end-to-end traceability
 *  - Bearer relay token; the token NEVER appears in errors or logs
 */

import { randomUUID } from 'node:crypto'
import type { Envelope } from '@cybrix/shared-types'
import { redactErrorMessage } from '../security/redact'

export type ApiErrorKind =
  | 'auth' //        401 — token invalid/revoked/expired
  | 'forbidden' //   403 — relay_mismatch / relay_disabled / scope
  | 'not_found' //   404
  | 'gone' //        410 — relay deleted (tombstone)
  | 'conflict' //    409 (incl. IDEMPOTENCY_CONFLICT)
  | 'permanent' //   400 / 413 / 422 — never retry the same payload
  | 'rate_limited' //429
  | 'server' //      5xx / 503
  | 'network' //     DNS / connect / timeout / abort

const STATUS_KIND: Record<number, ApiErrorKind> = {
  400: 'permanent',
  401: 'auth',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  410: 'gone',
  413: 'permanent',
  422: 'permanent',
  429: 'rate_limited',
}

export class RelayApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterS?: number,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(redactErrorMessage(message))
    this.name = 'RelayApiError'
  }

  get retryable(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'server' || this.kind === 'network'
  }
}

export interface RelayApiClientOptions {
  apiUrl: string
  /** provider (not value) — enables SIGHUP token hot-reload (Prompt 7 §19) */
  tokenProvider: () => string
  timeoutMs: number
  maxAttempts: number
  baseMs: number
  maxBackoffMs: number
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
  jitterImpl?: (maxMs: number) => number
}

export interface RequestOptions {
  body?: unknown
  query?: Record<string, string | number | undefined>
  /** return the parsed body WITHOUT envelope unwrapping (sync needs meta) */
  raw?: boolean
}

export class RelayApiClient {
  private readonly fetchImpl: typeof fetch
  private readonly sleepImpl: (ms: number) => Promise<void>
  private readonly jitterImpl: (maxMs: number) => number
  /** API base WITHOUT the /api/v1 prefix (Prompt 4 base URL is applied here) */
  private readonly base: string

  constructor(private readonly opts: RelayApiClientOptions) {
    this.base = opts.apiUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '')
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis) // bound: safe on Node & strict runtimes alike
    this.sleepImpl = opts.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.jitterImpl = opts.jitterImpl ?? ((max) => Math.floor(Math.random() * Math.max(max, 1)))
  }

  /** Envelope-unwrapping request with the Prompt 7 §18 retry matrix. */
  async request<T>(method: 'GET' | 'POST', path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(this.base + '/api/v1' + path)
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
      }
    }

    let lastError: RelayApiError | null = null

    for (let attempt = 0; attempt < this.opts.maxAttempts; attempt++) {
      const requestId = randomUUID()
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.opts.tokenProvider()}`,
          Accept: 'application/json',
          'X-Request-Id': requestId,
        }
        let body: string | undefined
        if (options.body !== undefined) {
          headers['Content-Type'] = 'application/json'
          body = JSON.stringify(options.body)
        }

        const res = await this.fetchImpl(url.toString(), {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        })

        if (!res.ok) {
          lastError = await this.toApiError(res, requestId)
          if (!lastError.retryable) throw lastError
          // fall through to backoff
        } else {
          try {
            const parsed = (await res.json()) as Partial<Envelope<T>> | T
            if (
              !options.raw &&
              parsed &&
              typeof parsed === 'object' &&
              'data' in (parsed as Record<string, unknown>)
            ) {
              return (parsed as Envelope<T>).data
            }
            return parsed as T
          } catch {
            throw new RelayApiError('server', res.status, 'INTERNAL_ERROR', 'malformed JSON body', undefined, requestId)
          }
        }
      } catch (err) {
        if (err instanceof RelayApiError) {
          if (!err.retryable) throw err
          lastError = err
        } else {
          // fetch network failure / timeout / abort
          const isTimeout = err instanceof Error && /timeout|abort/i.test(err.name + ' ' + err.message)
          lastError = new RelayApiError(
            'network',
            0,
            isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
            isTimeout ? 'request timed out' : 'network request failed',
            undefined,
            requestId,
          )
        }
      }

      if (attempt < this.opts.maxAttempts - 1) {
        const wait = this.computeBackoff(lastError, attempt)
        await this.sleepImpl(wait)
      }
    }

    throw lastError ?? new RelayApiError('network', 0, 'NETWORK_ERROR', 'request failed')
  }

  /** Prompt 7 §18: exp backoff with jitter; Retry-After wins when present
   *  (capped at a protocol-level 5 min ceiling, independent of local caps). */
  computeBackoff(err: RelayApiError | null, attempt: number): number {
    if (err?.retryAfterS && err.retryAfterS > 0) {
      return Math.min(err.retryAfterS * 1000, 300_000)
    }
    const exp = this.opts.baseMs * Math.pow(2, attempt)
    const capped = Math.min(exp, this.opts.maxBackoffMs)
    return capped + this.jitterImpl(Math.min(500, Math.floor(capped / 4)))
  }

  private async toApiError(res: Response, requestId: string): Promise<RelayApiError> {
    let code = 'INTERNAL_ERROR'
    let message = `HTTP ${res.status}`
    let details: unknown

    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string; details?: unknown }
      }
      if (body && typeof body === 'object' && body.error) {
        code = body.error.code ?? code
        if (body.error.message) message = body.error.message
        details = body.error.details
      }
    } catch {
      /* non-JSON error body — keep defaults */
    }

    let retryAfterS: number | undefined
    const ra = res.headers.get('Retry-After')
    if (ra && /^\d+$/.test(ra)) retryAfterS = Number(ra)

    const kind: ApiErrorKind =
      res.status >= 500 ? 'server' : (STATUS_KIND[res.status] ?? 'server')

    return new RelayApiError(kind, res.status, code, message, retryAfterS, requestId, details)
  }
}

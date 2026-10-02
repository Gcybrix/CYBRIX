/**
 * Panel API client — the ONLY door from the bot to CYBRIX (Prompt 6 §1/§16).
 *
 * - Bearer auth with the bot's api_clients token (never admin session / relay token)
 * - Speaks the Prompt 4 envelopes: {data, meta} success, {error:{code,...}} failure
 * - X-Request-Id on every call for traceability
 * - GET-only retry policy (1 retry on 503 / 429 / network); mutations would
 *   never be auto-retried — the bot is read-only anyway (Prompt 6 §1).
 */

import type { ApiErrorBody, Envelope, ResponseMeta } from '@cybrix/shared-types'
import { LIMITS } from '../config'
import { ApiError } from './errors'

export interface PanelApiOptions {
  baseUrl: string
  token: string
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
  timeoutMs?: number
}

export interface ApiResult<T> {
  data: T
  meta: ResponseMeta
}

const NETWORK_STATUS = 0

export class PanelApi {
  private readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch
  private readonly sleepImpl: (ms: number) => Promise<void>
  private readonly timeoutMs: number

  constructor(opts: PanelApiOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.token = opts.token
    // MUST bind: workerd requires global `this` for fetch; an unbound call throws
    // "Illegal invocation" (masked in unit tests by injected mock fetchImpl).
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis)
    this.sleepImpl = opts.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.timeoutMs = opts.timeoutMs ?? LIMITS.API_TIMEOUT_MS
  }

  /** GET returning only the payload (envelope unwrapped). */
  async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    return (await this.getWithMeta<T>(path, query)).data
  }

  /** GET returning payload + meta (pagination, request_id). */
  async getWithMeta<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<ApiResult<T>> {
    try {
      return await this.requestOnce<T>(path, query)
    } catch (err) {
      if (err instanceof ApiError && err.isRetryable) {
        const wait = Math.min(
          err.retryAfter ? err.retryAfter * 1000 : LIMITS.API_RETRY_BASE_MS,
          LIMITS.API_RETRY_MAX_WAIT_MS,
        )
        await this.sleepImpl(wait)
        return this.requestOnce<T>(path, query)
      }
      throw err
    }
  }

  private async requestOnce<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<ApiResult<T>> {
    const url = this.buildUrl(path, query)
    const requestId = crypto.randomUUID()

    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'X-Request-Id': requestId,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw new ApiError({ status: NETWORK_STATUS, code: 'NETWORK_ERROR', requestId })
    }

    if (!res.ok) {
      throw await this.toApiError(res, requestId)
    }

    let body: unknown
    try {
      body = await res.json()
    } catch {
      throw new ApiError({ status: res.status, code: 'INTERNAL_ERROR', requestId })
    }

    const envelope = body as Partial<Envelope<T>>
    if (envelope && typeof envelope === 'object' && 'data' in envelope) {
      return { data: envelope.data as T, meta: envelope.meta ?? {} }
    }
    // defensive: contract guarantees the envelope; tolerate raw payloads
    return { data: body as T, meta: {} }
  }

  private async toApiError(res: Response, requestId: string): Promise<ApiError> {
    let code = 'INTERNAL_ERROR'
    let message: string | undefined
    let details: unknown
    let errorRequestId: string | undefined

    try {
      const body = (await res.json()) as Partial<ApiErrorBody>
      if (body && typeof body === 'object' && body.error) {
        code = body.error.code ?? code
        message = body.error.message
        details = body.error.details
        errorRequestId = body.error.request_id
      }
    } catch {
      /* non-JSON error body — keep defaults */
    }

    let retryAfter: number | undefined
    const ra = res.headers.get('Retry-After')
    if (ra && /^\d+$/.test(ra)) retryAfter = Number(ra)

    return new ApiError({
      status: res.status,
      code,
      message,
      details,
      requestId: errorRequestId ?? requestId,
      retryAfter,
    })
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(this.baseUrl + path)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
      }
    }
    return url.toString()
  }
}

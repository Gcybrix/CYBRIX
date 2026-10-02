/**
 * Cursor pagination over (sort_col, id) with a permanent id tiebreaker
 * (Prompt 4 §6). Soft-deleted rows are excluded by default with the standard
 * `deleted=true|false|only` filter (§6.4).
 */
import { ApiError, decodeCursor, encodeCursor } from './http'

export interface ListParams {
  limit: number
  cursor?: string
  sort: string
  order: 'asc' | 'desc'
  deleted: 'false' | 'true' | 'only'
  q?: string
  [key: string]: unknown
}

const SORT_WHITELISTS: Record<string, readonly string[]> = {
  users: ['created_at', 'updated_at', 'expires_at', 'traffic_used_bytes'],
  configs: ['created_at', 'updated_at'],
  upstreams: ['created_at', 'updated_at', 'host'],
  relays: ['created_at', 'updated_at', 'name'],
  subscriptions: ['created_at', 'updated_at'],
  telegram_admins: ['created_at', 'updated_at'],
  api_clients: ['created_at'],
}

export function parseListQuery(
  url: URL,
  resource: string,
  defaults: Partial<ListParams> = {},
): ListParams {
  const q = url.searchParams
  const limitRaw = q.get('limit')
  let limit = limitRaw === null ? (defaults.limit ?? 25) : Number(limitRaw)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [
      { location: 'query', field: 'limit', issue: 'must be integer 1..100' },
    ])
  }
  const sort = q.get('sort') ?? defaults.sort ?? 'created_at'
  const allowed = SORT_WHITELISTS[resource] ?? ['created_at', 'updated_at']
  if (!allowed.includes(sort)) {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [
      { location: 'query', field: 'sort', issue: `must be one of: ${allowed.join(', ')}` },
    ])
  }
  const orderRaw = q.get('order') ?? defaults.order ?? 'desc'
  if (orderRaw !== 'asc' && orderRaw !== 'desc') {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [
      { location: 'query', field: 'order', issue: 'must be asc or desc' },
    ])
  }
  let deleted = (q.get('deleted') ?? 'false') as 'false' | 'true' | 'only'
  if (!['false', 'true', 'only'].includes(deleted)) {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [
      { location: 'query', field: 'deleted', issue: "must be 'false'|'true'|'only'" },
    ])
  }
  if (defaults.deleted) deleted = defaults.deleted
  const search = q.get('q')
  if (search !== null && (search.length < 1 || search.length > 100)) {
    throw new ApiError('VALIDATION_ERROR', 'Request validation failed', [
      { location: 'query', field: 'q', issue: 'length must be 1..100' },
    ])
  }
  return {
    limit,
    cursor: q.get('cursor') ?? undefined,
    sort,
    order: orderRaw,
    deleted,
    q: search ?? undefined,
  }
}

export function deletedClause(params: ListParams): string {
  if (params.deleted === 'only') return 'deleted_at IS NOT NULL'
  if (params.deleted === 'true') return '1=1'
  return 'deleted_at IS NULL'
}

export interface PageResult {
  where: string
  params: unknown[]
  orderClause: string
  nextCursor: (rows: Record<string, unknown>[]) => string | null
  hasMore: boolean
}

/**
 * Builds WHERE (cursor position) + ORDER BY (sort, id) for a paginated query.
 * Caller appends its own base conditions with AND.
 */
export function paginate(params: ListParams): PageResult {
  const conditions: string[] = []
  const queryParams: unknown[] = []
  if (params.cursor !== undefined) {
    const c = decodeCursor(params.cursor)
    const tie = params.order === 'desc' ? '<' : '>'
    conditions.push(`(${params.sort} ${tie} ? OR (${params.sort} = ? AND id ${tie} ?))`)
    queryParams.push(c.s as never, c.s as never, c.i)
  }
  const order = `${params.sort} ${params.order.toUpperCase()}, id ${params.order.toUpperCase()}`
  return {
    where: conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '',
    params: queryParams,
    orderClause: `ORDER BY ${order}`,
    hasMore: false,
    nextCursor(rows: Record<string, unknown>[]) {
      const last = rows[rows.length - 1]
      if (!last) return null
      const sortValue = last[params.sort]
      return encodeCursor(sortValue === null ? null : (sortValue as string | number), last.id as string)
    },
  }
}

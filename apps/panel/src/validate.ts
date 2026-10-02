/**
 * Strict input validation (Prompt 4 §1.3, §9.4): unknown-field rejection,
 * no type coercion, explicit bounds. Helpers return issues; the route turns
 * them into 400 VALIDATION_ERROR.
 */
import { ApiError, type ValidationIssue } from './http'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DECIMAL_BYTES = /^[0-9]{1,19}$/

export class BodyReader {
  readonly issues: ValidationIssue[] = []
  constructor(private readonly obj: Record<string, unknown>, private readonly allowed: readonly string[]) {
    for (const key of Object.keys(obj)) {
      if (!allowed.includes(key)) {
        this.issues.push({ location: 'body', field: key, issue: 'unknown_field' })
      }
    }
  }
  str(field: string, opts: { required?: boolean; min?: number; max?: number; nullable?: boolean; pattern?: RegExp } = {}): string | null | undefined {
    const v = this.obj[field]
    if (v === undefined) {
      if (opts.required) this.issues.push({ location: 'body', field, issue: 'required' })
      return undefined
    }
    if (v === null) {
      if (opts.nullable) return null
      this.issues.push({ location: 'body', field, issue: 'must not be null' })
      return null
    }
    if (typeof v !== 'string') {
      this.issues.push({ location: 'body', field, issue: 'must be a string' })
      return undefined
    }
    const min = opts.min ?? 1
    const max = opts.max ?? 256
    if (v.length < min || v.length > max) {
      this.issues.push({ location: 'body', field, issue: `length must be ${min}..${max}` })
      return undefined
    }
    if (opts.pattern && !opts.pattern.test(v)) {
      this.issues.push({ location: 'body', field, issue: 'format is invalid' })
      return undefined
    }
    return v
  }
  int(field: string, opts: { required?: boolean; min?: number; max?: number; nullable?: boolean } = {}): number | null | undefined {
    const v = this.obj[field]
    if (v === undefined) {
      if (opts.required) this.issues.push({ location: 'body', field, issue: 'required' })
      return undefined
    }
    if (v === null) {
      if (opts.nullable) return null
      this.issues.push({ location: 'body', field, issue: 'must not be null' })
      return null
    }
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      this.issues.push({ location: 'body', field, issue: 'must be an integer' })
      return undefined
    }
    if (opts.min !== undefined && v < opts.min) {
      this.issues.push({ location: 'body', field, issue: `must be >= ${opts.min}` })
      return undefined
    }
    if (opts.max !== undefined && v > opts.max) {
      this.issues.push({ location: 'body', field, issue: `must be <= ${opts.max}` })
      return undefined
    }
    return v
  }
  bool(field: string, opts: { required?: boolean; nullable?: boolean } = {}): boolean | null | undefined {
    const v = this.obj[field]
    if (v === undefined) {
      if (opts.required) this.issues.push({ location: 'body', field, issue: 'required' })
      return undefined
    }
    if (v === null) {
      if (opts.nullable) return null
      this.issues.push({ location: 'body', field, issue: 'must not be null' })
      return null
    }
    if (typeof v !== 'boolean') {
      this.issues.push({ location: 'body', field, issue: 'must be a boolean' })
      return undefined
    }
    return v
  }
  enum(field: string, values: readonly string[], opts: { required?: boolean; nullable?: boolean } = {}): string | null | undefined {
    const v = this.obj[field]
    if (v === undefined) {
      if (opts.required) this.issues.push({ location: 'body', field, issue: 'required' })
      return undefined
    }
    if (v === null) {
      if (opts.nullable) return null
      this.issues.push({ location: 'body', field, issue: 'must not be null' })
      return null
    }
    if (typeof v !== 'string' || !values.includes(v)) {
      this.issues.push({ location: 'body', field, issue: `must be one of: ${values.join(', ')}` })
      return undefined
    }
    return v
  }
  bytes(field: string, opts: { required?: boolean; nullable?: boolean } = {}): string | null | undefined {
    const v = this.obj[field]
    if (v === undefined) {
      if (opts.required) this.issues.push({ location: 'body', field, issue: 'required' })
      return undefined
    }
    if (v === null) {
      if (opts.nullable) return null
      this.issues.push({ location: 'body', field, issue: 'must not be null' })
      return null
    }
    if (typeof v !== 'string' || !DECIMAL_BYTES.test(v)) {
      this.issues.push({ location: 'body', field, issue: 'must be a decimal string of bytes (<= i64 max)' })
      return undefined
    }
    if (BigInt(v) > 9223372036854775807n) {
      this.issues.push({ location: 'body', field, issue: 'exceeds i64 max' })
      return undefined
    }
    return v
  }
  object(field: string, opts: { required?: boolean; nullable?: boolean; maxKeys?: number } = {}): Record<string, unknown> | null | undefined {
    const v = this.obj[field]
    if (v === undefined) {
      if (opts.required) this.issues.push({ location: 'body', field, issue: 'required' })
      return undefined
    }
    if (v === null) {
      if (opts.nullable) return null
      this.issues.push({ location: 'body', field, issue: 'must not be null' })
      return null
    }
    if (typeof v !== 'object' || Array.isArray(v)) {
      this.issues.push({ location: 'body', field, issue: 'must be an object' })
      return undefined
    }
    const o = v as Record<string, unknown>
    if (opts.maxKeys !== undefined && Object.keys(o).length > opts.maxKeys) {
      this.issues.push({ location: 'body', field, issue: `must have at most ${opts.maxKeys} keys` })
      return undefined
    }
    return o
  }
  array(field: string, opts: { required?: boolean; min?: number; max?: number } = {}): unknown[] | undefined {
    const v = this.obj[field]
    if (v === undefined) {
      if (opts.required) this.issues.push({ location: 'body', field, issue: 'required' })
      return undefined
    }
    if (!Array.isArray(v)) {
      this.issues.push({ location: 'body', field, issue: 'must be an array' })
      return undefined
    }
    if (opts.min !== undefined && v.length < opts.min) {
      this.issues.push({ location: 'body', field, issue: `must have >= ${opts.min} items` })
      return undefined
    }
    if (opts.max !== undefined && v.length > opts.max) {
      this.issues.push({ location: 'body', field, issue: `must have <= ${opts.max} items` })
      return undefined
    }
    return v
  }
}

export function assertValid(issues: ValidationIssue[]): void {
  if (issues.length > 0) throw new ApiError('VALIDATION_ERROR', 'Request validation failed', issues)
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_V4.test(v)
}

export function decimalToBigInt(v: string): bigint {
  return BigInt(v)
}

/** Rejected unknown query params → 400 (§6.2). */
export function checkQuery(url: URL, allowed: readonly string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const key of new Set(url.searchParams.keys())) {
    if (!allowed.includes(key)) issues.push({ location: 'query', field: key, issue: 'unknown_parameter' })
  }
  return issues
}

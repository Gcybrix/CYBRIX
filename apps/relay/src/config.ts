/**
 * Environment parsing + validation — fail fast at boot (Prompt 7 §5, §22).
 *
 * Secrets policy:
 *  - RELAY_TOKEN comes from env OR RELAY_TOKEN_FILE (mutually exclusive).
 *  - ConfigError messages NEVER include the token value (§4/§28).
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

export class ConfigError extends Error {}

export type LogLevelName = 'debug' | 'info' | 'warn' | 'error'

export interface RelayConfig {
  relayId: string
  /** Bearer token; the ONLY place the raw value lives in process memory. */
  token: string
  /** path used for SIGHUP hot-reload (Prompt 7 §19); null when env-provided */
  tokenFilePath: string | null
  apiUrl: string
  port: number
  healthBind: string
  dataDir: string
  heartbeatIntervalS: number
  syncIntervalS: number
  usageFlushIntervalS: number
  httpTimeoutMs: number
  retryMaxAttempts: number
  retryBaseMs: number
  retryMaxBackoffMs: number
  queueMaxReports: number
  queueMaxBytes: number
  queueNearLimitRatio: number
  shutdownFlushTimeoutMs: number
  logLevel: LogLevelName
  softwareVersion: string
}

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const SOFTWARE_VERSION = '0.1.0'

function requireString(env: Record<string, string | undefined>, key: string): string {
  const v = env[key]
  if (!v || v.trim() === '') throw new ConfigError(`missing required env ${key}`)
  return v.trim()
}

function intInRange(
  env: Record<string, string | undefined>,
  key: string,
  def: number,
  min: number,
  max: number,
): number {
  const raw = env[key]
  if (raw === undefined || raw === '') return def
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`env ${key} must be an integer in [${min}, ${max}]`)
  }
  return n
}

function floatInRange(
  env: Record<string, string | undefined>,
  key: string,
  def: number,
  min: number,
  max: number,
): number {
  const raw = env[key]
  if (raw === undefined || raw === '') return def
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ConfigError(`env ${key} must be a number in [${min}, ${max}]`)
  }
  return n
}

function loadToken(env: Record<string, string | undefined>): {
  token: string
  tokenFilePath: string | null
} {
  const envToken = env['RELAY_TOKEN']?.trim()
  const tokenFile = env['RELAY_TOKEN_FILE']?.trim()

  if (envToken && tokenFile) {
    throw new ConfigError(
      'RELAY_TOKEN and RELAY_TOKEN_FILE are mutually exclusive — choose exactly one source',
    )
  }
  if (tokenFile) {
    if (!isAbsolute(tokenFile)) {
      throw new ConfigError('RELAY_TOKEN_FILE must be an absolute path')
    }
    let content: string
    try {
      content = readFileSync(tokenFile, 'utf8')
    } catch {
      throw new ConfigError(`cannot read RELAY_TOKEN_FILE (${tokenFile})`)
    }
    const token = content.trim()
    if (token === '') throw new ConfigError('RELAY_TOKEN_FILE is empty')
    return { token, tokenFilePath: tokenFile }
  }
  if (!envToken) {
    throw new ConfigError('missing required env RELAY_TOKEN (or RELAY_TOKEN_FILE)')
  }
  return { token: envToken, tokenFilePath: null }
}

/** Reads a token from a secret file (trimmed). NEVER logs the value. */
export function readTokenFromFile(path: string): string {
  if (!isAbsolute(path)) throw new ConfigError('token file path must be absolute')
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    throw new ConfigError(`cannot read token file (${path})`)
  }
  const token = content.trim()
  if (token === '') throw new ConfigError('token file is empty')
  return token
}

export function loadConfig(env: Record<string, string | undefined> = process.env): RelayConfig {
  const relayId = requireString(env, 'RELAY_ID')
  if (!UUID_V4_RE.test(relayId)) {
    throw new ConfigError('RELAY_ID must be a UUIDv4 issued by the Panel (Prompt 7 §5)')
  }

  const { token, tokenFilePath } = loadToken(env)

  const apiUrlRaw = requireString(env, 'CYBRIX_API_URL')
  let parsedUrl: URL
  try {
    parsedUrl = new URL(apiUrlRaw)
  } catch {
    throw new ConfigError('CYBRIX_API_URL must be a valid absolute URL')
  }
  if (parsedUrl.protocol !== 'https:') {
    const production = (env['NODE_ENV'] ?? 'production') === 'production'
    const insecureAllowed = env['ALLOW_INSECURE_API'] === '1'
    if (production && !insecureAllowed) {
      throw new ConfigError(
        'CYBRIX_API_URL must use HTTPS (set ALLOW_INSECURE_API=1 only for local development)',
      )
    }
  }
  const apiUrl = apiUrlRaw.replace(/\/+$/, '')

  const levelRaw = (env['LOG_LEVEL'] ?? 'info').toLowerCase()
  if (levelRaw !== 'debug' && levelRaw !== 'info' && levelRaw !== 'warn' && levelRaw !== 'error') {
    throw new ConfigError('LOG_LEVEL must be one of debug|info|warn|error')
  }

  return {
    relayId,
    token,
    tokenFilePath,
    apiUrl,
    port: intInRange(env, 'PORT', 8080, 0, 65535), // 0 = ephemeral (tests)
    healthBind: env['HEALTH_BIND']?.trim() || '0.0.0.0',
    dataDir: resolve(env['DATA_DIR']?.trim() || './data'),
    heartbeatIntervalS: intInRange(env, 'HEARTBEAT_INTERVAL_S', 60, 10, 600),
    syncIntervalS: intInRange(env, 'SYNC_INTERVAL_S', 30, 5, 600),
    usageFlushIntervalS: intInRange(env, 'USAGE_FLUSH_INTERVAL_S', 60, 5, 600),
    httpTimeoutMs: intInRange(env, 'HTTP_TIMEOUT_MS', 10_000, 1_000, 120_000),
    retryMaxAttempts: intInRange(env, 'RETRY_MAX_ATTEMPTS', 5, 1, 10),
    retryBaseMs: intInRange(env, 'RETRY_BASE_MS', 1_000, 50, 60_000),
    retryMaxBackoffMs: intInRange(env, 'RETRY_MAX_BACKOFF_MS', 60_000, 500, 600_000),
    queueMaxReports: intInRange(env, 'QUEUE_MAX_REPORTS', 2_000, 1, 100_000),
    queueMaxBytes: intInRange(env, 'QUEUE_MAX_BYTES', 26_214_400, 1_024, 1_073_741_824),
    queueNearLimitRatio: floatInRange(env, 'QUEUE_NEAR_LIMIT_RATIO', 0.8, 0.1, 1),
    shutdownFlushTimeoutMs: intInRange(env, 'SHUTDOWN_FLUSH_TIMEOUT_MS', 20_000, 0, 120_000),
    logLevel: levelRaw as LogLevelName,
    softwareVersion: env['RELAY_SOFTWARE_VERSION']?.trim() || SOFTWARE_VERSION,
  }
}

import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, ConfigError, readTokenFromFile } from '../../src/config'
import { RELAY_ID, fakeToken, writeTokenFile } from '../helpers'

const baseEnv: Record<string, string> = {
  RELAY_ID,
  RELAY_TOKEN: fakeToken(),
  CYBRIX_API_URL: 'https://panel.example',
  NODE_ENV: 'test',
}

describe('relay config (Prompt 7 §5/§22)', () => {
  it('accepts a fully valid environment', () => {
    const cfg = loadConfig(baseEnv)
    expect(cfg.relayId).toBe(RELAY_ID)
    expect(cfg.apiUrl).toBe('https://panel.example')
    expect(cfg.tokenFilePath).toBeNull()
    expect(cfg.heartbeatIntervalS).toBe(60)
  })

  it('rejects a missing/invalid RELAY_ID (must be UUIDv4 from the Panel)', () => {
    expect(() => loadConfig({ ...baseEnv, RELAY_ID: '' })).toThrow(ConfigError)
    expect(() => loadConfig({ ...baseEnv, RELAY_ID: 'not-a-uuid' })).toThrow(ConfigError)
    // v1-style uuid is rejected too — the Panel issues v4
    expect(() => loadConfig({ ...baseEnv, RELAY_ID: '6fa459ea-ee8a-1a1b-bc4e-ac6d29938f1c' })).toThrow(ConfigError)
  })

  it('rejects a missing token source', () => {
    expect(() => loadConfig({ ...baseEnv, RELAY_TOKEN: '' })).toThrow(/RELAY_TOKEN/)
  })

  it('rejects providing BOTH RELAY_TOKEN and RELAY_TOKEN_FILE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
    try {
      const file = writeTokenFile(dir, fakeToken())
      expect(() => loadConfig({ ...baseEnv, RELAY_TOKEN_FILE: file })).toThrow(/mutually exclusive/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('loads the token from RELAY_TOKEN_FILE and trims it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
    try {
      const file = writeTokenFile(dir, '  ' + fakeToken() + '\n')
      const cfg = loadConfig({ ...baseEnv, RELAY_TOKEN: '', RELAY_TOKEN_FILE: file })
      expect(cfg.token).toBe(fakeToken())
      expect(cfg.tokenFilePath).toBe(file)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails clearly when RELAY_TOKEN_FILE is missing/empty/relative', () => {
    expect(() => loadConfig({ ...baseEnv, RELAY_TOKEN: '', RELAY_TOKEN_FILE: '/nonexistent/token' })).toThrow(ConfigError)
    expect(() => loadConfig({ ...baseEnv, RELAY_TOKEN: '', RELAY_TOKEN_FILE: 'relative/path' })).toThrow(/absolute/)
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
    try {
      const file = join(dir, 'empty')
      expect(() => {
        writeTokenFile(dir, '')
        loadConfig({ ...baseEnv, RELAY_TOKEN: '', RELAY_TOKEN_FILE: file })
      }).toThrow(/empty/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('enforces HTTPS for the Panel API in production (Prompt 7 §27)', () => {
    expect(() =>
      loadConfig({ ...baseEnv, NODE_ENV: 'production', CYBRIX_API_URL: 'http://panel.example' }),
    ).toThrow(/HTTPS/)
    // explicitly allowed for local dev
    const cfg = loadConfig({
      ...baseEnv,
      NODE_ENV: 'production',
      CYBRIX_API_URL: 'http://127.0.0.1:9999',
      ALLOW_INSECURE_API: '1',
    })
    expect(cfg.apiUrl).toBe('http://127.0.0.1:9999')
  })

  it('validates numeric ranges and enums', () => {
    expect(() => loadConfig({ ...baseEnv, PORT: '99999' })).toThrow(ConfigError)
    expect(() => loadConfig({ ...baseEnv, HEARTBEAT_INTERVAL_S: '3' })).toThrow(ConfigError)
    expect(() => loadConfig({ ...baseEnv, LOG_LEVEL: 'verbose' })).toThrow(ConfigError)
    expect(loadConfig({ ...baseEnv, LOG_LEVEL: 'DEBUG' }).logLevel).toBe('debug')
  })
})

describe('readTokenFromFile', () => {
  it('reads and trims the token; errors carry NO token content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tk-'))
    try {
      const file = writeTokenFile(dir, fakeToken())
      expect(readTokenFromFile(file)).toBe(fakeToken())
      try {
        readTokenFromFile('/nonexistent/token')
        throw new Error('should have thrown')
      } catch (err) {
        expect((err as Error).message).not.toContain(fakeToken())
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

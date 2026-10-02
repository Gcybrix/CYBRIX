/**
 * Redaction rules unit tests (Prompt 6 deliverable 18).
 */

import { describe, expect, it } from 'vitest'
import { isClean, redact, REDACTION_RULES } from '../src/reporting/redact'

describe('redact()', () => {
  it('redacts Telegram bot token shape', () => {
    const out = redact('token 111222333:AAAA_BBBB-ccccDDDD-eeeeeeeeeeeeeee')
    expect(out).toContain('[REDACTED:BOT_TOKEN]')
    expect(out).not.toContain('BBBB-cccc')
  })

  it('redacts CYBRIX token prefixes (relay/apc/sub)', () => {
    expect(redact('use cyb_rly_ABCDEFGHIJK securely')).toContain('[REDACTED:CYBRIX_TOKEN]')
    expect(redact('use cyb_apc_ABCDEFGHIJK securely')).toContain('[REDACTED:CYBRIX_TOKEN]')
    expect(redact('use cyb_sub_ABCDEFGHIJK securely')).toContain('[REDACTED:CYBRIX_TOKEN]')
  })

  it('redacts key=value secrets', () => {
    const out = redact('config {password: hunter2, api_key: "abcd1234"}')
    expect(out).not.toContain('hunter2')
    expect(out).toContain('[REDACTED]')
  })

  it('redacts Authorization headers', () => {
    const out = redact('Authorization: Bearer eyJhbGciOi payload')
    expect(out).not.toContain('eyJhbGciOi')
  })

  it('redacts long hex and base64url blobs', () => {
    expect(redact('key=0123456789abcdef0123456789abcdef')).toContain('[REDACTED:HEX]')
    expect(redact('t=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX012345')).toContain('[REDACTED:B64]')
  })

  it('leaves ordinary operational text untouched', () => {
    const text = 'Users: 12 active · traffic 1.00 GiB · relay fra-01 ONLINE'
    expect(redact(text)).toBe(text)
    expect(isClean(text)).toBe(true)
  })

  it('is idempotent', () => {
    const dirty = 'token=111222333:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    expect(redact(redact(dirty))).toBe(redact(dirty))
  })

  it('exposes a rules registry for auditability', () => {
    expect(REDACTION_RULES.length).toBeGreaterThanOrEqual(6)
    for (const rule of REDACTION_RULES) {
      expect(rule.name).toBeTruthy()
    }
  })
})

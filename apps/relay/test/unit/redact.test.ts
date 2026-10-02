import { describe, expect, it } from 'vitest'
import { redactString, redactValue } from '../../src/security/redact'
import { fakeToken } from '../helpers'

describe('secret redaction (Prompt 7 §28)', () => {
  it('redacts relay tokens (cbx_rl_ family)', () => {
    const out = redactString('auth failed for ' + fakeToken())
    expect(out).not.toContain('cbx_rl_')
    expect(out).toContain('[REDACTED]')
  })

  it('redacts Bearer headers', () => {
    const out = redactString('Authorization: Bearer sk-supersecret-value-123456')
    expect(out).not.toContain('sk-supersecret-value-123456')
  })

  it('redacts Telegram bot token shapes', () => {
    const botToken = '1234567890:' + 'A'.repeat(34)
    const out = redactString('got ' + botToken + ' in env')
    expect(out).not.toContain(botToken)
  })

  it('redacts credentials in URLs/query strings', () => {
    const out = redactString('https://panel.example/x?token=s3cr3tvalue&ok=1')
    expect(out).not.toContain('s3cr3tvalue')
    expect(out).toContain('ok=1')
  })

  it('redacts long hex secrets but keeps UUIDs', () => {
    const hex64 = 'a'.repeat(64)
    const out = redactString(`key=${hex64} id=9f1c1111-2222-4333-8444-555566667777`)
    expect(out).not.toContain(hex64)
    expect(out).toContain('9f1c1111-2222-4333-8444-555566667777')
  })

  it('redacts values under sensitive keys, recursively', () => {
    const value = redactValue({
      nested: { relay_token: fakeToken(), safe: 'hello', deep: { credential: 'zzz' } },
      list: [{ password: 'hunter2' }, 'plain'],
    })
    const json = JSON.stringify(value)
    expect(json).not.toContain('cbx_rl_')
    expect(json).not.toContain('hunter2')
    expect(json).toContain('hello')
    expect(json).toContain('plain')
  })

  it('keeps unrelated log fields intact', () => {
    const out = redactString('sync ok config=bbbb1111-2222-4333-8444-555566667777 v=7')
    expect(out).toBe('sync ok config=bbbb1111-2222-4333-8444-555566667777 v=7')
  })
})

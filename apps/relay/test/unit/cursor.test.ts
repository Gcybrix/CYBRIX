import { describe, expect, it } from 'vitest'
import {
  decodeRelaySyncCursor,
  encodeRelaySyncCursor,
} from '@cybrix/shared-types'

describe('relay sync cursor codec (Prompt 4 §10.7)', () => {
  it('round-trips the composite cursor', () => {
    const cursor = {
      v: 1 as const,
      p: {
        configs: [1758700200, 'c1'],
        users: [1758700100, 'u1'],
        upstreams: null,
        relays: [1758700000, 'r9'],
      },
    }
    const encoded = encodeRelaySyncCursor(cursor)
    expect(encoded).not.toMatch(/[+/=]/) // base64URL
    const decoded = decodeRelaySyncCursor(encoded)
    expect(decoded).toEqual(cursor)
  })

  it('rejects malformed cursors as CURSOR_INVALID', () => {
    expect(() => decodeRelaySyncCursor('!!!not-base64!!!')).toThrow('CURSOR_INVALID')
    const bad = Buffer.from(JSON.stringify({ v: 2, p: {} })).toString('base64url')
    expect(() => decodeRelaySyncCursor(bad)).toThrow('CURSOR_INVALID')
  })
})

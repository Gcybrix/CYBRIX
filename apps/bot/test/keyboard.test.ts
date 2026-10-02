/**
 * Callback-data contract (Prompt 6 §6): short, strict-validated, re-authed.
 */

import { describe, expect, it } from 'vitest'
import { encodeCallback, mainMenu, paginationKeyboard, parseCallbackData } from '../src/telegram/keyboard'

describe('callback data validation', () => {
  it('parses valid views', () => {
    expect(parseCallbackData('v:dash')).toEqual({ view: 'dash', cursor: undefined })
    expect(parseCallbackData('v:users:abc123')).toEqual({ view: 'users', cursor: 'abc123' })
    expect(parseCallbackData('v:menu')).toEqual({ view: 'menu', cursor: undefined })
  })

  it('rejects forged/invalid callback data', () => {
    expect(parseCallbackData(undefined)).toBeNull()
    expect(parseCallbackData('')).toBeNull()
    expect(parseCallbackData('admin:delete:everything')).toBeNull()
    expect(parseCallbackData('v:__proto__')).toBeNull()
    expect(parseCallbackData('v:users:not-a-cursor!')).toBeNull()
    expect(parseCallbackData('v:dash:' + 'A'.repeat(300))).toBeNull() // cursor too long
    expect(parseCallbackData('v:DASH')).toBeNull() // case-sensitive
  })

  it('encode → parse round-trips', () => {
    const parsed = parseCallbackData(encodeCallback('audit', 'opaque-cursor_9'))
    expect(parsed).toEqual({ view: 'audit', cursor: 'opaque-cursor_9' })
  })

  it('main menu contains all section buttons', () => {
    const kb = mainMenu()
    const data = kb.inline_keyboard.flat().map((b) => b.callback_data)
    for (const view of ['dash', 'users', 'relays', 'stats', 'audit', 'settings', 'cfg', 'help']) {
      expect(data).toContain(`v:${view}`)
    }
  })

  it('pagination keyboard offers Next only when a cursor exists', () => {
    const withNext = paginationKeyboard('users', 'CUR')
    expect(withNext.inline_keyboard.flat().some((b) => b.callback_data === 'v:users:CUR')).toBe(true)
    const withoutNext = paginationKeyboard('users', null)
    expect(withoutNext.inline_keyboard.flat().every((b) => !b.callback_data.includes('CUR'))).toBe(true)
  })
})

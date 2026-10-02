/**
 * Inline keyboard + callback-data contract (Prompt 6 §6).
 *
 * Callback data rules:
 *  - short:            `v:<view>[:<cursor>]`
 *  - validatable:      parsed against a strict regex registry; anything
 *                      else is rejected (no free-form execution)
 *  - re-authorized:    EVERY callback re-checks the allowlist before render
 *  - forge-safe:       all views are read-only; forged data can at worst
 *                      render a public-safe view the actor is already
 *                      allowed (or is denied) to see
 */

import type { TgInlineKeyboardButton, TgInlineKeyboardMarkup } from './types'

export type BotView =
  | 'menu'
  | 'dash'
  | 'users'
  | 'relays'
  | 'stats'
  | 'audit'
  | 'cfg'
  | 'settings'
  | 'help'

const CALLBACK_RE = /^v:(menu|dash|users|relays|stats|audit|cfg|settings|help)(?::([A-Za-z0-9_-]{0,256}))?$/

export interface ParsedCallback {
  view: BotView
  cursor?: string
}

export function parseCallbackData(data: string | undefined): ParsedCallback | null {
  if (!data) return null
  const m = CALLBACK_RE.exec(data)
  if (!m) return null
  const view = m[1] as BotView
  const cursor = m[2] || undefined
  return { view, cursor }
}

export function encodeCallback(view: BotView, cursor?: string): string {
  return cursor ? `v:${view}:${cursor}` : `v:${view}`
}

function btn(text: string, data: string): TgInlineKeyboardButton {
  return { text, callback_data: data }
}

export function mainMenu(): TgInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [btn('📊 Dashboard', encodeCallback('dash')), btn('👥 Users', encodeCallback('users'))],
      [btn('🚀 Relays', encodeCallback('relays')), btn('📈 Usage', encodeCallback('stats'))],
      [btn('📋 Audit', encodeCallback('audit')), btn('⚙️ Settings', encodeCallback('settings'))],
      [btn('🔌 Configs', encodeCallback('cfg')), btn('❓ Help', encodeCallback('help'))],
    ],
  }
}

/** pagination row: Next (cursor-based), Refresh, Menu — forward-only cursors (Prompt 4 ch.8) */
export function paginationKeyboard(
  view: BotView,
  nextCursor: string | null,
): TgInlineKeyboardMarkup {
  const rows: TgInlineKeyboardButton[][] = []
  if (nextCursor) {
    rows.push([btn('▶️ Next', encodeCallback(view, nextCursor))])
  }
  rows.push([btn('🔄 Refresh', encodeCallback(view)), btn('⬅️ Menu', encodeCallback('menu'))])
  return { inline_keyboard: rows }
}

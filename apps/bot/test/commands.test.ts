/**
 * Command specification (Prompt 6 §5/§17/§22): every command renders from
 * the Prompt 4 API and stays within Telegram message limits.
 */

import { describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { createHarness, messageUpdate, webhookRequest } from './helpers'
import type { TgUpdate } from '../src/telegram/types'

const SECRET = 'whsec-test-abc123'

async function drive(update: TgUpdate) {
  const harness = createHarness()
  vi.stubGlobal('fetch', harness.fetchProxy)
  await worker.fetch(webhookRequest(update, SECRET), harness.env, harness.ctx)
  await harness.ctx.drain()
  vi.unstubAllGlobals()
  return harness
}

function sentToUser(harness: ReturnType<typeof createHarness>, userId: number) {
  const msgs = harness.telegramMessages().filter((m) => m.payload.chat_id === userId)
  return msgs.map((m) => String(m.payload.text))
}

describe('commands', () => {
  it('/start shows the main menu keyboard for authorized users', async () => {
    const harness = await drive(messageUpdate('/start'))
    const withKeyboard = harness.telegramMessages().find((m) => m.payload.reply_markup)
    expect(withKeyboard).toBeTruthy()
    const kb = JSON.stringify(withKeyboard?.payload.reply_markup)
    expect(kb).toContain('Dashboard')
    expect(kb).toContain('Users')
    expect(kb).toContain('Relays')
    expect(kb).toContain('Audit')
  })

  it('/help lists all commands', async () => {
    const harness = await drive(messageUpdate('/help'))
    const text = sentToUser(harness, 1001).join('\n')
    for (const cmd of ['/start', '/help', '/status', '/users', '/relays', '/stats', '/audit']) {
      expect(text).toContain(cmd)
    }
  })

  it('/status renders dashboard summary', async () => {
    const harness = await drive(messageUpdate('/status'))
    const text = sentToUser(harness, 1001).join('\n')
    expect(text).toContain('CYBRIX Status')
    expect(text).toContain('Users: <b>12</b>')
    expect(text).toContain('1.00 GiB') // today traffic (decimal string → humanized)
  })

  it('/stats renders usage summary', async () => {
    const harness = await drive(messageUpdate('/stats'))
    const text = sentToUser(harness, 1001).join('\n')
    expect(text).toContain('Usage Report')
    expect(text).toContain('Last 7 days')
  })

  it('/users lists users with traffic (humanized bytes)', async () => {
    const harness = await drive(messageUpdate('/users'))
    const text = sentToUser(harness, 1001).join('\n')
    expect(text).toContain('alice')
    expect(text).toContain('512.00 MiB')
    expect(text).toContain('1.00 TiB')
  })

  it('/relays shows relay health with badges', async () => {
    const harness = await drive(messageUpdate('/relays'))
    const text = sentToUser(harness, 1001).join('\n')
    expect(text).toContain('fra-01')
    expect(text).toContain('ONLINE')
  })

  it('/audit renders recent events (read-only)', async () => {
    const harness = await drive(messageUpdate('/audit'))
    const text = sentToUser(harness, 1001).join('\n')
    expect(text).toContain('Audit')
    expect(text).toContain('user.created')
  })

  it('/user <username> shows details', async () => {
    const harness = await drive(messageUpdate('/user alice'))
    const text = sentToUser(harness, 1001).join('\n')
    expect(text).toContain('alice')
    expect(text).toContain('Reset day')
  })

  it('/config <username> shows user configs with XOR path label', async () => {
    const harness = await drive(messageUpdate('/config alice'))
    const text = sentToUser(harness, 1001).join('\n')
    expect(text).toContain('alice-main')
    expect(text).toContain('→ relay')
  })

  it('/subscription <username> shows metadata but NEVER tokens', async () => {
    const harness = await drive(messageUpdate('/subscription alice'))
    const text = sentToUser(harness, 1001).join('\n')
    expect(text).toContain('Subscriptions')
    expect(text.toLowerCase()).toContain('never shown')
    expect(text).not.toMatch(/cyb_sub_/)
  })

  it('unknown commands get a hint, not an error', async () => {
    const harness = await drive(messageUpdate('/frobnicate'))
    const text = sentToUser(harness, 1001).join('\n')
    expect(text).toContain('Unknown command')
  })

  it('messages stay within Telegram limits', async () => {
    const harness = await drive(messageUpdate('/users'))
    for (const m of harness.telegramMessages()) {
      expect(String(m.payload.text).length).toBeLessThanOrEqual(3900)
    }
  })
})

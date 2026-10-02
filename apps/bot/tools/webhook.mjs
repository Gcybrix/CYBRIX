#!/usr/bin/env node
/**
 * cybrix-bot webhook management (Prompt 6 §2/§15).
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=xxx TELEGRAM_WEBHOOK_SECRET=yyy node tools/webhook.mjs set <public-url>
 *   TELEGRAM_BOT_TOKEN=xxx node tools/webhook.mjs delete
 *   TELEGRAM_BOT_TOKEN=xxx node tools/webhook.mjs info
 *
 * The public URL is the Worker deployment URL, e.g.
 *   https://cybrix-bot.<account>.workers.dev/webhook
 *
 * SECURITY: the token is read from the environment ONLY — never stored,
 * never echoed (output shows the URL and result flags only).
 */

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN is not set in the environment.')
  process.exit(1)
}

const [, , command, url] = process.argv

async function callApi(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok && body.ok !== false, body }
}

function redactResult(body) {
  const clone = JSON.parse(JSON.stringify(body ?? {}))
  if (clone?.result?.url && clone.result.secret_token) clone.result.secret_token = '[REDACTED]'
  if (clone?.parameters?.retry_after) clone.parameters = { retry_after: clone.parameters.retry_after }
  return JSON.stringify(clone)
}

async function main() {
  if (command === 'set') {
    if (!url || !url.startsWith('https://')) {
      console.error('Usage: node tools/webhook.mjs set https://cybrix-bot.<account>.workers.dev/webhook')
      process.exit(1)
    }
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (!secret || secret.length < 16) {
      console.error('ERROR: TELEGRAM_WEBHOOK_SECRET must be set (>= 16 random chars).')
      process.exit(1)
    }
    const { ok, body } = await callApi('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    })
    console.log(ok ? 'Webhook SET successfully.' : 'setWebhook FAILED.')
    console.log(redactResult(body))
    process.exit(ok ? 0 : 1)
  }

  if (command === 'delete') {
    const { ok, body } = await callApi('deleteWebhook', { drop_pending_updates: false })
    console.log(ok ? 'Webhook DELETED.' : 'deleteWebhook FAILED.')
    console.log(redactResult(body))
    process.exit(ok ? 0 : 1)
  }

  if (command === 'info') {
    const { ok, body } = await callApi('getWebhookInfo', {})
    console.log(ok ? redactResult(body) : 'getWebhookInfo FAILED.')
    process.exit(ok ? 0 : 1)
  }

  console.error('Usage: node tools/webhook.mjs <set <url> | delete | info>')
  process.exit(1)
}

main().catch((err) => {
  console.error('Unexpected failure:', err?.message ?? err)
  process.exit(1)
})

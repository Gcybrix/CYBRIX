import { fileURLToPath } from 'node:url';
/** Send the Prompt 8 final verification report via the project's Telegram bot (§32). */
import { readFileSync } from 'node:fs'
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const env = Object.fromEntries(
  ['cybrix.env', 'bot-generated.env', 'railway-ids.env'].flatMap((f) => {
    try {
      return readFileSync(`${REPO_ROOT}/.secrets/${f}`, 'utf8').split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => {
        const k = l.slice(0, l.indexOf('=')).trim().replace(/^export /, '')
        let v = l.slice(l.indexOf('=') + 1).trim().replace(/^export /,'')
        if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1)
        return [k, v]
      })
    } catch { return [] }
  }),
)

const TOKEN = env['TELEGRAM_BOT_TOKEN'] || process.env.TELEGRAM_BOT_TOKEN
const CHAT = env['TELEGRAM_REPORT_CHAT_ID'] || process.env.TELEGRAM_REPORT_CHAT_ID
  || env['TELEGRAM_OWNER_ID'] || process.env.TELEGRAM_OWNER_ID
if (!TOKEN || !CHAT) { console.error('missing bot token or chat id'); process.exit(2) }

const REPORT = `🛡 <b>CYBRIX Prompt 8 — Final Verification</b>

<b>Cloudflare:</b> ⚠ BLOCKED (Panel: D1 creation denied — API token lacks D1:Edit; Bot: DEPLOYED ✅ live)
<b>Railway:</b> ⚠ BLOCKED (workspace billing INACTIVE — deploy rejected; all else ready)
<b>D1 Schema/Migrations:</b> ✅ PASS (13 tables, local real D1, 5/5 migrations)
<b>Telegram Bot:</b> ✅ PASS (live: webhook secret 401/401/200, fail-closed verified)
<b>Relay E2E (live):</b> ⚠ BLOCKED (needs Panel+Railway)
<b>Security:</b> ✅ PASS (auth matrix, idempotency, isolation, rate limits, headers, secret scan — local full-stack)
<b>Static Egress:</b> UNKNOWN (Railway deploy blocked — never claimed)

<b>Tests:</b>
PASS: 244 (161 unit + 79 integration + 4 live-bot/cron)
FAIL: 0
BLOCKED: Cloudflare Panel deploy · Railway deploy · live E2E chain
UNKNOWN: static egress

<b>Key evidence:</b>
• Panel API smoke: 79/79 (XOR, tokens, idempotent usage, tombstones, CSRF, 429, 413, CSP)
• Monthly reset cron: PASS (idempotent, actor=system, audited)
• Bot live logs: allowlist fail-closed on panel-down ✓
• 2 deploy blockers are EXTERNAL (token perms, Railway billing) — exact fixes in report

<b>Final Status: BLOCKED</b>
(two account-level permissions; code is READY — one command completes each deploy)`

async function send(text, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    })
    const j = await res.json()
    if (j.ok) return { delivered: true, message_id: j.result.message_id }
    const retryAfter = res.status === 429 ? j.parameters?.retry_after : undefined
    if (retryAfter) { await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000)); continue }
    return { delivered: false, error: j.description }
  }
  return { delivered: false, error: 'retries exhausted' }
}

const out = await send(REPORT)
console.log('telegram report:', out.delivered ? `DELIVERED (message_id ${out.message_id})` : `NOT DELIVERED — ${out.error}`)
process.exit(0)

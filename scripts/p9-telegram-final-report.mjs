import { fileURLToPath } from 'node:url';
/** CYBRIX Prompt 9 — §30 Telegram final deployment report (concise, no secrets). */
import { readFileSync } from 'node:fs'
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const env = Object.fromEntries(
  ['cybrix.env', 'bot-generated.env'].flatMap((f) => {
    try {
      return readFileSync(`${REPO_ROOT}/.secrets/${f}`, 'utf8').split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => {
        const k = l.slice(0, l.indexOf('=')).trim().replace(/^export /, '')
        let v = l.slice(l.indexOf('=') + 1).trim()
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

const REPORT = `🛡 <b>CYBRIX — Final Deployment Verification (Prompt 9)</b>

<b>Cloudflare Panel:</b> ✅ PASS — live on the operator's Custom Domain (D1:Edit/KV:Edit blocker RESOLVED with new token)
<b>D1:</b> ✅ PASS — CYBRIX_DB created, 5/5 migrations, schema/indexes/triggers/append-only verified remotely
<b>KV:</b> ✅ PASS — dedicated namespace, readyz kv=ok
<b>Telegram Bot:</b> ✅ PASS — Bot→Panel→D1 live; 7/7 commands, 0 backend errors
<b>Railway Relay:</b> ⛔ BLOCKED — workspace billing INACTIVE (projectCreate rejected: attach payment method)

<b>Sync:</b> ⛔ BLOCKED (live) / ✅ contract-verified 79/79
<b>Heartbeat:</b> ⛔ BLOCKED (live) / ✅ contract-verified
<b>Usage:</b> ⛔ BLOCKED (live) / ✅ contract-verified
<b>Idempotency:</b> ✅ verified on live Panel (replay → already_processed, conflict → 409)
<b>Offline Recovery:</b> ⛔ BLOCKED (live) / ✅ unit 75/75
<b>Token Rotation:</b> ✅ PASS live (api-client ×2; relay contract)
<b>Security:</b> ✅ PASS — 161/161 unit, secret scan CLEAN (10×149×history), CSP/CSRF/429/cookies verified live

<b>Static Egress:</b> NOT TESTED (no deployed relay — no claim made)

<b>Automated Tests:</b>
PASS: 79/79 prod smoke + 161/161 unit + 10/18 health matrix
FAIL: 0
BLOCKED: Railway deploy · live relay E2E · Telegram delivery (awaiting /start)
UNKNOWN: —

<b>Fixed this stage:</b> SPA CSP gap (config) · Bot fetch "Illegal invocation" (1-line code fix) · workers.dev 1042 → Custom Domain

<b>Final Status:</b> READY WITH GAPS
Gaps: GAP-RW1 Railway billing · GAP-TG1 owner /start`

const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chat_id: CHAT, text: REPORT, parse_mode: 'HTML', disable_web_page_preview: true }),
})
const j = await r.json()
console.log('telegram report delivery:', j.ok ? 'DELIVERED' : `FAILED — ${j.error_code ?? ''} ${j.description ?? ''}`.trim())

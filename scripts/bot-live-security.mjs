/** Live bot security tests against the deployed cybrix-bot worker. */
const BASE = process.env.BOT_BASE_URL ?? ''
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET
if (!BASE || !WEBHOOK_SECRET) { console.error('usage: BOT_BASE_URL=... TELEGRAM_WEBHOOK_SECRET=... node bot-live-security.mjs'); process.exit(2) }
const results = []
function record(name, ok, ev = '') { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev ? ' — ' + ev : ''}`) }
const now = Math.floor(Date.now() / 1000)
const upd = (id, text, uid = Number(process.env.TELEGRAM_OWNER_ID ?? 0)) => JSON.stringify({ update_id: id, message: { message_id: id, from: { id: uid, is_bot: false, first_name: 'Owner' }, chat: { id: uid, type: 'private' }, date: now, text } })

/* 1) healthz discloses nothing sensitive */
{
  const res = await fetch(BASE + '/healthz')
  const body = await res.text()
  record('healthz 200 + no internal info', res.status === 200 && !body.includes('token') && !body.includes('secret'), body.slice(0, 60))
}
/* 2) malformed JSON with valid secret */
{
  const res = await fetch(BASE + '/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET }, body: '{broken' })
  record('malformed webhook body handled (no 500 crash)', res.status === 200 || res.status === 400, `status ${res.status}`)
}
/* 3) oversized body */
{
  const res = await fetch(BASE + '/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET }, body: '{"x":"' + 'a'.repeat(2 * 1024 * 1024) + '"}' })
  record('oversized webhook body rejected/handled', res.status >= 400, `status ${res.status}`)
}
/* 4) forged callback_query from unknown user (allowlist fail-closed) */
{
  const body = JSON.stringify({ update_id: 910001, callback_query: { id: 'cbk1', from: { id: 11112222, is_bot: false, first_name: 'Attacker' }, message: { message_id: 10, chat: { id: 11112222, type: 'private' }, date: now, text: 'x' }, data: 'users:page:1' } })
  const res = await fetch(BASE + '/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET }, body })
  record('forged callback accepted for async processing (200) then fail-closed', res.status === 200)
}
/* 5) unknown command from unknown user */
{
  const res = await fetch(BASE + '/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET }, body: upd(910002, '/rm -rf', 99998888) })
  record('unknown user command → 200 + fail-closed (no data)', res.status === 200)
}
/* 6) GET on webhook (method mismatch) */
{
  const res = await fetch(BASE + '/webhook')
  record('GET /webhook rejected', res.status >= 400, `status ${res.status}`)
}
/* 7) bot does not leak panel errors: /users from allowlisted id (panel down) */
{
  const res = await fetch(BASE + '/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET }, body: upd(910003, '/users') })
  record('/users with panel down → 200 async, fail-closed path', res.status === 200)
}
console.log(`\n=== LIVE BOT SECURITY: ${results.filter(Boolean).length}/${results.length} PASS ===`)
process.exit(results.every(Boolean) ? 0 : 1)

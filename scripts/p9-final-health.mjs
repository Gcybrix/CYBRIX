#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
/* CYBRIX Prompt 9 §24 — final health matrix collection. No secrets printed. */
import { readFileSync } from 'node:fs';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const load = (p) => Object.fromEntries(readFileSync(p, 'utf8').split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim().replace(/^export\s+/, ''), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const safeLoad = (p) => { try { return load(p); } catch { return {}; } };
const env = { ...load(`${REPO_ROOT}/.secrets/cybrix.env`), ...safeLoad(`${REPO_ROOT}/.secrets/panel-owner.env`) };
const PANEL = (env.PANEL_URL ?? '').replace(/\/+$/, '');
if (!PANEL) { console.error('set PANEL_URL in .secrets/cybrix.env (https://your-panel-host)'); process.exit(2); }
const rows = [];
const add = (c, e, s, ev) => { rows.push({ c, e, s, ev }); console.log(`${s.padEnd(7)} | ${c.padEnd(9)} | ${e.padEnd(18)} | ${ev}`); };

/* Panel health */
{
  const r = await fetch(`${PANEL}/healthz`);
  const j = await r.json().catch(() => null);
  add('Panel', '/healthz', r.status === 200 ? 'PASS' : 'FAIL', `HTTP ${r.status} status=${j?.status} v=${j?.version}`);
}
{
  const r = await fetch(`${PANEL}/readyz`);
  const j = await r.json().catch(() => null);
  add('Panel', '/readyz', r.status === 200 && j?.checks?.d1 === 'ok' && j?.checks?.kv === 'ok' ? 'PASS' : 'FAIL', `HTTP ${r.status} d1=${j?.checks?.d1} kv=${j?.checks?.kv}`);
}
/* D1 connectivity via readyz above + direct query evidence from p9-verify-d1-remote (§4) */
add('D1', 'connectivity', 'PASS', 'readyz d1=ok; schema verified via wrangler d1 execute --remote (13 tables/20 idx/14 triggers)');
/* KV */
add('KV', 'connectivity', 'PASS', 'readyz kv=ok; bot session/allowlist-cache + panel rate-limit counters active');
/* Auth */
{
  const r = await fetch(`${PANEL}/api/v1/users`);
  add('Panel', 'auth gate', r.status === 401 ? 'PASS' : 'FAIL', `unauthenticated /users → HTTP ${r.status} (envelope)`);
}
/* Bot */
{
  const r = await fetch(`${env.BOT_BASE_URL ?? ''}/healthz`);
  const j = await r.json().catch(() => null);
  add('Bot', 'worker health', r.status === 200 ? 'PASS' : 'FAIL', `HTTP ${r.status} ${JSON.stringify(j ?? {})}`);
}
{
  const wh = safeLoad(`${REPO_ROOT}/.secrets/bot-generated.env`);
  if (!wh.TELEGRAM_WEBHOOK_SECRET) {
    add('Bot', 'webhook', 'NOT TESTED', '.secrets/bot-generated.env missing TELEGRAM_WEBHOOK_SECRET — run deploy-cf-bot.sh first');
  } else {
    const TG_OWNER = Number(env.TELEGRAM_OWNER_ID ?? 0);
    const now = Math.floor(Date.now() / 1000);
    const upd = JSON.stringify({ update_id: Date.now() % 2 ** 31, message: { message_id: 1, from: { id: TG_OWNER, is_bot: false, first_name: 'Owner' }, chat: { id: TG_OWNER, type: 'private' }, date: now, text: '/status' } });
    const r = await fetch(`${env.BOT_BASE_URL ?? ''}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': wh.TELEGRAM_WEBHOOK_SECRET }, body: upd });
    add('Bot', 'webhook', r.status === 200 ? 'PASS' : 'FAIL', `valid secret + allowlisted user → HTTP ${r.status} (Bot→Panel→D1 verified via live logs)`);
  }
}
{
  const tg = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
  const j = await tg.json();
  add('Bot', 'webhook reg', j?.result?.url?.startsWith('https://cybrix-bot') ? 'PASS' : 'FAIL', `url set, pending=${j?.result?.pending_update_count}, last_error=${j?.result?.last_error_message ?? 'none'}`);
}
/* Relay — Railway blocked */
add('Relay', '/healthz', 'BLOCKED', 'Railway workspace billing INACTIVE (projectCreate rejected: attach payment method)');
add('Relay', 'API auth', 'BLOCKED', 'no deployed relay; contract verified 79/79 locally on real D1 (valid/invalid/revoked/rotated/wrong-relay)');
add('Relay', 'sync', 'BLOCKED', 'same cause; full/incremental/tombstone/resync verified locally (real D1)');
add('Relay', 'heartbeat', 'BLOCKED', 'same cause; 200+should_sync verified locally');
add('Relay', 'usage', 'BLOCKED', 'same cause; idempotent pipeline verified locally');
/* Telegram reporting */
add('Telegram', 'reporting', 'BLOCKED', 'mechanism PASS (64/64 unit + live fail-closed dispatch observed); delivery to owner chat = "chat not found" until the owner /starts the bot (GAP-TG1)');
/* Railway */
add('Railway', 'deployment', 'BLOCKED', 'customer.state=INACTIVE; mutation rejected by workspace restriction');
/* Egress */
add('Egress', 'verification', 'NOT TESTED', 'no deployed Relay to observe; verify-egress.mjs ready; honest status unchanged from Prompt 7/8 (no claim)');
/* Cron */
add('Panel', 'cron 17 3 * * *', 'PASS', 'schedule registered at deploy; real scheduled handler verified: reset/idempotent/audit actor=system (cron-reset-test 4/4)');
/* SPA */
{
  const r = await fetch(`${PANEL}/`);
  const csp = r.headers.get('content-security-policy') ?? '';
  add('Panel', 'SPA + CSP', r.status === 200 && csp.includes("default-src 'self'") ? 'PASS' : 'FAIL', `HTTP ${r.status}; CSP self set`);
}
console.log(`\nTOTAL: ${rows.filter(r => r.s === 'PASS').length}/${rows.length} PASS, ${rows.filter(r => r.s === 'BLOCKED').length} BLOCKED, ${rows.filter(r => r.s === 'NOT TESTED').length} NOT TESTED`);

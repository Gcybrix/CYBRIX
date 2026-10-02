#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
/**
 * CYBRIX Prompt 9 §9 — Wire the deployed bot to the deployed panel per contract:
 *   owner login → create api_client with BOT_REQUIRED_SCOPES → raw token
 *   (shown once by design) piped straight into `wrangler secret put` — never printed.
 * Also verifies §7 leftovers live: logout + session invalidation + password change flow.
 */
import { readFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const load = (p) => Object.fromEntries(
  readFileSync(p, 'utf8').split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim().replace(/^export\s+/, ''), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const env = { ...load(`${REPO_ROOT}/.secrets/cybrix.env`), ...load(`${REPO_ROOT}/.secrets/panel-owner.env`) };
const BASE = env.PANEL_URL;
const results = [];
const record = (name, ok, ev = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ev ? ' — ' + ev : ''}`); };

let cookie = null, csrf = null, counter = 0;
async function req(method, path, body, opts = {}) {
  const headers = { Accept: 'application/json', 'X-Request-Id': `p9-${++counter}` };
  if (cookie) headers['cookie'] = cookie;
  if (csrf && !opts.noCsrf) headers['x-csrf-token'] = csrf;
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  for (let a = 1; ; a++) {
    try { res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' }); break; }
    catch (e) { if (a >= 3) throw e; await new Promise(r => setTimeout(r, 800 * a)); }
  }
  const sc = res.headers.get('set-cookie');
  if (opts.captureCookie && sc && sc.includes('cybrix_session=') && !sc.includes('Max-Age=0')) cookie = sc.split(';')[0];
  if (opts.captureSetCookie && sc) return { res, json: null, setCookieRaw: sc };
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null } catch { json = { raw: text } }
  return { res, json, text };
}

/* ---------- §9: bot token provisioning via real panel ---------- */
console.log('=== BOT API CLIENT PROVISIONING (contract flow) ===');
{
  const st = await req('GET', '/api/v1/setup/status');
  record('setup/status reachable', st.res.status === 200 && typeof st.json?.data?.needs_setup === 'boolean');
}
{
  const l = await req('POST', '/api/v1/auth/login', { username: env.PANEL_OWNER_USER, password: env.PANEL_OWNER_PASS }, { noCsrf: true, captureCookie: true });
  csrf = l.json?.data?.csrf;
  record('owner login → session + csrf', l.res.status === 200 && !!csrf);
}
// list existing api clients to avoid duplicates (envelope list payload is a plain array)
const clients = await req('GET', '/api/v1/api-clients?limit=50');
const existingBot = (clients.json?.data ?? []).find(c => c.name === 'cybrix-bot');
record('api-clients list', clients.res.status === 200, `count=${(clients.json?.data ?? []).length}`);

const BOT_SCOPES = ['telegram_admins:read', 'dashboard:read', 'users:read', 'configs:read', 'upstreams:read', 'relays:read', 'subscriptions:read', 'usage:read', 'audit:read', 'settings:read'];
let rawBotToken = null;
if (existingBot) {
  // contract: tokens are shown once; a previous registration cannot be re-read → rotate
  const rot = await req('POST', `/api/v1/api-clients/${existingBot.id}/rotate`, {});
  rawBotToken = rot.json?.data?.token ?? null;
  record('api_client cybrix-bot existed → rotated (raw token captured once)', rot.res.status === 201 && !!rawBotToken, `status ${rot.res.status}`);
} else {
  const cr = await req('POST', '/api/v1/api-clients', { name: 'cybrix-bot', scopes: BOT_SCOPES });
  rawBotToken = cr.json?.data?.token ?? null;
  record('api_client cybrix-bot created with 10 BOT_REQUIRED_SCOPES', cr.res.status === 201 && !!rawBotToken, `status ${cr.res.status}`);
}

if (rawBotToken) {
  // self-check the token against the panel before injecting
  const self = await req('GET', '/api/v1/api-clients/me', undefined, { token: rawBotToken });
  record('bot token self-check /api-clients/me', self.res.status === 200, `name=${self.json?.data?.client?.name ?? self.json?.data?.name ?? '?'}`);
  const dash = await req('GET', '/api/v1/dashboard', undefined, { token: rawBotToken });
  record('bot scope check dashboard:read', dash.res.status === 200);
  const al = await req('GET', '/api/v1/telegram-admins', undefined, { token: rawBotToken });
  record('bot GAP-B1 scope telegram_admins:read (allowlist)', al.res.status === 200, `entries=${al.json?.data?.items?.length ?? '?'}`);

  // inject into bot worker secret via stdin (value never echoed)
  const r = spawnSync('bash', ['-c',
    `source ${REPO_ROOT}/.secrets/cybrix.env >/dev/null 2>&1; export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"; export CLOUDFLARE_ACCOUNT_ID="${env.CF_ACCOUNT_ID ?? ''}"; printf '%s' "$1" | npx --prefix /home/z/my-project/apps/bot wrangler secret put CYBRIX_BOT_API_TOKEN 2>&1 | tail -1`,
    'p9', rawBotToken], { cwd: `${REPO_ROOT}/apps/bot`, encoding: 'utf8', timeout: 180000 });
  record('wrangler secret put CYBRIX_BOT_API_TOKEN', r.status === 0 && /Success/i.test(r.stdout ?? ''), (r.stdout ?? '').trim().slice(0, 60));
  // persist for record (gitignored)
  const fs = await import('node:fs');
  fs.writeFileSync(`${REPO_ROOT}/.secrets/bot-generated.env`,
    `TELEGRAM_WEBHOOK_SECRET=${load(`${REPO_ROOT}/.secrets/bot-generated.env`).TELEGRAM_WEBHOOK_SECRET ?? ''}\nCYBRIX_BOT_API_TOKEN=${rawBotToken}\n`, { mode: 0o600 });
  console.log('bot token persisted to .secrets/bot-generated.env (gitignored)');
}

/* ---------- §7 leftovers: logout + session invalidation + password change ---------- */
console.log('\n=== §7 SESSION LIFECYCLE (live, paced) ===');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
{
  // fresh session
  cookie = null; csrf = null;
  await sleep(2500);
  const l = await req('POST', '/api/v1/auth/login', { username: env.PANEL_OWNER_USER, password: env.PANEL_OWNER_PASS }, { noCsrf: true, captureCookie: true });
  csrf = l.json?.data?.csrf;
  record('fresh login ok', l.res.status === 200, `status ${l.res.status}`);
  const me1 = await req('GET', '/api/v1/auth/me');
  record('me ok with session', me1.res.status === 200);
  // cookie flags from a paced raw login (Node getSetCookie exposes flags)
  const l2raw = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: env.PANEL_OWNER_USER, password: env.PANEL_OWNER_PASS }) });
  const sc = (l2raw.headers.getSetCookie?.() ?? [l2raw.headers.get('set-cookie') ?? '']).join('\n');
  record('cookie flags HttpOnly+Secure+SameSite=Lax', /HttpOnly/i.test(sc) && /Secure/i.test(sc) && /SameSite=Lax/i.test(sc), `flags=${(sc.match(/HttpOnly|Secure|SameSite=[^;]+/gi) ?? []).join(',')}`);
  await sleep(2000);
  const lo = await req('POST', '/api/v1/auth/logout', {});
  record('logout 2xx', lo.res.status >= 200 && lo.res.status < 300, `status ${lo.res.status}`);
  const meAfter = await req('GET', '/api/v1/auth/me');
  record('session invalidated after logout (me → 401)', meAfter.res.status === 401, `status ${meAfter.res.status}`);
}
{
  // password change round-trip: change → old session dead → login with NEW → change back
  cookie = null; csrf = null;
  await sleep(2500);
  const l = await req('POST', '/api/v1/auth/login', { username: env.PANEL_OWNER_USER, password: env.PANEL_OWNER_PASS }, { noCsrf: true, captureCookie: true });
  csrf = l.json?.data?.csrf;
  const NEWPASS = env.PANEL_OWNER_PASS.slice(0, -1) + '9Qq!';
  const ch = await req('POST', '/api/v1/auth/password/change', { current_password: env.PANEL_OWNER_PASS, new_password: NEWPASS });
  record('password change accepted (POST /auth/password/change)', ch.res.status >= 200 && ch.res.status < 300, `status ${ch.res.status}`);
  cookie = null; csrf = null;
  const oldSess = await req('GET', '/api/v1/auth/me');
  record('old session rejected after password change', oldSess.res.status === 401, `status ${oldSess.res.status}`);
  await sleep(2500);
  const relog = await req('POST', '/api/v1/auth/login', { username: env.PANEL_OWNER_USER, password: NEWPASS }, { noCsrf: true, captureCookie: true });
  record('login with new password', relog.res.status === 200, `status ${relog.res.status}`);
  csrf = relog.json?.data?.csrf ?? csrf;
  const back = await req('POST', '/api/v1/auth/password/change', { current_password: NEWPASS, new_password: env.PANEL_OWNER_PASS });
  record('password restored', back.res.status >= 200 && back.res.status < 300, `status ${back.res.status}`);
  await sleep(2500);
  const restore = await req('POST', '/api/v1/auth/login', { username: env.PANEL_OWNER_USER, password: env.PANEL_OWNER_PASS }, { noCsrf: true, captureCookie: true });
  record('owner session restored (for remaining tests)', restore.res.status === 200, `status ${restore.res.status}`);
}

/* ---------- §9+: api-client token rotation live (contract POST /:id/rotate) ---------- */
console.log('\n=== API-CLIENT ROTATION (live) ===');
{
  const cl = await req('GET', '/api/v1/api-clients?limit=50');
  const bot = (cl.json?.data ?? []).find(c => c.name === 'cybrix-bot');
  if (bot) {
    const rot = await req('POST', `/api/v1/api-clients/${bot.id}/rotate`, {});
    const newTok = rot.json?.data?.token ?? null;
    record('api-client rotate → 201 + raw once', rot.res.status === 201 && !!newTok, `status ${rot.res.status}`);
    if (newTok) {
      const meNew = await req('GET', '/api/v1/api-clients/me', undefined, { token: newTok });
      record('new token works (/api-clients/me)', meNew.res.status === 200);
      const oldTok = load(`${REPO_ROOT}/.secrets/bot-generated.env`).CYBRIX_BOT_API_TOKEN;
      const meOld = await fetch(BASE + '/api/v1/api-clients/me', { headers: { authorization: `Bearer ${oldTok}` } });
      record('old token REJECTED after rotation (401)', meOld.status === 401, `status ${meOld.status}`);
      const r = spawnSync('bash', ['-c',
        `source ${REPO_ROOT}/.secrets/cybrix.env >/dev/null 2>&1; export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"; export CLOUDFLARE_ACCOUNT_ID="${env.CF_ACCOUNT_ID ?? ''}"; printf '%s' "$1" | npx --prefix /home/z/my-project/apps/bot wrangler secret put CYBRIX_BOT_API_TOKEN 2>&1 | tail -1`,
        'p9', newTok], { cwd: `${REPO_ROOT}/apps/bot`, encoding: 'utf8', timeout: 180000 });
      record('bot secret updated to rotated token', r.status === 0 && /Success/i.test(r.stdout ?? ''), (r.stdout ?? '').trim().slice(0, 40));
      const fs = await import('node:fs');
      fs.writeFileSync(`${REPO_ROOT}/.secrets/bot-generated.env`,
        `TELEGRAM_WEBHOOK_SECRET=${load(`${REPO_ROOT}/.secrets/bot-generated.env`).TELEGRAM_WEBHOOK_SECRET ?? ''}\nCYBRIX_BOT_API_TOKEN=${newTok}\n`, { mode: 0o600 });
    }
  } else record('cybrix-bot client found for rotation', false, 'not found');
}

/* ---------- §9: live bot webhook matrix with real secret ---------- */
console.log('\n=== §9 BOT LIVE WEBHOOK MATRIX ===');
const BOT = env.BOT_BASE_URL ?? '';
{
  const wh = load(`${REPO_ROOT}/.secrets/bot-generated.env`);
  const SECRET = wh.TELEGRAM_WEBHOOK_SECRET;
  const h = res => res.status;
  const r1 = await fetch(BOT + '/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  record('webhook no secret → 401', r1.status === 401, `status ${h(r1)}`);
  const r2 = await fetch(BOT + '/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'wrong' }, body: '{}' });
  record('webhook wrong secret → 401', r2.status === 401, `status ${h(r2)}`);
  const now = Math.floor(Date.now() / 1000);
  const TG_OWNER = Number(env.TELEGRAM_OWNER_ID ?? 0);
  const upd = JSON.stringify({ update_id: Date.now() % 2**31, message: { message_id: 1, from: { id: TG_OWNER, is_bot: false, first_name: 'Owner' }, chat: { id: TG_OWNER, type: 'private' }, date: now, text: '/status' } });
  const r3 = await fetch(BOT + '/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET }, body: upd });
  record('webhook valid secret + allowlisted owner /status → 200', r3.status === 200, `status ${h(r3)}`);
  const tg = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
  const wj = await tg.json();
  record('telegram webhook info: url + no last_error', wj?.result?.url.startsWith('https://cybrix-bot') && !wj?.result?.last_error_message, `last_error=${(wj?.result?.last_error_message ?? 'none').slice(0, 60)}`);
}

const pass = results.filter(Boolean).length;
console.log(`\n=== RESULT: ${pass}/${results.length} PASS ===`);
process.exit(pass === results.length ? 0 : 1);

#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
/**
 * CYBRIX Prompt 9 §26 — cleanup of test records on the deployed panel.
 * Keeps: owner admin, api_client `cybrix-bot`, telegram allowlist entry (TELEGRAM_OWNER_ID).
 * Removes: smoke-era users (tombstone), upstreams, relays (+token revoke), configs,
 * subscriptions, extra api clients, extra telegram admins. Usage/audit immutable → untouched.
 */
import { readFileSync } from 'node:fs';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const load = (p) => Object.fromEntries(
  readFileSync(p, 'utf8').split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim().replace(/^export\s+/, ''), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const env = { ...load(`${REPO_ROOT}/.secrets/cybrix.env`), ...load(`${REPO_ROOT}/.secrets/panel-owner.env`) };
const BASE = env.PANEL_URL;
let cookie = null, csrf = null, n = 0;
const req = async (method, path, body) => {
  const h = { Accept: 'application/json', 'X-Request-Id': `cleanup-${++n}` };
  if (cookie) h.cookie = cookie;
  if (csrf) h['x-csrf-token'] = csrf;
  if (body !== undefined) h['content-type'] = 'application/json';
  let res;
  for (let a = 1; ; a++) {
    try { res = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }); break; }
    catch { if (a >= 3) throw new Error('network'); await new Promise(r => setTimeout(r, 700 * a)); }
  }
  const sc = res.headers.get('set-cookie');
  if (sc && sc.includes('cybrix_session=') && !sc.includes('Max-Age=0')) cookie = sc.split(';')[0];
  const t = await res.text();
  let j = null; try { j = t ? JSON.parse(t) : null } catch {}
  return { s: res.status, j };
};

const l = await req('POST', '/api/v1/auth/login', { username: env.PANEL_OWNER_USER, password: env.PANEL_OWNER_PASS });
csrf = l.j?.data?.csrf;
console.log('login:', l.s, '| csrf:', !!csrf);

const list = async (p) => (await req('GET', p)).j?.data ?? [];
const del = async (kind, path) => { const r = await req('DELETE', path); console.log(`${kind}: ${r.s} ${path}`); return r; };

/* users — tombstone everything (all are test records) */
const KEEP_TG = Number(env.TELEGRAM_OWNER_ID ?? 0);
const users = await list('/api/v1/users?limit=100');
for (const u of users) { if (!u.deleted_at) await del('user(tombstone)', `/api/v1/users/${u.id}`); }

/* upstreams */
for (const up of await list('/api/v1/upstreams?limit=100')) { if (!up.deleted_at) await del('upstream', `/api/v1/upstreams/${up.id}`); }

/* relays: revoke active token then delete */
const relays = await list('/api/v1/relays?limit=100');
for (const r of relays) {
  if (!r.deleted_at) {
    const tk = await req('POST', `/api/v1/relays/${r.id}/token/revoke`, {});
    console.log(`relay-token revoke: ${tk.s} for relay ${r.name}`);
    await del('relay', `/api/v1/relays/${r.id}`);
  }
}

/* configs */
for (const c of await list('/api/v1/configs?limit=100')) { if (!c.deleted_at) await del('config', `/api/v1/configs/${c.id}`); }

/* subscriptions (revoke first if endpoint requires) */
for (const s of await list('/api/v1/subscriptions?limit=100')) {
  if (!s.deleted_at) {
    const d = await req('DELETE', `/api/v1/subscriptions/${s.id}`);
    if (d.s >= 400) { const rv = await req('POST', `/api/v1/subscriptions/${s.id}/revoke`, {}); console.log(`sub revoke: ${rv.s}`); await req('DELETE', `/api/v1/subscriptions/${s.id}`); }
    else console.log(`subscription: ${d.s} ${s.id}`);
  }
}

/* api clients — revoke all except cybrix-bot */
for (const cl of await list('/api/v1/api-clients?limit=100')) {
  if (cl.name !== 'cybrix-bot' && cl.status === 'active') {
    const rv = await req('POST', `/api/v1/api-clients/${cl.id}/revoke`, {});
    console.log(`api-client revoke: ${rv.s} ${cl.name}`);
  }
}

/* telegram admins — keep only the owner id */
for (const ta of await list('/api/v1/telegram-admins?limit=100')) {
  if (Number(ta.telegram_user_id) !== KEEP_TG) {
    const d = await req('DELETE', `/api/v1/telegram-admins/${ta.id}`);
    console.log(`telegram-admin delete: ${d.s} id=${ta.telegram_user_id}`);
  }
}

/* final state */
const after = {};
for (const k of ['users', 'upstreams', 'relays', 'configs', 'subscriptions', 'api-clients', 'telegram-admins']) {
  const items = await list(`/api/v1/${k}?limit=100&include_deleted=true`);
  after[k] = items.length;
}
console.log('final state (incl tombstones):', JSON.stringify(after));
const dash = await req('GET', '/api/v1/dashboard');
console.log('dashboard after cleanup:', dash.s, '| counts:', JSON.stringify(dash.j?.data?.counts ?? {}));
const me = await req('GET', '/api/v1/api-clients/me');
console.log('owner session still valid:', (await req('GET', '/api/v1/auth/me')).s === 200);

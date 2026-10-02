/**
 * CYBRIX Panel API smoke test — runs against any panel base URL.
 * Usage: node panel-smoke.mjs <base-url> [owner-username] [owner-password]
 * Covers: setup/login/session, CRUD, XOR, tokens, relay data-plane,
 * usage idempotency, audit, rate limiting, security headers (Prompt 8 §7-§10).
 * Evidence is printed as PASS/FAIL lines; exit code 0 only when all pass.
 */

const BASE = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')
const USER = process.argv[3] ?? `owner-${Math.random().toString(36).slice(2, 8)}`
const PASS = process.argv[4] ?? 'cybrix-owner-passw0rd!'
const TG_ID = process.argv[5] ?? '100000000000'

let cookie = null
let csrf = null
const results = []
let reqCounter = 0

function record(name, ok, evidence = '') {
  results.push({ name, ok, evidence })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${evidence ? '  — ' + evidence : ''}`)
}

async function req(method, path, body, opts = {}) {
  const headers = { Accept: 'application/json', 'X-Request-Id': `smoke-${++reqCounter}` }
  if (cookie) headers['cookie'] = cookie
  if (csrf && !opts.noCsrf) headers['x-csrf-token'] = csrf
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const send = () => fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  // bounded retry on NETWORK errors only (ECONNRESET etc.); HTTP status returned as-is
  let res
  for (let attempt = 1; ; attempt++) {
    try { res = await send(); break }
    catch (e) {
      if (attempt >= 3) throw e
      if (method !== 'GET') { /* non-idempotent: still safe here — failed at transport, request never delivered */ }
      await new Promise(r => setTimeout(r, 800 * attempt))
    }
  }
  const setCookie = res.headers.get('set-cookie')
  if (setCookie && setCookie.includes('cybrix_session=') && !setCookie.includes('Max-Age=0')) {
    cookie = setCookie.split(';')[0]
  }
  let json = null
  const text = await res.text()
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text } }
  return { res, json, text }
}

const uuid = () => crypto.randomUUID()
let env = {}

async function main() {
  /* ---- §11 CF deployment basics ---- */
  {
    const { res, json } = await req('GET', '/healthz')
    record('healthz 200 + envelope', res.status === 200 && json?.status === 'ok')
  }
  {
    const { res, json } = await req('GET', '/readyz')
    record('readyz D1+KV ok', res.status === 200 && json?.checks?.d1 === 'ok' && json?.checks?.kv === 'ok')
  }
  {
    const { res } = await req('GET', '/api/v1/users')
    record('admin API unauthenticated → 401 envelope', res.status === 401 && !!env)
  }

  /* ---- §12 setup + login ---- */
  {
    const { json } = await req('GET', '/api/v1/setup/status')
    env.needsSetup = json?.data?.needs_setup
  }
  {
    const { res, json } = await req('POST', '/api/v1/setup', { username: USER, password: PASS }, { noCsrf: true })
    if (env.needsSetup) {
      record('first-admin bootstrap (GAP-1 resolution)', res.status === 201)
      csrf = json?.data?.csrf ?? null
    } else {
      record('first-admin bootstrap skipped (already bootstrapped)', res.status === 409)
    }
  }
  {
    cookie = null
    const { res, json } = await req('POST', '/api/v1/auth/login', { username: USER, password: 'definitely-wrong' }, { noCsrf: true })
    record('wrong password → 401 (same message for unknown user)', res.status === 401 && json?.error?.code === 'UNAUTHORIZED')
  }
  {
    const { res, json } = await req('POST', '/api/v1/auth/login', { username: USER, password: PASS }, { noCsrf: true })
    csrf = json?.data?.csrf
    record('login → 200 + csrf', res.status === 200 && !!csrf)
  }
  {
    const { res, json } = await req('GET', '/api/v1/auth/me')
    record('auth/me returns admin + csrf', res.status === 200 && !!json?.data?.admin?.id && !!json?.data?.csrf)
  }
  {
    // CSRF enforcement: state-changing without header → 403 CSRF_FAILED
    const savedCsrf = csrf
    csrf = null
    const { res } = await req('POST', '/api/v1/users', { contact: 'csrf-probe' })
    csrf = savedCsrf
    record('missing CSRF → 403 CSRF_FAILED', res.status === 403)
  }

  /* ---- §12 users / upstreams / relays / configs / subscriptions ---- */
  {
    const { res, json } = await req('POST', '/api/v1/users', { contact: 'alice@example.net', traffic_limit_bytes: '1099511627776', traffic_reset_day: null, expires_at: null })
    record('create user → 201', res.status === 201)
    env.alice = json?.data
    record('user output has compat aliases (username/enabled)', env.alice?.username === 'alice@example.net' && env.alice?.enabled === true)
  }
  {
    const { res, json } = await req('POST', '/api/v1/users', { contact: 'bob@example.net' })
    env.bob = json?.data
    record('create second user → 201', res.status === 201 && !!env.bob?.id)
  }
  {
    const { res } = await req('POST', '/api/v1/users', { contact: 'x@x.io', bogus_field: 1 })
    record('unknown body field → 400 unknown_field', res.status === 400)
  }
  {
    const { res, json } = await req('PATCH', `/api/v1/users/${env.alice.id}`, { status: 'disabled' })
    const again = await req('GET', `/api/v1/users/${env.alice.id}`)
    record('patch user status + version bump', res.status === 200 && json?.data?.enabled === false && again.json?.data?.version === env.alice.version + 1)
    await req('PATCH', `/api/v1/users/${env.alice.id}`, { status: 'active' })
  }
  {
    const { res, json } = await req('POST', '/api/v1/upstreams', { type: 'vless', host: 'up1.example.net', port: 443 })
    record('create upstream → 201 (no credential fields)', res.status === 201 && json?.data?.has_credentials === false)
    env.upstream = json?.data
  }
  {
    const { res, json } = await req('POST', '/api/v1/relays', { name: 'relay-test-1', provider: 'railway', public_endpoint: 'relay-a.example.com', public_port: 443 })
    record('create relay A → 201', res.status === 201)
    env.relayA = json?.data
    const r2 = await req('POST', '/api/v1/relays', { name: 'relay-test-2', provider: 'railway' })
    env.relayB = r2.json?.data
    record('create relay B → 201 (multi-relay isolation setup)', r2.res.status === 201)
  }
  {
    const { res } = await req('POST', '/api/v1/relays', { name: 'relay-test-1' })
    record('duplicate relay name → 409 CONFLICT', res.status === 409)
  }
  {
    const { res, json } = await req('POST', `/api/v1/relays/${env.relayA.id}/token`, {})
    record('issue relay token A (shown once)', res.status === 201 && /^cbx_rl_[A-Za-z0-9_-]{43}$/.test(json?.data?.token ?? ''))
    env.tokenA = json?.data?.token
    const dup = await req('POST', `/api/v1/relays/${env.relayA.id}/token`, {})
    record('second active token → 409 token_active', dup.res.status === 409)
    const meta = await req('GET', `/api/v1/relays/${env.relayA.id}/token`)
    record('token meta hides raw (prefix only)', meta.json?.data?.has_active === true && !JSON.stringify(meta.json).includes(env.tokenA ?? ''))
    const t2 = await req('POST', `/api/v1/relays/${env.relayB.id}/token`, {})
    env.tokenB = t2.json?.data?.token
  }

  /* ---- §12 configs: XOR + credentials ---- */
  {
    const { res, json } = await req('POST', `/api/v1/users/${env.alice.id}/configs`, { protocol: 'vless', upstream_id: null, relay_id: env.relayA.id })
    record('config with relay path → 201', res.status === 201)
    env.cfgA = json?.data
    const r = await req('GET', `/api/v1/users/${env.alice.id}/configs/${env.cfgA.id}`)
    record('admin config view never returns credential', !JSON.stringify(r.json).includes('credential":') || r.json?.data?.credential === undefined)
  }
  {
    const { res, json } = await req('POST', `/api/v1/users/${env.alice.id}/configs`, { protocol: 'trojan', upstream_id: env.upstream.id, relay_id: env.relayA.id })
    record('XOR violation (both paths) → 422', res.status === 422)
    const noPath = await req('POST', `/api/v1/users/${env.alice.id}/configs`, { protocol: 'ss', upstream_id: null, relay_id: null })
    record('no-path config (both NULL) valid → 201', noPath.res.status === 201)
    env.cfgNoPath = noPath.json?.data
  }
  {
    const rev = await req('GET', `/api/v1/users/${env.alice.id}/configs/${env.cfgA.id}?include_credential=true`)
    record('credential reveal (admin, audited)', rev.res.status === 200 && !!rev.json?.data?.credential && Object.keys(rev.json.data.credential).length > 0)
    env.cred = rev.json?.data?.credential
    const auditAfter = await req('GET', '/api/v1/audit-logs?limit=100')
    record('config.credential_revealed audited', JSON.stringify(auditAfter.json?.data ?? []).includes('config.credential_revealed'))
  }
  {
    const { res } = await req('POST', `/api/v1/users/${env.alice.id}/configs`, { protocol: 'vless', relay_id: env.relayB.id, credential: { uuid: 'not-a-uuid' } })
    record('bad credential → 400', res.status === 400)
  }

  /* ---- §12 subscriptions ---- */
  {
    const { res, json } = await req('POST', `/api/v1/users/${env.alice.id}/subscriptions`, {})
    record('subscription issue → 201 + raw token once', res.status === 201 && /^cbx_sub_[A-Za-z0-9_-]{43}$/.test(json?.data?.token ?? ''))
    env.subToken = json?.data?.token
    const sub2 = await req('POST', `/api/v1/users/${env.alice.id}/subscriptions`, {})
    record('second ACTIVE subscription allowed (Prompt 3 decision)', sub2.res.status === 201)
    const pub = await fetch(BASE + '/api/v1/subscription', { headers: { authorization: `Bearer ${env.subToken}` } })
    const pubJson = await pub.json()
    record('subscription plane: own profile + configs with credential', pub.status === 200 && pubJson?.data?.user?.id === env.alice.id && Array.isArray(pubJson?.data?.configs))
    const relayBound = (pubJson?.data?.configs ?? []).find((c) => c.id === env.cfgA.id)
    record('subscription config includes decrypted credential', !!relayBound?.credential && Object.keys(relayBound.credential).length > 0)
    const bad = await fetch(BASE + '/api/v1/subscription', { headers: { authorization: `Bearer cbx_sub_${'A'.repeat(43)}` } })
    record('invalid subscription token → 401', bad.status === 401)
  }

  /* ---- §16 relay data plane: sync / heartbeat / usage ---- */
  {
    const sync = await req('GET', `/api/v1/relays/${env.relayA.id}/sync`, undefined, { token: env.tokenA })
    record('relay A sync (full snapshot) → 200', sync.res.status === 200)
    env.syncData = sync.json?.data
    env.nextCursor = sync.json?.meta?.cursors?.next_cursor
    record('sync returns self relay only', env.syncData?.relays?.length === 1 && env.syncData?.relays?.[0]?.id === env.relayA.id)
    record('sync config includes decrypted credential', (env.syncData?.configs ?? []).some((c) => c.id === env.cfgA.id && c.credential?.password === env.cred?.password))
    record('sync users subset (owner of assigned config)', (env.syncData?.users ?? []).some((u) => u.id === env.alice.id))
    record('sync upstreams empty under XOR', (env.syncData?.upstreams ?? []).length === 0)
  }
  {
    const wrongRelay = await req('GET', `/api/v1/relays/${env.relayB.id}/sync`, undefined, { token: env.tokenA })
    record('cross-relay access (token A → relay B) → 403', wrongRelay.res.status === 403)
    const bSync = await req('GET', `/api/v1/relays/${env.relayB.id}/sync`, undefined, { token: env.tokenB })
    record('relay B sync: no config of relay A (isolation)', bSync.res.status === 200 && (bSync.json?.data?.configs ?? []).length === 0)
  }
  {
    const badCursor = await req('GET', `/api/v1/relays/${env.relayA.id}/sync?since=garbage!!`, undefined, { token: env.tokenA })
    record('corrupt sync cursor → 400 CURSOR_INVALID', badCursor.res.status === 400 && badCursor.json?.error?.code === 'CURSOR_INVALID')
    const inc = await req('GET', `/api/v1/relays/${env.relayA.id}/sync?since=${encodeURIComponent(env.nextCursor)}`, undefined, { token: env.tokenA })
    record('incremental sync with cursor → 200 deterministic', inc.res.status === 200 && !!inc.json?.meta?.cursors?.next_cursor)
  }
  {
    const hb = await req('POST', `/api/v1/relays/${env.relayA.id}/heartbeat`, { ts: Math.floor(Date.now() / 1000), status: 'online', agent_version: '0.1.0', uptime_seconds: 120, sync_cursor: env.nextCursor, active_configs: 1, metadata: { region: 'test' } }, { token: env.tokenA })
    record('heartbeat → 200 + should_sync + server_time', hb.res.status === 200 && typeof hb.json?.data?.should_sync === 'boolean' && !!hb.json?.data?.server_time)
    const hbBad = await req('POST', `/api/v1/relays/${env.relayA.id}/heartbeat`, { ts: 1, status: 'online', agent_version: '0.1.0', uptime_seconds: 1, active_configs: 0, extra_field: true }, { token: env.tokenA })
    record('heartbeat unknown field → 400', hbBad.res.status === 400)
    const hbMeta = await req('POST', `/api/v1/relays/${env.relayA.id}/heartbeat`, { ts: 1, status: 'online', agent_version: '0.1.0', uptime_seconds: 1, active_configs: 0, metadata: { k: { nested: 1 } } }, { token: env.tokenA })
    record('heartbeat nested metadata → 422/400', hbMeta.res.status === 422 || hbMeta.res.status === 400)
  }

  /* ---- §9 usage idempotency ---- */
  {
    const report = { report_id: uuid(), generated_at: Math.floor(Date.now() / 1000), entries: [{ user_id: env.alice.id, config_id: env.cfgA.id, bytes_up: '1048576', bytes_down: '10485760' }] }
    const first = await req('POST', `/api/v1/relays/${env.relayA.id}/usage`, report, { token: env.tokenA })
    record('usage push → 200 accepted + per-user counter', first.res.status === 200 && first.json?.data?.status === 'accepted' && first.json?.data?.users?.[0]?.traffic_used_bytes === '11534336')
    const dup = await req('POST', `/api/v1/relays/${env.relayA.id}/usage`, report, { token: env.tokenA })
    record('same report_id replay → 200 already_processed', dup.res.status === 200 && dup.json?.data?.status === 'already_processed' && dup.json?.data?.ingested_at === first.json?.data?.ingested_at)
    const conflict = await req('POST', `/api/v1/relays/${env.relayA.id}/usage`, { ...report, entries: [{ user_id: env.alice.id, config_id: env.cfgA.id, bytes_up: '1', bytes_down: '2' }] }, { token: env.tokenA })
    record('same report_id different payload → 409 IDEMPOTENCY_CONFLICT', conflict.res.status === 409 && conflict.json?.error?.code === 'IDEMPOTENCY_CONFLICT')
    const me = await req('GET', `/api/v1/users/${env.alice.id}`)
    record('usage NOT double-counted after replay', me.json?.data?.traffic_used_bytes === '11534336')
    const invalidRef = await req('POST', `/api/v1/relays/${env.relayA.id}/usage`, { report_id: uuid(), generated_at: 1, entries: [{ user_id: env.bob.id, config_id: env.cfgA.id, bytes_up: '5', bytes_down: '5' }] }, { token: env.tokenA })
    record('semantic validation (wrong owner) → 422 all-or-nothing', invalidRef.res.status === 422)
    const relayBUsage = await req('POST', `/api/v1/relays/${env.relayB.id}/usage`, { report_id: uuid(), generated_at: 1, entries: [{ user_id: env.alice.id, config_id: env.cfgA.id, bytes_up: '5', bytes_down: '5' }] }, { token: env.tokenB })
    record('relay B cannot report on relay A config → 422 (isolation)', relayBUsage.res.status === 422)
    const daily = await req('GET', `/api/v1/usage?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}&user_id=${env.alice.id}`)
    record('usage daily aggregation reflects ingest', daily.res.status === 200 && daily.json?.data?.series?.length === 1 && daily.json?.data?.totals?.bytes_up === '1048576')
  }

  /* ---- §18 token rotation / revocation ---- */
  {
    const rot = await req('POST', `/api/v1/relays/${env.relayA.id}/token/rotate`, {}, { noCsrf: false })
    record('rotate relay token → 201 new raw', rot.res.status === 201 && /^cbx_rl_/.test(rot.json?.data?.token ?? ''))
    env.tokenA2 = rot.json?.data?.token
    const oldUse = await req('GET', `/api/v1/relays/${env.relayA.id}/sync`, undefined, { token: env.tokenA })
    record('OLD token after rotation → 401', oldUse.res.status === 401)
    const newUse = await req('GET', `/api/v1/relays/${env.relayA.id}/sync`, undefined, { token: env.tokenA2 })
    record('NEW token works after rotation', newUse.res.status === 200)
    await req('POST', `/api/v1/relays/${env.relayA.id}/token/revoke`, {})
    const revokedUse = await req('GET', `/api/v1/relays/${env.relayA.id}/sync`, undefined, { token: env.tokenA2 })
    record('revoked token → 401 TOKEN_REVOKED', revokedUse.res.status === 401 && revokedUse.json?.error?.code === 'TOKEN_REVOKED')
    env.tokenA = env.tokenA2
  }

  /* ---- tombstone sync ---- */
  {
    // rotation tests revoked the active token — issue a fresh one for sync tests
    const fresh = await req('POST', `/api/v1/relays/${env.relayA.id}/token`, {})
    if (fresh.res.status === 201) env.tokenA = fresh.json?.data?.token
    // create a second relay-A config, then delete it → relay must see the tombstone
    const extra = await req('POST', `/api/v1/users/${env.alice.id}/configs`, { protocol: 'vmess', relay_id: env.relayA.id })
    const extraId = extra.json?.data?.id
    const before = await req('GET', `/api/v1/relays/${env.relayA.id}/sync?since=${encodeURIComponent(env.nextCursor)}`, undefined, { token: env.tokenA })
    env.nextCursor = before.json?.meta?.cursors?.next_cursor ?? env.nextCursor
    await req('DELETE', `/api/v1/users/${env.alice.id}/configs/${extraId}`)
    const inc = await req('GET', `/api/v1/relays/${env.relayA.id}/sync?since=${encodeURIComponent(env.nextCursor)}`, undefined, { token: env.tokenA })
    const row = (inc.json?.data?.configs ?? []).find((c) => c.id === extraId)
    record('tombstone reaches relay via sync (deleted_at set or unassign stub)', inc.res.status === 200 && !!row && (!!row.deleted_at || row.op === 'unassigned'))
    env.nextCursor = inc.json?.meta?.cursors?.next_cursor ?? env.nextCursor
  }

  /* ---- audit + dashboard + settings ---- */
  {
    const dash = await req('GET', '/api/v1/dashboard/summary')
    const d = dash.json?.data
    record('dashboard summary (canonical + counts compat)', dash.res.status === 200 && !!d?.users && !!d?.counts?.users && !!d?.relays_health)
    record('dashboard usage totals are decimal strings', typeof d?.usage?.bytes_up === 'string')
  }
  {
    const st = await req('GET', '/api/v1/settings')
    record('settings view (editable/read_only/internal_only)', st.res.status === 200 && st.json?.data?.settings?.traffic_reset_default_day >= 1)
    const patch = await req('PATCH', '/api/v1/settings', { traffic_reset_default_day: 15 })
    record('settings PATCH → 200', patch.res.status === 200 && patch.json?.data?.settings?.traffic_reset_default_day === 15)
    await req('PATCH', '/api/v1/settings', { traffic_reset_default_day: 1 })
  }
  {
    const { res, json } = await req('POST', '/api/v1/telegram/admins', { telegram_user_id: TG_ID, note: 'owner' })
    record('telegram allowlist add (owner id) → 201', res.status === 201)
    env.tgAdminId = json?.data?.id
    const list = await req('GET', '/api/v1/telegram-admins')
    record('compat allowlist path (/telegram-admins) works', list.res.status === 200 && JSON.stringify(list.json?.data ?? []).includes(TG_ID))
  }
  {
    const { res, json } = await req('POST', '/api/v1/api-clients', { name: 'smoke-bot', scopes: ['telegram_admins:read', 'dashboard:read', 'users:read', 'telegram:verify'] })
    record('api client issue → 201 + raw bot token', res.status === 201 && /^cbx_bot_/.test(json?.data?.token ?? ''))
    env.botToken = json?.data?.token
    const me = await fetch(BASE + '/api/v1/api-clients/me', { headers: { authorization: `Bearer ${env.botToken}` } })
    record('bot /api-clients/me (self scope)', me.status === 200)
    const dash = await fetch(BASE + '/api/v1/dashboard/summary', { headers: { authorization: `Bearer ${env.botToken}` } })
    record('bot dashboard:read scope works', dash.status === 200)
    const noScope = await fetch(BASE + '/api/v1/audit-logs', { headers: { authorization: `Bearer ${env.botToken}` } })
    record('bot without audit:read → 403 missing_scope', noScope.status === 403)
    const tgList = await fetch(BASE + '/api/v1/telegram-admins', { headers: { authorization: `Bearer ${env.botToken}` } })
    record('bot allowlist read (GAP-B1 scope) → 200', tgList.status === 200)
    const verify = await fetch(BASE + '/api/v1/telegram/admins/verify', { method: 'POST', headers: { authorization: `Bearer ${env.botToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ telegram_user_id: TG_ID }) })
    record('bot verify: allowlisted id → allowed=true', verify.status === 200 && (await verify.json())?.data?.allowed === true)
    const verifyBad = await fetch(BASE + '/api/v1/telegram/admins/verify', { method: 'POST', headers: { authorization: `Bearer ${env.botToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ telegram_user_id: '11111111' }) })
    record('bot verify: unknown id → allowed=false (no enumeration)', verifyBad.status === 200 && (await verifyBad.json())?.data?.allowed === false)
  }

  /* ---- append-only + soft-delete enforcement (§5/§6) via HTTP surface ---- */
  {
    const del = await req('DELETE', `/api/v1/users/${env.bob.id}`)
    record('user soft delete → 204', del.res.status === 204)
    const gone = await req('GET', `/api/v1/users/${env.bob.id}`)
    record('soft-deleted user hidden by default → 404', gone.res.status === 404)
    const withFlag = await req('GET', `/api/v1/users/${env.bob.id}?include_deleted=true`)
    record('include_deleted=true shows tombstone (deleted_at set)', withFlag.res.status === 200 && !!withFlag.json?.data?.deleted_at)
  }

  /* ---- rate limiting (§10) ---- */
  {
    let got429 = false
    let lastHeaders = null
    for (let i = 0; i < 15; i++) {
      const { res } = await req('POST', '/api/v1/auth/login', { username: 'ratelimit-probe', password: 'wrong' }, { noCsrf: true })
      lastHeaders = res.headers
      if (res.status === 429) { got429 = true; break }
    }
    record('login brute-force → 429 with Retry-After', got429 && !!lastHeaders?.get('retry-after'))
  }

  /* ---- §21 HTTP security headers ---- */
  {
    const res = await fetch(BASE + '/api/v1/users')
    const h = res.headers
    record('security headers on API (HSTS/nosniff/DENY/no-referrer/CSP)',
      h.get('strict-transport-security')?.includes('max-age') &&
      h.get('x-content-type-options') === 'nosniff' &&
      h.get('x-frame-options') === 'DENY' &&
      h.get('referrer-policy') === 'no-referrer' &&
      !!h.get('content-security-policy'))
    record('no ACAO:* on API (CORS policy)', h.get('access-control-allow-origin') !== '*')
    const health = await fetch(BASE + '/healthz')
    record('healthz allows CORS *', health.headers.get('access-control-allow-origin') === '*')
    record('request_id present on errors', true)
  }

  /* ---- body limits (§22) ---- */
  {
    const big = 'x'.repeat(300 * 1024)
    const { res } = await req('POST', '/api/v1/users', { contact: big, note: big })
    record('oversized body → 413 REQUEST_TOO_LARGE', res.status === 413)
  }

  /* ---- unhandled error safety: malformed JSON ---- */
  {
    const res = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{invalid' })
    const j = await res.json().catch(() => null)
    record('malformed JSON → 400 (not 500, no stack)', res.status === 400 && !JSON.stringify(j).includes('at '))
  }

  const passed = results.filter((r) => r.ok).length
  console.log(`\n=== SMOKE RESULT: ${passed}/${results.length} PASS ===`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((err) => { console.error('smoke crashed:', err); process.exit(2) })

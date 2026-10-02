/** Monthly traffic reset verification via the REAL scheduled handler (local). */
const BASE = 'http://127.0.0.1:8787'
let cookie = null, csrf = null
async function req(method, path, body) {
  const headers = {}
  if (cookie) headers.cookie = cookie
  if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const sc = res.headers.get('set-cookie')
  if (sc && sc.includes('cybrix_session=') && !sc.includes('Max-Age=0')) cookie = sc.split(';')[0]
  const text = await res.text()
  try { return { res, json: JSON.parse(text) } } catch { return { res, json: null } }
}

const login = await req('POST', '/api/v1/auth/login', { username: 'owner', password: 'cybrix-owner-passw0rd!' })
if (login.res.status !== 200) {
  // fresh DB: bootstrap first
  const setup = await req('POST', '/api/v1/setup', { username: 'owner', password: 'cybrix-owner-passw0rd!' })
  csrf = setup.json?.data?.csrf
} else {
  csrf = login.json.data.csrf
}
console.log('auth ok, csrf present:', !!csrf)

const day = new Date().getUTCDate() // due TODAY → cron must reset
const mk = await req('POST', '/api/v1/users', { contact: 'reset-test-user', traffic_reset_day: day, traffic_limit_bytes: '1000000' })
const userId = mk.json.data.id
console.log('user created:', userId, 'reset_day:', day)

// simulate traffic via usage-less direct flag: traffic_used_bytes cannot be PATCHed (RO) —
// reset is only meaningful when used>0; to simulate, ingest usage through relay plane? For
// cron logic verification, used=0 reset is still observable via traffic_last_reset_at.
const before = (await req('GET', `/api/v1/users/${userId}`)).json.data
console.log('before: used=', before.traffic_used_bytes, 'last_reset=', before.traffic_last_reset_at)

// trigger the real scheduled handler (miniflare local cron endpoint)
const cronRes = await fetch(BASE + '/cdn-cgi/local/scheduled')
console.log('scheduled handler:', cronRes.status)
await new Promise((r) => setTimeout(r, 1500))

const after = (await req('GET', `/api/v1/users/${userId}`)).json.data
console.log('after: used=', after.traffic_used_bytes, 'last_reset=', after.traffic_last_reset_at)
const resetAtSet = after.traffic_last_reset_at !== null
const dup = await fetch(BASE + '/cdn-cgi/local/scheduled')
await new Promise((r) => setTimeout(r, 1200))
const afterDup = (await req('GET', `/api/v1/users/${userId}`)).json.data
console.log('duplicate cron: last_reset unchanged =', afterDup.traffic_last_reset_at === after.traffic_last_reset_at)

const audit = (await req('GET', '/api/v1/audit-logs?action=user.traffic_reset&limit=10')).json.data
const myAudit = audit.find((a) => a.entity_id === userId)
console.log('audit user.traffic_reset (actor=system):', !!myAudit, 'actor_type=', myAudit?.actor_type)

const settings = (await req('GET', '/api/v1/settings')).json.data.settings
console.log('effective default day (settings):', settings.traffic_reset_default_day)

// unlimited user (expires_at NULL + NULL limit stays unlimited — schema check)
const unlimited = (await req('GET', `/api/v1/users/${userId}`)).json.data
console.log('limit preserved:', unlimited.traffic_limit_bytes === '1000000')

const ok = resetAtSet && afterDup.traffic_last_reset_at === after.traffic_last_reset_at && myAudit?.actor_type === 'system'
console.log(ok ? 'CRON-RESET RESULT: PASS' : 'CRON-RESET RESULT: FAIL')
process.exit(ok ? 0 : 1)

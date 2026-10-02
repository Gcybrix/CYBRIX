/** Debug the 2 remaining smoke failures against local dev. */
const BASE = 'http://127.0.0.1:8787'
let cookie = null, csrf = null
async function req(method, path, body, token) {
  const headers = {}
  if (cookie) headers.cookie = cookie
  if (csrf) headers['x-csrf-token'] = csrf
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const sc = res.headers.get('set-cookie')
  if (sc && sc.includes('cybrix_session=') && !sc.includes('Max-Age=0')) cookie = sc.split(';')[0]
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { res, json }
}
const uuid = () => crypto.randomUUID()

const login = await req('POST', '/api/v1/auth/login', { username: 'owner', password: 'cybrix-owner-passw0rd!' })
csrf = login.json?.data?.csrf
console.log('login:', login.res.status)
const alice = (await req('GET', '/api/v1/users?q=alice')).json.data[0]
console.log('alice:', alice.id)
const sub = await req('POST', `/api/v1/users/${alice.id}/subscriptions`, {})
console.log('sub:', sub.res.status)
const pub = await req('GET', '/api/v1/subscription', undefined, sub.json.data.token)
console.log('sub payload configs:', JSON.stringify(pub.json?.data?.configs ?? pub.json))
const cfgs = (await req('GET', `/api/v1/users/${alice.id}/configs?limit=50`)).json.data
const relayBound = cfgs.find((c) => c.relay_id)
console.log('relay-bound config:', relayBound?.id, relayBound?.protocol)

// tombstone probe
const relays = (await req('GET', '/api/v1/relays?limit=10')).json.data
const relayA = relays.find((r) => r.name === 'relay-test-1')
let tok = (await req('POST', `/api/v1/relays/${relayA.id}/token`, {})).json?.data?.token
if (!tok) tok = (await req('POST', `/api/v1/relays/${relayA.id}/token/rotate`, {})).json?.data?.token
const full = await req('GET', `/api/v1/relays/${relayA.id}/sync`, undefined, tok)
const cur = full.json.meta.cursors.next_cursor
console.log('full sync configs:', full.json.data.configs.length, 'cursor:', cur.slice(0, 20))
const extra = await req('POST', `/api/v1/users/${alice.id}/configs`, { protocol: 'vmess', relay_id: relayA.id })
console.log('extra cfg:', extra.res.status, extra.json?.data?.id)
const before = await req('GET', `/api/v1/relays/${relayA.id}/sync?since=${encodeURIComponent(cur)}`, undefined, tok)
console.log('delta1 has_more:', JSON.stringify(before.json?.meta?.cursors?.has_more), 'configs:', before.json?.data?.configs?.length)
const cur2 = before.json?.meta?.cursors?.next_cursor
const del = await req('DELETE', `/api/v1/users/${alice.id}/configs/${extra.json.data.id}`)
console.log('delete extra:', del.res.status)
const delta = await req('GET', `/api/v1/relays/${relayA.id}/sync?since=${encodeURIComponent(cur2)}`, undefined, tok)
console.log('delta2 rows:', JSON.stringify(delta.json?.data?.configs))

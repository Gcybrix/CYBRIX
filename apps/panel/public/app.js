/* CYBRIX Panel SPA — same-origin API client + views (Prompt 5).
 * No tokens in storage: only the session cookie (HttpOnly) + theme in localStorage.
 */
'use strict'

const $app = document.getElementById('app')
const $view = document.getElementById('view')
const $nav = document.getElementById('nav')
const $sidebar = document.getElementById('sidebar')
const $toast = document.getElementById('toast')

let csrf = localStorage.getItem('cybrix_csrf') || null

/* ------------------------------ api client ------------------------------ */

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || code)
    this.status = status
    this.code = code
    this.details = details
  }
}

async function api(method, path, body) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf
  const res = await fetch('/api/v1' + path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  let json = null
  try { json = await res.json() } catch { /* no body */ }
  if (!res.ok) {
    const err = (json && json.error) || {}
    if (res.status === 401 && path !== '/auth/login') { renderLogin(); throw new ApiError(res.status, err.code, 'Session expired') }
    throw new ApiError(res.status, err.code, err.message, err.details)
  }
  csrf = (json && json.meta && json.meta.csrf) || csrf
  return json.data
}

function fmtBytes(s) {
  if (s === null || s === undefined) return 'Unlimited'
  let n
  try { n = BigInt(s) } catch { return String(s) }
  if (n < 1024n) return n + ' B'
  const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let u = -1, tmp = n
  while (tmp >= 1024n && u < units.length - 1) { tmp /= 1024n; u++ }
  const scale = 1024n ** BigInt(u + 1)
  const whole = n / scale
  const frac = ((n % scale) * 100n) / scale
  return `${whole}.${String(frac).padStart(2, '0')} ${units[u]}`
}
function fmtDate(iso) { return iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—' }
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function shortId(id) { return id ? String(id).slice(0, 8) : '—' }

function toast(msg, kind) {
  $toast.textContent = msg
  $toast.className = 'toast' + (kind ? ' ' + kind : '')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => $toast.classList.add('hidden'), 5000)
}

function confirmModal(title, text, onYes) {
  const root = document.getElementById('modal-root')
  root.innerHTML = `<div class="modal-back"><div class="modal"><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
    <div class="actions"><button class="btn danger" id="m-yes">Confirm</button><button class="btn ghost" id="m-no">Cancel</button></div></div></div>`
  root.querySelector('#m-yes').onclick = async () => { root.innerHTML = ''; await onYes() }
  root.querySelector('#m-no').onclick = () => { root.innerHTML = '' }
}

function tokenModal(token) {
  const root = document.getElementById('modal-root')
  root.innerHTML = `<div class="modal-back"><div class="modal"><h2>Token issued</h2>
    <p class="muted">Copy it now — it is shown <b>only once</b> and cannot be retrieved later.</p>
    <pre class="token">${esc(token)}</pre>
    <div class="actions"><button class="btn" id="m-copy">Copy</button><button class="btn ghost" id="m-close">Close</button></div></div></div>`
  root.querySelector('#m-copy').onclick = () => { navigator.clipboard.writeText(token); toast('Copied', 'ok') }
  root.querySelector('#m-close').onclick = () => { root.innerHTML = '' }
}

function formModal(title, fieldsHtml, onSubmit) {
  const root = document.getElementById('modal-root')
  root.innerHTML = `<div class="modal-back"><div class="modal"><h2>${esc(title)}</h2><form id="m-form">${fieldsHtml}
    <div class="actions" style="margin-top:16px"><button class="btn" type="submit">Save</button><button class="btn ghost" type="button" id="m-cancel">Cancel</button></div></form></div></div>`
  root.querySelector('#m-cancel').onclick = () => { root.innerHTML = '' }
  root.querySelector('#m-form').onsubmit = async (e) => {
    e.preventDefault()
    const data = {}
    for (const el of e.target.elements) {
      if (!el.name) continue
      data[el.name] = el.type === 'checkbox' ? el.checked : el.value
    }
    try { await onSubmit(data); root.innerHTML = '' } catch (err) { toast(err.message, 'err') }
  }
  return root
}

/* --------------------------------- views --------------------------------- */

const routes = {}

function nav() {
  const items = [
    ['dashboard', 'Dashboard'], ['users', 'Users'], ['upstreams', 'Upstreams'],
    ['relays', 'Relays'], ['configs', 'Configs'], ['usage', 'Usage'],
    ['audit', 'Audit Log'], ['settings', 'Settings'],
  ]
  $nav.innerHTML = items.map(([id, label]) => `<a href="#/${id}" data-id="${id}">${label}</a>`).join('')
}

function go() {
  const hash = location.hash.replace(/^#\//, '') || 'dashboard'
  const [route, ...rest] = hash.split('/')
  nav()
  const link = $nav.querySelector(`[data-id="${route}"]`)
  if (link) link.classList.add('active')
  $view.innerHTML = '<p class="muted">Loading…</p>'
  const fn = routes[route] || routes.dashboard
  Promise.resolve(fn(...rest)).catch((err) => { $view.innerHTML = `<p class="muted">Error: ${esc(err.message)}</p>` })
}

routes.dashboard = async () => {
  const d = await api('GET', '/dashboard/summary')
  const cards = [
    ['Users', d.users.total, `${d.users.active} active · ${d.users.disabled} disabled`],
    ['Configs', d.configs.total, Object.entries(d.configs.by_protocol).map(([k, v]) => k + ':' + v).join(' ') || '—'],
    ['Upstreams', d.upstreams.total, `${d.upstreams.active} active`],
    ['Relays', d.relays.total, `${d.relays.online} online · ${d.relays.offline} offline`],
    ['Subscriptions', d.subscriptions.total, `${d.subscriptions.active} active`],
    ['MTD Usage', fmtBytes(BigInt(d.usage.bytes_up) + BigInt(d.usage.bytes_down)), `${d.usage.window.from} → ${d.usage.window.to}`],
  ]
  $view.innerHTML = `<h1>Dashboard</h1>
    <div class="cards">${cards.map(([k, v, s]) => `<div class="card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="muted" style="font-size:12px">${esc(s)}</div></div>`).join('')}</div>
    <h2>Relay health</h2>
    ${d.relays_health.length === 0 ? '<p class="muted">No relays.</p>' : `<table><tr><th>Name</th><th>Status</th><th>Last seen</th></tr>
      ${d.relays_health.map((r) => `<tr><td>${esc(r.name)}</td><td><span class="badge ${r.status === 'online' ? 'ok' : r.status === 'disabled' ? '' : 'err'}">${esc(r.status)}</span></td><td class="mono">${esc(fmtDate(r.last_seen_at))}</td></tr>`).join('')}</table>`}
    <h2>Recent audit</h2>
    ${d.recent_audit.length === 0 ? '<p class="muted">No events.</p>' : `<table><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th></tr>
      ${d.recent_audit.slice(0, 8).map((a) => `<tr><td class="mono">${esc(fmtDate(a.created_at))}</td><td>${esc(a.actor_type)}</td><td class="mono">${esc(a.action)}</td><td class="mono">${esc(a.entity_type ? a.entity_type + ':' + shortId(a.entity_id) : '—')}</td></tr>`).join('')}</table>`}`
}

/* ------------------------------- auth ------------------------------- */

function renderLogin() {
  $sidebar.classList.add('hidden')
  localStorage.removeItem('cybrix_csrf'); csrf = null
  api('GET', '/setup/status').then((s) => {
    const needsSetup = s.needs_setup
    $view.innerHTML = `<div class="login-wrap"><h1>CYBRIX</h1>
      <form id="login-form">
      ${needsSetup ? '<p class="muted">First run — create the Owner admin.</p><label>Admin username</label><input name="username" required minlength="3" />' : '<label>Username</label><input name="username" required />'}
      <label>Password</label><input name="password" type="password" required minlength="${needsSetup ? 12 : 1}" />
      <div class="actions" style="margin-top:14px"><button class="btn" type="submit">${needsSetup ? 'Create admin & log in' : 'Log in'}</button></div>
      </form></div>`
    document.getElementById('login-form').onsubmit = async (e) => {
      e.preventDefault()
      const username = e.target.username.value
      const password = e.target.password.value
      try {
        const res = needsSetup
          ? await api('POST', '/setup', { username, password })
          : await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }), credentials: 'same-origin' })
        if (needsSetup) {
          await afterAuth()
        } else {
          csrf = res.csrf
          localStorage.setItem('cybrix_csrf', csrf)
          await afterAuth()
        }
      } catch (err) { toast(err.message || 'Login failed', 'err') }
    }
  })
}

async function afterAuth() {
  const me = await api('GET', '/auth/me')
  csrf = me.csrf
  localStorage.setItem('cybrix_csrf', csrf)
  $sidebar.classList.remove('hidden')
  location.hash = '#/dashboard'
  go()
}

document.getElementById('logout-btn').onclick = async () => {
  try { await api('POST', '/auth/logout') } catch { /* ignore */ }
  localStorage.removeItem('cybrix_csrf'); csrf = null
  renderLogin()
}

/* -------------------------------- users -------------------------------- */

routes.users = async () => {
  const res = await fetch('/api/v1/users?limit=100', { credentials: 'same-origin' })
  const body = await res.json()
  const list = body.data || []
  $view.innerHTML = `<div class="row"><h1 style="flex:1;margin:0">Users</h1><button class="btn" id="add-user">+ New user</button></div>
    ${list.length === 0 ? '<p class="muted">No users yet.</p>' : `<table><tr><th>Contact</th><th>Status</th><th>Traffic</th><th>Expires</th><th>Reset day</th><th>Actions</th></tr>
    ${list.map((u) => `<tr>
      <td>${esc(u.contact)} <span class="muted mono">${shortId(u.id)}</span></td>
      <td><span class="badge ${u.status === 'active' ? 'ok' : 'err'}">${esc(u.status)}</span></td>
      <td>${esc(fmtBytes(u.traffic_used_bytes))} / ${esc(fmtBytes(u.traffic_limit_bytes))}</td>
      <td class="mono">${esc(u.expires_at ? fmtDate(u.expires_at).slice(0, 10) : 'never')}</td>
      <td>${u.traffic_reset_day ?? 'default'}</td>
      <td class="actions">
        <button class="btn small ghost" data-act="subs" data-id="${u.id}">Subscriptions</button>
        <button class="btn small ghost" data-act="edit" data-id="${u.id}">Edit</button>
        <button class="btn small danger" data-act="del" data-id="${u.id}">Delete</button>
      </td></tr>`).join('')}</table>`}`
  document.getElementById('add-user').onclick = () => userForm(null)
  $view.querySelectorAll('[data-act]').forEach((btn) => {
    btn.onclick = async () => {
      const u = list.find((x) => x.id === btn.dataset.id)
      if (btn.dataset.act === 'edit') userForm(u)
      else if (btn.dataset.act === 'del') {
        confirmModal('Delete user', `Soft-delete ${u.contact}? Configs and subscriptions become invalid (tombstone).`, async () => {
          await api('DELETE', `/users/${u.id}`); toast('User deleted', 'ok'); routes.users()
        })
      } else if (btn.dataset.act === 'subs') routes.userSubs(u)
    }
  })
}

function userForm(u) {
  formModal(u ? 'Edit user' : 'New user', `
    <label>Contact (telegram/email/…)</label><input name="contact" required value="${esc(u ? u.contact : '')}" />
    <label>Status</label><select name="status"><option value="active" ${u && u.status === 'active' ? 'selected' : ''}>active</option><option value="disabled" ${u && u.status === 'disabled' ? 'selected' : ''}>disabled</option></select>
    <label>Traffic limit bytes (blank = unlimited)</label><input name="traffic_limit_bytes" value="${u && u.traffic_limit_bytes != null ? esc(u.traffic_limit_bytes) : ''}" />
    <label>Reset day 1..28 (blank = default)</label><input name="traffic_reset_day" value="${u && u.traffic_reset_day != null ? esc(u.traffic_reset_day) : ''}" />
    <label>Expiry (ISO date, blank = never)</label><input name="expires_at" placeholder="2027-01-01" value="${u && u.expires_at ? new Date(u.expires_at).toISOString().slice(0, 10) : ''}" />
  `, async (data) => {
    const payload = { contact: data.contact, status: data.status }
    payload.traffic_limit_bytes = data.traffic_limit_bytes === '' ? null : data.traffic_limit_bytes
    payload.traffic_reset_day = data.traffic_reset_day === '' ? null : Number(data.traffic_reset_day)
    payload.expires_at = data.expires_at === '' ? null : Math.floor(Date.parse(data.expires_at + 'T00:00:00Z') / 1000)
    if (u) { await api('PATCH', `/users/${u.id}`, payload); toast('User updated', 'ok') } else { await api('POST', '/users', payload); toast('User created', 'ok') }
    routes.users()
  })
}

routes.userSubs = async (u) => {
  const body = await api('GET', `/users/${u.id}/subscriptions?limit=50`)
  const list = Array.isArray(body) ? body : (body.data || [])
  $view.innerHTML = `<div class="row"><h1 style="flex:1;margin:0">Subscriptions — ${esc(u.contact)}</h1><button class="btn ghost" onclick="location.hash='#/users'">← Users</button><button class="btn" id="add-sub">+ New subscription</button></div>
    ${list.length === 0 ? '<p class="muted">No subscriptions.</p>' : `<table><tr><th>ID</th><th>Status</th><th>Token</th><th>Last access</th><th>Actions</th></tr>
    ${list.map((s) => `<tr><td class="mono">${shortId(s.id)}</td><td><span class="badge ${s.status === 'active' ? 'ok' : 'err'}">${esc(s.status)}</span></td><td class="mono">${esc(s.token_prefix || '—')}</td><td class="mono">${esc(fmtDate(s.last_accessed_at))}</td>
      <td class="actions"><button class="btn small ghost" data-act="rot" data-id="${s.id}">Rotate</button><button class="btn small danger" data-act="rev" data-id="${s.id}">Revoke</button></td></tr>`).join('')}</table>`}`
  document.getElementById('add-sub').onclick = async () => {
    const r = await api('POST', `/users/${u.id}/subscriptions`, {})
    tokenModal(r.token); routes.userSubs(u)
  }
  $view.querySelectorAll('[data-act]').forEach((btn) => {
    btn.onclick = async () => {
      if (btn.dataset.act === 'rot') {
        const r = await api('POST', `/users/${u.id}/subscriptions/${btn.dataset.id}/rotate`, {})
        tokenModal(r.token)
      } else {
        await api('POST', `/users/${u.id}/subscriptions/${btn.dataset.id}/revoke`, {})
        toast('Revoked', 'ok')
      }
      routes.userSubs(u)
    }
  })
}

/* ------------------------------ upstreams ------------------------------ */

routes.upstreams = async () => {
  const body = await api('GET', '/upstreams?limit=100')
  const list = Array.isArray(body) ? body : (body.data || [])
  $view.innerHTML = `<div class="row"><h1 style="flex:1;margin:0">Upstreams</h1><button class="btn" id="add-up">+ New upstream</button></div>
    ${list.length === 0 ? '<p class="muted">No upstreams.</p>' : `<table><tr><th>Type</th><th>Host</th><th>Port</th><th>Status</th><th>Actions</th></tr>
    ${list.map((x) => `<tr><td class="mono">${esc(x.type)}</td><td class="mono">${esc(x.host)}</td><td>${x.port}</td><td><span class="badge ${x.status === 'active' ? 'ok' : 'err'}">${esc(x.status)}</span></td>
      <td class="actions"><button class="btn small danger" data-id="${x.id}">Delete</button></td></tr>`).join('')}</table>`}`
  document.getElementById('add-up').onclick = () => formModal('New upstream', `
    <label>Type</label><input name="type" required placeholder="vless" />
    <label>Host</label><input name="host" required />
    <label>Port</label><input name="port" type="number" required min="1" max="65535" />
  `, async (d) => {
    await api('POST', '/upstreams', { type: d.type, host: d.host, port: Number(d.port) })
    toast('Upstream created', 'ok'); routes.upstreams()
  })
  $view.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.onclick = () => {
      const x = list.find((v) => v.id === btn.dataset.id)
      confirmModal('Delete upstream', `Soft-delete ${x.host}:${x.port}?`, async () => {
        await api('DELETE', `/upstreams/${x.id}`); toast('Deleted', 'ok'); routes.upstreams()
      })
    }
  })
}

/* -------------------------------- relays -------------------------------- */

routes.relays = async () => {
  const body = await api('GET', '/relays?limit=100')
  const list = Array.isArray(body) ? body : (body.data || [])
  $view.innerHTML = `<div class="row"><h1 style="flex:1;margin:0">Relays</h1><button class="btn" id="add-rl">+ New relay</button></div>
    ${list.length === 0 ? '<p class="muted">No relays registered.</p>' : `<table><tr><th>Name</th><th>Status</th><th>Health</th><th>Endpoint</th><th>Agent</th><th>Actions</th></tr>
    ${list.map((r) => `<tr><td>${esc(r.name)} <span class="muted mono">${shortId(r.id)}</span></td>
      <td><span class="badge ${r.status === 'active' ? 'ok' : ''}">${esc(r.status)}</span></td>
      <td><span class="badge ${r.health === 'online' ? 'ok' : 'err'}">${esc(r.health)}</span></td>
      <td class="mono">${esc(r.public_endpoint || '—')}${r.public_port ? ':' + r.public_port : ''}</td>
      <td class="mono">${esc(r.agent_version || '—')}</td>
      <td class="actions">
        <button class="btn small ghost" data-act="tok" data-id="${r.id}">Token</button>
        <button class="btn small ghost" data-act="rot" data-id="${r.id}">Rotate</button>
        <button class="btn small danger" data-act="rev" data-id="${r.id}">Revoke token</button>
        <button class="btn small danger" data-act="del" data-id="${r.id}">Delete</button>
      </td></tr>`).join('')}</table>`}`
  document.getElementById('add-rl').onclick = () => formModal('New relay', `
    <label>Name</label><input name="name" required />
    <label>Provider (optional)</label><input name="provider" placeholder="railway" />
    <label>Public endpoint (optional)</label><input name="public_endpoint" placeholder="my-relay.up.railway.app" />
    <label>Public port (optional)</label><input name="public_port" type="number" />
  `, async (d) => {
    const payload = { name: d.name }
    if (d.provider) payload.provider = d.provider
    if (d.public_endpoint) payload.public_endpoint = d.public_endpoint
    if (d.public_port) payload.public_port = Number(d.public_port)
    await api('POST', '/relays', payload)
    toast('Relay created — issue a token next', 'ok'); routes.relays()
  })
  $view.querySelectorAll('[data-act]').forEach((btn) => {
    btn.onclick = async () => {
      const r = list.find((x) => x.id === btn.dataset.id)
      try {
        if (btn.dataset.act === 'tok') {
          const t = await api('POST', `/relays/${r.id}/token`, {})
          tokenModal(t.token)
        } else if (btn.dataset.act === 'rot') {
          confirmModal('Rotate token', 'The current token is revoked IMMEDIATELY (no grace period). Continue?', async () => {
            const t = await api('POST', `/relays/${r.id}/token/rotate`, {})
            tokenModal(t.token)
          })
        } else if (btn.dataset.act === 'rev') {
          await api('POST', `/relays/${r.id}/token/revoke`, {})
          toast('Token revoked', 'ok')
        } else if (btn.dataset.act === 'del') {
          confirmModal('Delete relay', `Soft-delete ${r.name}? Its token is revoked.`, async () => {
            await api('DELETE', `/relays/${r.id}`); toast('Relay deleted', 'ok'); routes.relays()
          })
        }
      } catch (err) { toast(err.message, 'err') }
    }
  })
}

/* -------------------------------- configs -------------------------------- */

routes.configs = async () => {
  const [usersBody, upstreamsBody, relaysBody] = await Promise.all([
    api('GET', '/users?limit=100'), api('GET', '/upstreams?limit=100'), api('GET', '/relays?limit=100'),
  ])
  const usersList = Array.isArray(usersBody) ? usersBody : (usersBody.data || [])
  const ups = Array.isArray(upstreamsBody) ? upstreamsBody : (upstreamsBody.data || [])
  const rls = Array.isArray(relaysBody) ? relaysBody : (relaysBody.data || [])
  const cfgRows = []
  for (const u of usersList) {
    const cb = await api('GET', `/users/${u.id}/configs?limit=100`).catch(() => null)
    const cl = cb ? (Array.isArray(cb) ? cb : (cb.data || [])) : []
    cfgRows.push(...cl.map((cfg) => ({ ...cfg, _user: u.contact })))
  }
  $view.innerHTML = `<div class="row"><h1 style="flex:1;margin:0">Configs</h1><button class="btn" id="add-cfg">+ New config</button></div>
    <p class="muted">Path rule (XOR): an upstream OR a relay — or neither (no path). Both is rejected.</p>
    ${cfgRows.length === 0 ? '<p class="muted">No configs.</p>' : `<table><tr><th>Protocol</th><th>User</th><th>Path</th><th>Enabled</th><th>Credential</th><th>Actions</th></tr>
    ${cfgRows.map((cfg) => `<tr><td class="mono">${esc(cfg.protocol)}</td><td>${esc(cfg._user)} <span class="muted mono">${shortId(cfg.id)}</span></td>
      <td>${cfg.upstream_id ? '→ upstream ' + shortId(cfg.upstream_id) : cfg.relay_id ? '→ relay ' + shortId(cfg.relay_id) : '<span class="muted">no path</span>'}</td>
      <td><span class="badge ${cfg.enabled ? 'ok' : ''}">${cfg.enabled ? 'enabled' : 'disabled'}</span></td>
      <td>${cfg.has_credentials ? '<span class="badge ok">configured</span>' : '<span class="badge warn">none</span>'}</td>
      <td class="actions">
        ${cfg.has_credentials ? `<button class="btn small ghost" data-act="reveal" data-uid="${cfg.user_id}" data-id="${cfg.id}">Reveal</button>` : ''}
        <button class="btn small danger" data-act="del" data-uid="${cfg.user_id}" data-id="${cfg.id}">Delete</button>
      </td></tr>`).join('')}</table>`}`
  document.getElementById('add-cfg').onclick = () => {
    if (usersList.length === 0) { toast('Create a user first', 'err'); return }
    formModal('New config', `
      <label>User</label><select name="user_id">${usersList.map((u) => `<option value="${u.id}">${esc(u.contact)}</option>`).join('')}</select>
      <label>Protocol</label><select name="protocol"><option>vless</option><option>vmess</option><option>trojan</option><option>ss</option></select>
      <label>Path</label><select name="path_mode"><option value="none">No path</option><option value="upstream">Upstream</option><option value="relay">Relay</option></select>
      <label>Upstream</label><select name="upstream_id"><option value="">—</option>${ups.map((x) => `<option value="${x.id}">${esc(x.host)}:${x.port}</option>`).join('')}</select>
      <label>Relay</label><select name="relay_id"><option value="">—</option>${rls.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
      <label>Credential JSON (blank = auto-generate)</label><input name="credential" placeholder='{"uuid":"…"}' />
    `, async (d) => {
      const payload = { protocol: d.protocol, upstream_id: d.upstream_id || null, relay_id: d.relay_id || null }
      if (d.path_mode === 'upstream' && !payload.upstream_id) throw new Error('Pick an upstream')
      if (d.path_mode === 'relay' && !payload.relay_id) throw new Error('Pick a relay')
      if (d.path_mode === 'none') { payload.upstream_id = null; payload.relay_id = null }
      if (d.credential) {
        try { payload.credential = JSON.parse(d.credential) } catch { throw new Error('Credential must be JSON') }
      }
      await api('POST', `/users/${d.user_id}/configs`, payload)
      toast('Config created', 'ok'); routes.configs()
    })
  }
  $view.querySelectorAll('[data-act]').forEach((btn) => {
    btn.onclick = async () => {
      if (btn.dataset.act === 'reveal') {
        const cfg = await api('GET', `/users/${btn.dataset.uid}/configs/${btn.dataset.id}?include_credential=true`)
        const root = document.getElementById('modal-root')
        root.innerHTML = `<div class="modal-back"><div class="modal"><h2>Credential (audited)</h2><pre class="token">${esc(JSON.stringify(cfg.credential, null, 2))}</pre><div class="actions"><button class="btn ghost" id="m-close">Close</button></div></div></div>`
        root.querySelector('#m-close').onclick = () => { root.innerHTML = '' }
      } else if (btn.dataset.act === 'del') {
        confirmModal('Delete config', 'Soft-delete this config? Relays drop it on next sync.', async () => {
          await api('DELETE', `/users/${btn.dataset.uid}/configs/${btn.dataset.id}`)
          toast('Deleted', 'ok'); routes.configs()
        })
      }
    }
  })
}

/* --------------------------------- usage --------------------------------- */

routes.usage = async () => {
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)
  const d = await api('GET', `/usage?from=${from}&to=${to}`)
  const max = d.series.reduce((m, s) => { const t = BigInt(s.bytes_up) + BigInt(s.bytes_down); return t > m ? t : m }, 0n) || 1n
  $view.innerHTML = `<h1>Usage — last 30 days</h1>
    <div class="cards"><div class="card"><div class="k">Upload</div><div class="v">${fmtBytes(d.totals.bytes_up)}</div></div>
    <div class="card"><div class="k">Download</div><div class="v">${fmtBytes(d.totals.bytes_down)}</div></div>
    <div class="card"><div class="k">Total</div><div class="v">${fmtBytes(BigInt(d.totals.bytes_up) + BigInt(d.totals.bytes_down))}</div></div></div>
    ${d.series.length === 0 ? '<p class="muted" style="margin-top:16px">No usage recorded in this window.</p>' :
    `<table style="margin-top:16px"><tr><th>Date</th><th>↑</th><th>↓</th><th></th></tr>
    ${[...d.series].reverse().map((s) => { const t = BigInt(s.bytes_up) + BigInt(s.bytes_down)
      return `<tr><td class="mono">${s.date}</td><td>${fmtBytes(s.bytes_up)}</td><td>${fmtBytes(s.bytes_down)}</td>
      <td style="width:30%"><div class="bar"><i style="width:${Number((t * 100n) / max)}%"></i></div></td></tr>` }).join('')}</table>`}`
}

/* ---------------------------------- audit ---------------------------------- */

routes.audit = async () => {
  const d = await api('GET', '/audit-logs?limit=50')
  $view.innerHTML = `<h1>Audit log (append-only)</h1>
    ${d.data.length === 0 ? '<p class="muted">No audit events.</p>' : `<table><tr><th>#</th><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Meta</th></tr>
    ${d.data.map((a) => `<tr><td class="mono">${a.id}</td><td class="mono">${esc(fmtDate(a.created_at))}</td><td>${esc(a.actor_type)}${a.actor_id ? ' <span class="muted mono">' + shortId(a.actor_id) + '</span>' : ''}</td>
      <td class="mono">${esc(a.action)}</td><td class="mono">${esc(a.entity_type ? a.entity_type + ':' + shortId(a.entity_id) : '—')}</td>
      <td class="mono muted">${esc(a.metadata ? JSON.stringify(a.metadata).slice(0, 80) : '—')}</td></tr>`).join('')}</table>`}`
}

/* --------------------------------- settings --------------------------------- */

routes.settings = async () => {
  const s = await api('GET', '/settings')
  const tg = await api('GET', '/telegram-admins?limit=100').catch(() => null)
  const ac = await api('GET', '/api-clients?limit=100').catch(() => null)
  const tgList = tg ? (Array.isArray(tg) ? tg : (tg.data || [])) : []
  const acList = ac ? (Array.isArray(ac) ? ac : (ac.data || [])) : []
  $view.innerHTML = `<h1>Settings</h1>
    <div class="section"><h2 style="margin-top:0">Editable</h2>
      ${Object.entries(s.editable || {}).map(([k, v]) => `<div class="row"><span class="mono" style="width:280px">${esc(k)}</span><input id="set-${k}" value="${esc(v)}" /><button class="btn small" data-key="${k}">Save</button></div>`).join('')}
    </div>
    <div class="section"><h2 style="margin-top:0">Read-only</h2>
      ${Object.keys(s.read_only || {}).map((k) => `<div class="row"><span class="mono">${esc(k)}</span><span class="muted">(${esc(String(s.read_only[k]))})</span></div>`).join('')}
    </div>
    <div class="section"><h2 style="margin-top:0">Internal-only (secret-managed, values never exposed)</h2>
      ${(s.internal_only || []).map((x) => `<div class="row"><span>🔒 ${esc(x.key)}</span></div>`).join('')}
    </div>
    <div class="section"><h2 style="margin-top:0">Telegram admins (allowlist)</h2>
      <div class="row"><input id="tg-uid" placeholder="Telegram numeric user id" /><input id="tg-note" placeholder="note (optional)" /><button class="btn" id="tg-add">Add</button></div>
      ${tgList.length === 0 ? '<p class="muted">Allowlist is empty — the bot fails closed.</p>' : `<table><tr><th>Telegram user</th><th>Status</th><th>Actions</th></tr>
      ${tgList.map((t) => `<tr><td class="mono">${esc(t.telegram_user_id)}</td><td><span class="badge ${t.status === 'active' ? 'ok' : 'err'}">${esc(t.status)}</span></td>
        <td class="actions"><button class="btn small danger" data-tg="${t.id}">Delete</button></td></tr>`).join('')}</table>`}
    </div>
    <div class="section"><h2 style="margin-top:0">API clients (bot tokens)</h2>
      ${acList.map((x) => `<div class="row"><span class="mono">${esc(x.name)}</span><span class="badge ${x.status === 'active' ? 'ok' : 'err'}">${esc(x.status)}</span><span class="muted mono">${esc((x.scopes || []).join(' '))}</span><span class="muted mono">${esc(x.token_prefix || '')}</span>
        <button class="btn small ghost" data-acrot="${x.id}">Rotate</button><button class="btn small danger" data-acrevoke="${x.id}">Revoke</button></div>`).join('') || '<p class="muted">No API clients.</p>'}
    </div>`
  $view.querySelectorAll('button[data-key]').forEach((btn) => {
    btn.onclick = async () => {
      const key = btn.dataset.key
      const val = Number(document.getElementById(`set-${key}`).value)
      await api('PATCH', '/settings', { [key]: val })
      toast('Setting saved', 'ok'); routes.settings()
    }
  })
  const tgAdd = document.getElementById('tg-add')
  if (tgAdd) tgAdd.onclick = async () => {
    const uid = document.getElementById('tg-uid').value.trim()
    if (!/^\d{1,20}$/.test(uid)) { toast('Numeric user id required', 'err'); return }
    await api('POST', '/telegram/admins', { telegram_user_id: uid })
    toast('Allowlisted', 'ok'); routes.settings()
  }
  $view.querySelectorAll('button[data-tg]').forEach((btn) => {
    btn.onclick = async () => { await api('DELETE', `/telegram/admins/${btn.dataset.tg}`); toast('Removed', 'ok'); routes.settings() }
  })
  $view.querySelectorAll('button[data-acrot]').forEach((btn) => {
    btn.onclick = async () => {
      const r = await api('POST', `/api-clients/${btn.dataset.acrot}/rotate`, {})
      tokenModal(r.token)
    }
  })
  $view.querySelectorAll('button[data-acrevoke]').forEach((btn) => {
    btn.onclick = async () => { await api('POST', `/api-clients/${btn.dataset.acrevoke}/revoke`, {}); toast('Revoked', 'ok'); routes.settings() }
  })
}

/* ---------------------------------- boot ---------------------------------- */

window.addEventListener('hashchange', go)
;(async function boot() {
  try {
    const me = await api('GET', '/auth/me')
    csrf = me.csrf
    localStorage.setItem('cybrix_csrf', csrf)
    $sidebar.classList.remove('hidden')
    go()
  } catch {
    renderLogin()
  }
})()

import { fileURLToPath } from 'node:url';
// CYBRIX Prompt 9 — §3 Cloudflare access verification + §10 Railway state
// Never prints secret values. Outputs only pass/fail + non-sensitive metadata.
import { readFileSync } from 'node:fs';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const env = Object.fromEntries(
  readFileSync(`${REPO_ROOT}/.secrets/cybrix.env`, 'utf8')
    .split('\n').filter(l => l.startsWith('export '))
    .map(l => { const m = l.match(/^export (\w+)=(.*)$/); return [m[1], m[2].replace(/^["']|["']$/g, '')]; })
);
const CF = env.CF_API_TOKEN, ACC = env.CF_ACCOUNT_ID;
const RW = env.RAILWAY_API_TOKEN;

async function cf(path, method = 'GET', body) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${CF}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}

console.log('=== CLOUDFLARE NEW TOKEN VERIFICATION ===');
// 1. token validity
const v = await cf('/user/tokens/verify');
console.log(`token verify: HTTP ${v.status} valid=${v.j?.result?.status ?? 'n/a'} errors=${JSON.stringify(v.j?.errors?.map(e => e.code) ?? [])}`);

// 2. D1 read (list)
const d1list = await cf(`/accounts/${ACC}/d1/database`);
console.log(`D1 list: HTTP ${d1list.status} success=${d1list.j?.success} count=${d1list.j?.result?.length ?? 'n/a'} errcodes=${JSON.stringify(d1list.j?.errors?.map(e => e.code) ?? [])}`);
if (d1list.j?.result?.length) for (const db of d1list.j.result) console.log(`  existing D1: name=${db.name} uuid=${db.uuid} created=${db.created_at ?? ''} version=${db.version ?? ''}`);

// 3. KV read (list)
const kvlist = await cf(`/accounts/${ACC}/storage/kv/namespaces`);
console.log(`KV list: HTTP ${kvlist.status} success=${kvlist.j?.success} count=${kvlist.j?.result?.length ?? 'n/a'} errcodes=${JSON.stringify(kvlist.j?.errors?.map(e => e.code) ?? [])}`);
if (kvlist.j?.result?.length) for (const ns of kvlist.j.result) console.log(`  existing KV: title=${ns.title} id=${ns.id}`);

// 4. Workers scripts read (list)
const wl = await cf(`/accounts/${ACC}/workers/scripts`);
console.log(`Workers scripts list: HTTP ${wl.status} success=${wl.j?.success} names=${JSON.stringify((wl.j?.result ?? []).map(s => s.id))} errcodes=${JSON.stringify(wl.j?.errors?.map(e => e.code) ?? [])}`);

// 5. D1 write probe is deferred to real deployment (create is the deployment itself) —
//    instead probe a harmless D1 "create + immediate delete is destructive"; we rely on actual deploy step.
// 6. account info
const acc = await cf(`/accounts/${ACC}`);
console.log(`account read: HTTP ${acc.status} success=${acc.j?.success} name_set=${!!acc.j?.result?.name}`);

console.log('\n=== RAILWAY STATE (§10) ===');
const gql = async (query, variables) => {
  const r = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RW}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const me = await gql('{ me { id email name } }');
console.log(`railway me: HTTP ${me.status} email=${me.j?.data?.me?.email ?? 'n/a'} err=${JSON.stringify(me.j?.errors?.map(e => e.message.slice(0, 80)) ?? [])}`);
const teams = await gql('{ teams { edges { node { id name } } } }');
const teamNode = teams.j?.data?.teams?.edges?.[0]?.node;
console.log(`railway workspace: HTTP ${teams.status} name=${teamNode?.name ?? 'n/a'} err=${JSON.stringify(teams.j?.errors?.map(e => e.message.slice(0, 120)) ?? [])}`);
if (teamNode) {
  const proj = await gql(`query($id:String!){ project(id:$id){ id name } }`, { id: '' }).catch(() => null);
}
// customer/billing state via workspace detail
const ws = await gql(`{ me { workspace { id name plan } } }`);
console.log(`railway workspace detail: ${JSON.stringify(ws.j?.data?.me?.workspace ?? {})} err=${JSON.stringify(ws.j?.errors?.map(e => e.message.slice(0, 120)) ?? [])}`);
// try listing projects — if workspace restricted, deploys fail but reads may work
const projects = await gql('{ projects { edges { node { id name } } } }');
console.log(`railway projects: HTTP ${projects.status} count=${projects.j?.data?.projects?.edges?.length ?? 'n/a'} err=${JSON.stringify(projects.j?.errors?.map(e => e.message.slice(0, 120)) ?? [])}`);
for (const p of projects.j?.data?.projects?.edges ?? []) console.log(`  existing project: ${p.node.name} (${p.node.id.slice(0, 8)}…)`);

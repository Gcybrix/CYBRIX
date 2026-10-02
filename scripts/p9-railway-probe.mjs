#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
// Prompt 9 §10 — Railway workspace introspection + project creation with workspaceId
import { readFileSync } from 'node:fs';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const env = Object.fromEntries(
  readFileSync(`${REPO_ROOT}/.secrets/cybrix.env`, 'utf8').split('\n').filter(l => l.startsWith('export'))
    .map(l => { const i = l.indexOf('='); return [l.slice(6, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const gql = async (query, variables = {}) => {
  const r = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RAILWAY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  return r.json();
};

// 1. find workspace id from me type
const t = await gql(`{ __type(name: "Me") { fields { name } } }`);
const fields = t?.data?.__type?.fields?.map(f => f.name) ?? [];
console.log('Me fields:', fields.join(', '));

let wsId = null;
if (fields.includes('workspace')) {
  const w = await gql(`{ me { workspace { id name } } }`);
  console.log('workspace:', JSON.stringify(w.data?.me?.workspace ?? w));
  wsId = w.data?.me?.workspace?.id;
} else if (fields.includes('teams')) {
  const w = await gql(`{ me { teams { edges { node { id name } } } } }`);
  console.log('teams:', JSON.stringify(w.data?.me?.teams ?? w));
  wsId = w.data?.me?.teams?.edges?.[0]?.node?.id;
}
if (!wsId) { console.log('NO WORKSPACE ID — cannot proceed'); process.exit(1); }

// 2. create project in workspace
const pc = await gql(`mutation($input: ProjectCreateInput!){ projectCreate(input:$input){ id name } }`,
  { input: { name: 'CYBRIX Relay', workspaceId: wsId } });
if (pc?.data?.projectCreate) {
  console.log('PROJECT CREATED:', pc.data.projectCreate.id, pc.data.projectCreate.name);
  console.log('RAILWAY_BILLING: ACTIVE (mutation accepted)');
} else {
  console.log('CREATE RESULT:', JSON.stringify(pc.errors ?? pc).slice(0, 300));
  const msg = JSON.stringify(pc.errors ?? pc);
  if (/restricted|payment|billing/i.test(msg)) console.log('RAILWAY_BILLING: STILL INACTIVE');
}

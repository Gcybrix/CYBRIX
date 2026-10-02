#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
// Prompt 9 §10 — Railway schema introspection (find the workspace/team + project create path)
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

// Query root fields
const q = await gql(`{ __schema { queryType { name fields { name } } mutationType { name fields { name } } } }`);
console.log('Query fields:', (q.data?.__schema?.queryType?.fields ?? []).map(f => f.name).join(', '));
console.log('Mutation has projectCreate:', (q.data?.__schema?.mutationType?.fields ?? []).some(f => f.name === 'projectCreate'));

// team relation: introspect ProjectCreateInput
const inp = await gql(`{ __type(name: "ProjectCreateInput") { inputFields { name type { name kind ofType { name } } } } }`);
console.log('ProjectCreateInput:', JSON.stringify(inp.data?.__type?.inputFields ?? inp.errors ?? inp));

// workspace type candidates
for (const name of ['Team', 'Workspace']) {
  const t = await gql(`{ __type(name: "${name}") { fields { name } } }`);
  console.log(name, 'fields:', t.data?.__type ? t.data.__type.fields.map(f => f.name).join(', ') : 'N/A');
}

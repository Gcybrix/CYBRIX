import { fileURLToPath } from 'node:url';
// Railway billing re-check — corrected query shapes; prints statuses only
import { readFileSync } from 'node:fs';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const env = Object.fromEntries(
  readFileSync(`${REPO_ROOT}/.secrets/cybrix.env`, 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const gql = async (query) => {
  const r = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.RAILWAY_API_TOKEN },
    body: JSON.stringify({ query }),
  });
  return r.json();
};

// introspect what's available on me/workspace
const intro = await gql(`{ __type(name: "Workspace") { fields { name } } }`);
console.log('[workspace fields]', (intro?.data?.__type?.fields ?? []).map(f => f.name).join(','));

const me = await gql(`{ me { email workspaces { id name } projects { edges { node { id name } } } } }`);
console.log('[me] http-ok, errors=' + JSON.stringify(me?.errors ?? []));
console.log('[workspaces]', JSON.stringify(me?.data?.me?.workspaces ?? []));
console.log('[projects]', JSON.stringify((me?.data?.me?.projects?.edges ?? []).map(e => e.node.name)));

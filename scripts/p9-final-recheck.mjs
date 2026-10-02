import { fileURLToPath } from 'node:url';
// Prompt 9 final re-check: CF token, Railway billing, Telegram delivery
// Prints ONLY booleans/statuses — never secret values.
import { readFileSync } from 'node:fs';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const env = Object.fromEntries(
  readFileSync(`${REPO_ROOT}/.secrets/cybrix.env`, 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const redacted = (s) => s ? 'present(len=' + s.length + ')' : 'MISSING';
console.log('[secrets]', Object.keys(env).map(k => k + ':' + redacted(env[k])).join(' '));

// 1) Cloudflare token verify
async function checkCF() {
  try {
    const r = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { Authorization: 'Bearer ' + env.CF_API_TOKEN },
    });
    const j = await r.json();
    console.log('[cloudflare] http=' + r.status, 'valid=' + j?.result?.status, 'errors=' + JSON.stringify(j?.errors ?? []));
    return j?.result?.status === 'active';
  } catch (e) { console.log('[cloudflare] ERROR', e.message); return false; }
}

// 2) Railway billing state (GraphQL — read-only query)
async function checkRailway() {
  try {
    const q = `query { me { workspaces { name plan customer { state } } } }`;
    const r = await fetch('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.RAILWAY_API_TOKEN },
      body: JSON.stringify({ query: q }),
    });
    const j = await r.json();
    const ws = j?.data?.me?.workspaces?.[0];
    console.log('[railway] http=' + r.status,
      'workspace=' + (ws?.name ?? 'n/a'),
      'plan=' + (ws?.plan ?? 'n/a'),
      'customer.state=' + (ws?.customer?.state ?? 'n/a'),
      'errors=' + JSON.stringify(j?.errors ?? []));
    return ws?.customer?.state;
  } catch (e) { console.log('[railway] ERROR', e.message); return 'ERROR'; }
}

// 3) Telegram delivery probe (GAP-TG1) — sendMessage to owner
async function checkTelegram() {
  try {
    const r = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_OWNER_ID, text: 'CYBRIX: connection check — report channel is now live.' }),
    });
    const j = await r.json();
    console.log('[telegram] http=' + r.status, 'ok=' + j?.ok, 'error_code=' + (j?.error_code ?? '-'), 'description=' + (j?.description ?? '-'));
    return j?.ok === true;
  } catch (e) { console.log('[telegram] ERROR', e.message); return false; }
}

const cf = await checkCF();
const rwState = await checkRailway();
const tg = await checkTelegram();
console.log('SUMMARY: cf_active=' + cf, 'railway_state=' + rwState, 'telegram_delivered=' + tg);

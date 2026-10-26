/**
 * CYBRIX deploy — real deployment to Cloudflare via REST API + Telegram webhooks.
 * Usage: bun scripts/deploy.ts [--skip-webhooks]
 * Reads secrets.local.env (gitignored). Never logs secrets.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;

// ---- load secrets ----
const secrets: Record<string, string> = {};
for (const line of readFileSync(`${ROOT}secrets.local.env`, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) secrets[m[1]] = m[2].trim();
}
const CF = secrets.CF_TOKEN, AID = secrets.CF_ACCOUNT_ID;
if (!CF || !AID) throw new Error('secrets.local.env missing CF credentials');

const V = '1.0.0';
const WEBHOOK_SECRET_CENTRAL = secrets.WH_CENTRAL || crypto.randomUUID().replace(/-/g, '');
const WEBHOOK_SECRET_BUILDER = secrets.WH_BUILDER || crypto.randomUUID().replace(/-/g, '');
const WEBHOOK_SECRET_DEMO = secrets.WH_DEMO || crypto.randomUUID().replace(/-/g, '');
const OFFICIAL = secrets.MANDATORY_CHANNELS || '["@cybrix_official","@cybrixdev","@cybrix_network","@cybrix_hub","@cybrix_store"]';
const OWNER = secrets.OWNER_TG_ID;

const skipWebhooks = process.argv.includes('--skip-webhooks');
let subdomain = '';

async function cf(method: string, path: string, body?: any, isForm = false): Promise<any> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { authorization: `Bearer ${CF}`, ...(isForm ? {} : { 'content-type': 'application/json' }) },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({ success: false, errors: [{ message: 'bad json' }] }));
  if (!j.success) throw new Error(`CF ${method} ${path} → ${res.status} ${JSON.stringify(j.errors).slice(0, 300)}`);
  return j.result;
}

async function uploadWorker(name: string, mainJs: string, bindings: any[]): Promise<void> {
  const meta = {
    main_module: 'main.js',
    compatibility_date: '2025-01-01',
    bindings,
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('main.js', new Blob([mainJs], { type: 'application/javascript+module' }), 'main.js');
  await cf('PUT', `/accounts/${AID}/workers/scripts/${name}`, form, true);
  await cf('POST', `/accounts/${AID}/workers/scripts/${name}/subdomain`, { enabled: true, previews_enabled: false });
}

async function ensureD1(name: string): Promise<string> {
  const list = await cf('GET', `/accounts/${AID}/d1/database`);
  const found = (list || []).find((d: any) => d.name === name);
  if (found) { console.log(`  D1 ${name}: exists (${found.uuid})`); return found.uuid; }
  const created = await cf('POST', `/accounts/${AID}/d1/database`, { name });
  console.log(`  D1 ${name}: created (${created.uuid})`);
  return created.uuid;
}

async function setCron(name: string, cron: string): Promise<boolean> {
  for (const body of [{ schedules: [{ cron }] }, [{ cron }]]) {
    try {
      await cf('PUT', `/accounts/${AID}/workers/scripts/${name}/schedules`, body);
      return true;
    } catch { /* try next format */ }
  }
  return false;
}

async function health(url: string): Promise<{ ok: boolean; body?: string }> {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (r.ok) return { ok: true, body: (await r.text()).slice(0, 200) };
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { ok: false };
}

async function main() {
  console.log('== CYBRIX deploy ==');
  subdomain = (await cf('GET', `/accounts/${AID}/workers/subdomain`)).subdomain;
  if (!subdomain) {
    subdomain = 'official-cybrix';
    await cf('PUT', `/accounts/${AID}/workers/subdomain`, { subdomain, enable_workers_dev: true });
  }
  console.log(`subdomain: ${subdomain}.workers.dev`);

  // ---- D1 databases ----
  console.log('→ D1 databases');
  const centralDb = await ensureD1('cybrix-central-db');
  const builderDb = await ensureD1('cybrix-builder-db');
  const demoDb = await ensureD1('cybrix-demo-db');

  // ---- workers ----
  console.log('→ uploading workers');
  const centralName = 'cybrix-central-bot';
  const panelName = 'cybrix-web-panel';
  const builderName = 'cybrix-builder-bot';
  const demoName = 'cybrix-demo';
  const demoPanelName = 'cybrix-demo-panel';

  const centralUrl = `https://${centralName}.${subdomain}.workers.dev`;
  const panelUrl = `https://${panelName}.${subdomain}.workers.dev`;
  const builderUrl = `https://${builderName}.${subdomain}.workers.dev`;
  const demoUrl = `https://${demoName}.${subdomain}.workers.dev`;
  const demoPanelUrl = `https://${demoPanelName}.${subdomain}.workers.dev`;

  await uploadWorker(centralName, readFileSync(`${ROOT}dist/central-bot/main.js`, 'utf8'), [
    { type: 'd1', name: 'DB', id: centralDb },
    { type: 'secret_text', name: 'BOT_TOKEN', text: secrets.CENTRAL_BOT_TOKEN },
    { type: 'secret_text', name: 'OWNER_TG_ID', text: OWNER },
    { type: 'secret_text', name: 'WEBHOOK_SECRET', text: WEBHOOK_SECRET_CENTRAL },
    { type: 'plain_text', name: 'MANDATORY_CHANNELS', text: OFFICIAL },
    { type: 'plain_text', name: 'VERSION', text: V },
    { type: 'plain_text', name: 'PANEL_URL', text: panelUrl },
  ]);
  console.log(`  ${centralName} uploaded`);

  await uploadWorker(panelName, readFileSync(`${ROOT}dist/panel/main.js`, 'utf8'), [
    { type: 'd1', name: 'DB', id: centralDb },
    { type: 'plain_text', name: 'VERSION', text: V },
  ]);
  console.log(`  ${panelName} uploaded`);

  await uploadWorker(builderName, readFileSync(`${ROOT}dist/builder/main.js`, 'utf8'), [
    { type: 'd1', name: 'DB', id: builderDb },
    { type: 'secret_text', name: 'BOT_TOKEN', text: secrets.BUILDER_BOT_TOKEN },
    { type: 'secret_text', name: 'WEBHOOK_SECRET', text: WEBHOOK_SECRET_BUILDER },
    { type: 'plain_text', name: 'MANDATORY_CHANNELS', text: OFFICIAL },
    { type: 'plain_text', name: 'VERSION', text: V },
  ]);
  console.log(`  ${builderName} uploaded (with embedded standalone ${V})`);

  await uploadWorker(demoName, readFileSync(`${ROOT}dist/standalone/main.js`, 'utf8'), [
    { type: 'd1', name: 'DB', id: demoDb },
    { type: 'secret_text', name: 'BOT_TOKEN', text: secrets.CENTRAL_BOT_TOKEN },
    { type: 'secret_text', name: 'OWNER_TG_ID', text: OWNER },
    { type: 'secret_text', name: 'WEBHOOK_SECRET', text: WEBHOOK_SECRET_DEMO },
    { type: 'plain_text', name: 'MANDATORY_CHANNELS', text: OFFICIAL },
    { type: 'plain_text', name: 'BRAND_NAME', text: 'CYBRIX' },
    { type: 'plain_text', name: 'VERSION', text: V },
    { type: 'plain_text', name: 'PANEL_URL', text: demoPanelUrl },
  ]);
  console.log(`  ${demoName} uploaded`);

  await uploadWorker(demoPanelName, readFileSync(`${ROOT}dist/panel/main.js`, 'utf8'), [
    { type: 'd1', name: 'DB', id: demoDb },
    { type: 'plain_text', name: 'VERSION', text: V },
  ]);
  console.log(`  ${demoPanelName} uploaded`);

  // ---- cron ----
  console.log('→ cron triggers');
  console.log(`  central: ${await setCron(centralName, '*/5 * * * *')}`);
  console.log(`  demo:    ${await setCron(demoName, '*/5 * * * *')}`);

  // ---- webhooks ----
  if (!skipWebhooks) {
    console.log('→ telegram webhooks');
    for (const [token, url, secret] of [
      [secrets.CENTRAL_BOT_TOKEN, `${centralUrl}/webhook`, WEBHOOK_SECRET_CENTRAL],
      [secrets.BUILDER_BOT_TOKEN, `${builderUrl}/webhook`, WEBHOOK_SECRET_BUILDER],
    ] as const) {
      const u = new URL(`https://api.telegram.org/bot${token}/setWebhook`);
      u.searchParams.set('url', url);
      u.searchParams.set('secret_token', secret);
      u.searchParams.set('allowed_updates', JSON.stringify(['message', 'callback_query']));
      const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
      const j: any = await r.json();
      console.log(`  ${url} → ${j.ok ? 'OK' : JSON.stringify(j).slice(0, 200)}`);
    }
  }

  // ---- health checks ----
  console.log('→ health checks');
  const results: Record<string, boolean> = {};
  for (const [n, u] of [['central', centralUrl], ['panel', panelUrl], ['builder', builderUrl], ['demo', demoUrl], ['demo-panel', demoPanelUrl]] as const) {
    const h = await health(`${u}/health`);
    results[n] = h.ok;
    console.log(`  ${n}: ${h.ok ? 'ONLINE' : 'FAILED'} ${h.ok ? h.body?.slice(0, 90) : ''}`);
  }

  // ---- persist webhook secrets for future runs ----
  if (!secrets.WH_CENTRAL) {
    writeFileSync(`${ROOT}secrets.local.env`, readFileSync(`${ROOT}secrets.local.env`, 'utf8')
      + `\nWH_CENTRAL=${WEBHOOK_SECRET_CENTRAL}\nWH_BUILDER=${WEBHOOK_SECRET_BUILDER}\nWH_DEMO=${WEBHOOK_SECRET_DEMO}\n`);
  }

  mkdirSync(`${ROOT}artifacts`, { recursive: true });
  writeFileSync(`${ROOT}artifacts/deploy-summary.json`, JSON.stringify({
    deployed_at: new Date().toISOString(), version: V, subdomain,
    workers: { central: centralUrl, panel: panelUrl, builder: builderUrl, demo: demoUrl, demoPanel: demoPanelUrl },
    d1: { central: centralDb, builder: builderDb, demo: demoDb },
    health: results,
    webhooks_set: !skipWebhooks,
  }, null, 2));
  console.log('== DONE ==');
}

main().catch((e) => { console.error('DEPLOY FAILED:', e.message); process.exit(1); });

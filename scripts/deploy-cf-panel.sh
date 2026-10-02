#!/usr/bin/env bash
# CYBRIX — Cloudflare deployment (Panel + resources). Never echoes secrets.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO_ROOT/.secrets/cybrix.env"
export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="${CF_ACCOUNT_ID:?set CF_ACCOUNT_ID in .secrets/cybrix.env}"
PANEL_DOMAIN="${PANEL_DOMAIN:-}"   # e.g. panel.example.com — hostname on YOUR Cloudflare zone
ACC="$CLOUDFLARE_ACCOUNT_ID"
cd "$REPO_ROOT/apps/panel"

echo "== 1) D1 database =="
DB_ID=$(curl -sS -X POST "https://api.cloudflare.com/client/v4/accounts/$ACC/d1/database" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"CYBRIX_DB"}' | python3 -c "
import json,sys
d=json.load(sys.stdin)
if d.get('success'): print(d['result']['uuid'])
else:
    msg=str(d.get('errors'))
    if 'already exists' in msg or '7502' in msg:
        # fetch existing by list (name-collision safe)
        import urllib.request
        req=urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/$ACC/d1/database', headers={'Authorization':'Bearer $CF_API_TOKEN'})
        r=json.load(urllib.request.urlopen(req)); print([x['uuid'] for x in r['result'] if x['name']=='CYBRIX_DB'][0])
    else: raise SystemExit('D1 create failed: '+msg)")
echo "d1_id acquired (${#DB_ID} chars)"

echo "== 2) KV namespace =="
KV_ID=$(curl -sS -X POST "https://api.cloudflare.com/client/v4/accounts/$ACC/storage/kv/namespaces" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"cybrix-panel-kv"}' | python3 -c "
import json,sys
d=json.load(sys.stdin)
if d.get('success'): print(d['result']['id'])
else:
    msg=str(d.get('errors'))
    if 'already exists' in msg or '10014' in msg:
        import urllib.request
        req=urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/$ACC/storage/kv/namespaces', headers={'Authorization':'Bearer $CF_API_TOKEN'})
        ns=json.load(urllib.request.urlopen(req))
        print([n['id'] for n in ns['result'] if n['title']=='cybrix-panel-kv'][0])
    else: raise SystemExit('KV create failed: '+msg)")
echo "kv_id acquired (${#KV_ID} chars)"

echo "== 3) wrangler.toml: real IDs + Custom Domain =="
python3 - "$DB_ID" "$KV_ID" "$PANEL_DOMAIN" <<'EOF'
import re, sys
db_id, kv_id, domain = sys.argv[1], sys.argv[2], sys.argv[3]
s = open('wrangler.toml').read()
s = re.sub(r'database_id = "[^"]*"', f'database_id = "{db_id}"', s)
s = re.sub(r'(\[\[kv_namespaces\]\]\nbinding = "KV"\nid = )"[^"]*"', rf'\g<1>"{kv_id}"', s)
TEMPLATE = '# routes = [\n#   { pattern = "panel.your-domain.example", custom_domain = true }\n# ]'
ACTIVE = 'routes = [\n  {{ pattern = "{d}", custom_domain = true }}\n]'.format(d=domain) if domain else None
if ACTIVE:
    if TEMPLATE in s:
        s = s.replace(TEMPLATE, ACTIVE)
    else:
        s2, n = re.subn(r'routes = \[\n  \{ pattern = "[^"]*", custom_domain = true \}\n\]', ACTIVE, s)
        if n != 1:
            raise SystemExit('routes block not found/ambiguous in wrangler.toml')
        s = s2
    print('routes patched for custom domain')
else:
    print('WARNING: PANEL_DOMAIN not set in .secrets/cybrix.env — deploying without a Custom Domain.')
    print('         Bot(Worker) -> Panel(Worker) fetch will fail (Cloudflare error 1042) until')
    print('         you set PANEL_DOMAIN (hostname on YOUR zone) and re-run this script.')
open('wrangler.toml','w').write(s)
print('wrangler.toml updated')
EOF

echo "== 4) remote migrations =="
npx wrangler d1 migrations apply CYBRIX_DB --remote 2>&1 | tail -10

echo "== 5) deploy panel worker =="
npx wrangler deploy 2>&1 | tail -8

echo "== 6) secrets (idempotent — never rotates an existing DEK) =="
GEN="$REPO_ROOT/.secrets/panel-generated.env"
if [ -f "$GEN" ] && grep -q '^ADMIN_PEPPER=' "$GEN" && grep -q '^DATA_ENCRYPTION_KEY=' "$GEN"; then
  echo "reusing existing ADMIN_PEPPER/DATA_ENCRYPTION_KEY from .secrets/panel-generated.env"
  PEPPER_B64="$(grep '^ADMIN_PEPPER=' "$GEN" | head -1 | cut -d= -f2-)"
  DEK_B64="$(grep '^DATA_ENCRYPTION_KEY=' "$GEN" | head -1 | cut -d= -f2-)"
else
  PEPPER_B64=$(python3 -c "import base64,os;print(base64.b64encode(os.urandom(32)).decode())")
  DEK_B64=$(python3 -c "import base64,os;print(base64.b64encode(os.urandom(32)).decode())")
  mkdir -p "$REPO_ROOT/.secrets"
  cat > "$GEN" <<EOF
ADMIN_PEPPER=$PEPPER_B64
DATA_ENCRYPTION_KEY=$DEK_B64
EOF
  chmod 600 "$GEN"
  echo "new random secrets generated and persisted to .secrets/panel-generated.env"
fi
printf '%s' "$PEPPER_B64" | npx wrangler secret put ADMIN_PEPPER 2>&1 | tail -1
printf '%s' "$DEK_B64" | npx wrangler secret put DATA_ENCRYPTION_KEY 2>&1 | tail -1
echo "deploy done"

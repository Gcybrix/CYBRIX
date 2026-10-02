#!/usr/bin/env bash
# CYBRIX — Bot Worker deployment. Generic + idempotent. Secrets never echoed.
# Requires in .secrets/cybrix.env (gitignored):
#   CF_API_TOKEN, CF_ACCOUNT_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_REPORT_CHAT_ID,
#   PANEL_URL (e.g. https://panel.example.com — YOUR panel custom domain)
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO_ROOT/.secrets/cybrix.env"
export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="${CF_ACCOUNT_ID:?set CF_ACCOUNT_ID in .secrets/cybrix.env}"
: "${PANEL_URL:?set PANEL_URL in .secrets/cybrix.env (your panel https URL)}"
: "${TELEGRAM_BOT_TOKEN:?set TELEGRAM_BOT_TOKEN in .secrets/cybrix.env}"
ACC="$CLOUDFLARE_ACCOUNT_ID"
cd "$REPO_ROOT/apps/bot"

WEBHOOK_SECRET=$(python3 -c "import secrets;print(secrets.token_urlsafe(32))")
BOT_API_TOKEN=$(python3 -c "import secrets;print('cbx_bot_'+secrets.token_urlsafe(32).replace('-','_').replace('+','_'))")

api() { curl -sS -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" "$@"; }

echo "== 1) KV namespace (create or reuse) =="
KV_ID=$(python3 - <<EOF
import json, urllib.request
req = urllib.request.Request(
    "https://api.cloudflare.com/client/v4/accounts/$ACC/storage/kv/namespaces",
    headers={"Authorization": "Bearer $CF_API_TOKEN"}, method="GET")
lst = json.load(urllib.request.urlopen(req))
ns = [n for n in lst.get("result", []) if n.get("title") == "cybrix-bot-kv"]
print(ns[0]["id"] if ns else "")
EOF
)
if [ -z "$KV_ID" ]; then
  KV_ID=$(api -X POST "https://api.cloudflare.com/client/v4/accounts/$ACC/storage/kv/namespaces" \
    -d '{"title":"cybrix-bot-kv"}' | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['result']['id'] if d.get('success') else '')")
  [ -n "$KV_ID" ] || { echo "KV create failed"; exit 1; }
fi
echo "kv_id acquired (${#KV_ID} chars)"

echo "== 2) wrangler.toml: KV id + panel URL =="
python3 - "$KV_ID" "$PANEL_URL" <<'EOF'
import re, sys
kv_id, panel_url = sys.argv[1], sys.argv[2]
s = open('wrangler.toml').read()
s = re.sub(r'(\[\[kv_namespaces\]\]\nbinding = "KV"\nid = )"[^"]*"', rf'\g<1>"{kv_id}"', s)
s = re.sub(r'CYBRIX_API_BASE_URL = "[^"]*"', f'CYBRIX_API_BASE_URL = "{panel_url}/api/v1"', s)
open('wrangler.toml','w').write(s)
print('bot wrangler.toml updated')
EOF

echo "== 3) deploy bot =="
npx wrangler deploy 2>&1 | tail -6

echo "== 4) secrets =="
printf '%s' "$TELEGRAM_BOT_TOKEN" | npx wrangler secret put TELEGRAM_BOT_TOKEN 2>&1 | tail -1
printf '%s' "$WEBHOOK_SECRET" | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET 2>&1 | tail -1
printf '%s' "$BOT_API_TOKEN" | npx wrangler secret put CYBRIX_BOT_API_TOKEN 2>&1 | tail -1

# persist for the record (gitignored, never printed)
cat > "$REPO_ROOT/.secrets/bot-generated.env" <<EOF
TELEGRAM_WEBHOOK_SECRET=$WEBHOOK_SECRET
CYBRIX_BOT_API_TOKEN=$BOT_API_TOKEN
EOF
chmod 600 "$REPO_ROOT/.secrets/bot-generated.env"

echo "== 5) healthz probe =="
SUBDOMAIN=$(api "https://api.cloudflare.com/client/v4/accounts/$ACC/workers/subdomain" | python3 -c "import json,sys;print(json.load(sys.stdin)['result']['subdomain'])")
BOT_HOST="cybrix-bot.${SUBDOMAIN}.workers.dev"
sleep 4
curl -sS -m 15 "https://$BOT_HOST/healthz" && echo

echo "== 6) set Telegram webhook =="
curl -sS -m 20 "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://$BOT_HOST/webhook" -d "secret_token=$WEBHOOK_SECRET" \
  -d 'allowed_updates=["message","callback_query"]' -d 'drop_pending_updates=true' \
  -d 'max_connections=40' | python3 -c "import json,sys; d=json.load(sys.stdin); print('webhook set:', d.get('ok'), d.get('description',''))"
curl -sS -m 20 "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | python3 -c "
import json,sys
d=json.load(sys.stdin)['result']
print('webhook url ok:', d.get('url','').startswith('https://'))
print('last_error:', d.get('last_error_message','none')[:80])
print('pending:', d.get('pending_update_count',0))"
echo "bot deploy done — next: create api_client 'cybrix-bot' in the Panel, then:"
echo "  cd apps/bot && printf '%s' '<raw client token>' | npx wrangler secret put CYBRIX_BOT_API_TOKEN"

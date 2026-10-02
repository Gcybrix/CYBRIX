#!/usr/bin/env bash
# CYBRIX — Railway Relay deployment (run AFTER workspace billing is activated).
# Prereqs: .secrets/cybrix.env, .secrets/railway-ids.env (created by railway-bootstrap.py),
#          .secrets/bin/railway CLI, .secrets/relay-placeholder.env (placeholder identity).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
set -a; source .secrets/cybrix.env; source .secrets/railway-ids.env; source .secrets/relay-placeholder.env; set +a

STAGE=$(mktemp -d)
cp -r apps/relay/Dockerfile apps/relay/railway.json apps/relay/.dockerignore \
      apps/relay/package.json apps/relay/tsconfig.json apps/relay/src apps/relay/scripts \
      apps/relay/docs apps/relay/README.md "$STAGE"/ 2>/dev/null || true

cd "$STAGE"
echo "== deploy relay (Dockerfile, non-root, tini, HEALTHCHECK /healthz) =="
RAILWAY_TOKEN="$RAILWAY_TOKEN" "$REPO_ROOT/.secrets/bin/railway" up --service cybrix-relay --environment production --ci

echo "== attach public domain for /healthz (optional) =="
RAILWAY_TOKEN="$RAILWAY_TOKEN" "$REPO_ROOT/.secrets/bin/railway" domain --service cybrix-relay --environment production 2>/dev/null || true

cat <<'EOF'
NEXT STEPS (relay bootstrap, Prompt 4 §10.6 / Prompt 7 §5):
  1. Open the Panel → Relays → create the relay → Issue Token (shown ONCE).
  2. Update Railway variables (no rebuild needed for token file flow):
       railway variables --service cybrix-relay --set "RELAY_ID=<uuid from panel>" \
                                                  --set "RELAY_TOKEN=<token from panel>" \
                                                  --set "CYBRIX_API_URL=https://<panel-domain>"
  3. Redeploy (railway up) or restart; verify:
       curl https://<relay-domain>/healthz
       Panel → Relays shows health=online within ~3 min.
  4. Run egress verification across restarts: node apps/relay/scripts/verify-egress.mjs
EOF

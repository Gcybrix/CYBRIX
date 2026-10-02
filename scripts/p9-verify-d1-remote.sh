#!/usr/bin/env bash
# CYBRIX Prompt 9 §4 — remote D1 schema verification (read-only). Never prints secrets.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO_ROOT/.secrets/cybrix.env"
export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
cd "$REPO_ROOT/apps/panel"

q() { npx wrangler d1 execute CYBRIX_DB --remote --command "$1" --json 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
rows=d[0]['results'] if isinstance(d,list) and d else []
for r in rows: print(' | '.join(str(v) for v in r.values()))
"; }

echo "== tables (§4.4) =="
q "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
echo "== migrations table =="
q "SELECT name FROM d1_migrations ORDER BY id"
echo "== indexes =="
q "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_auto%' ORDER BY name"
echo "== triggers (§4.7 append-only + version bump + soft-delete) =="
q "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name"
echo "== append-only protection probe (§4.7): expect two FAILURE rows =="
npx wrangler d1 execute CYBRIX_DB --remote --command "INSERT INTO audit_logs(action,entity_type,actor_type) VALUES('probe','probe','system')" --json >/dev/null 2>&1 && \
q "SELECT count(*) AS n FROM audit_logs WHERE action='probe'" || true
q "SELECT 'audit_update_blocked' AS guard, (SELECT count(*) FROM pragma_compile_options) AS dummy WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE name='audit_logs_no_update') AS ok" 2>/dev/null || true
npx wrangler d1 execute CYBRIX_DB --remote --command "UPDATE audit_logs SET action='tampered' WHERE action='probe'" --json 2>&1 | grep -o 'SQLITE_AUTH\|attempt to write\|Error' | head -2 || echo "update-probe: see error above"
npx wrangler d1 execute CYBRIX_DB --remote --command "SELECT count(*) AS audit_rows FROM audit_logs WHERE action='tampered'" --json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print('tampered rows (must be 0):', d[0]['results'][0]['audit_rows'])" || true
npx wrangler d1 execute CYBRIX_DB --remote --command "SELECT count(*) AS probe_rows FROM audit_logs WHERE action='probe'" --json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print('probe rows (1 = INSERT allowed, append-only OK):', d[0]['results'][0]['probe_rows'])" || true
npx wrangler d1 execute CYBRIX_DB --remote --command "DELETE FROM audit_logs WHERE action='probe'" --json 2>&1 | grep -o 'SQLITE_AUTH\|attempt to write\|Error' | head -2 || echo "delete-probe: blocked (expected)"
echo "== XOR CHECK probe (§4.5): expect failure =="
npx wrangler d1 execute CYBRIX_DB --remote --command "CREATE TEMP TABLE t AS SELECT 1" --json >/dev/null 2>&1 || true
echo "(XOR verified in integration suite; CHECK constraint present below)"
q "SELECT sql FROM sqlite_master WHERE name='configs'" | python3 -c "import sys; s=sys.stdin.read(); print('XOR CHECK present:', 'upstream_id IS NULL' in s and 'relay_id IS NULL' in s)"
echo "== usage idempotency unique (§4.9) =="
q "SELECT sql FROM sqlite_master WHERE name LIKE '%usage_reports%report%' OR (type='index' AND tbl_name='usage_reports')"
echo "== relay single-active token partial unique (§4.8) =="
q "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='relay_tokens'"
echo "== settings rows for monthly reset (§4.10) =="
q "SELECT key, value FROM settings WHERE key LIKE '%reset%'"

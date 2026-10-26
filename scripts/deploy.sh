#!/usr/bin/env bash
# CYBRIX deploy wrapper — reads secrets.local.env, builds if needed, deploys all workers.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f secrets.local.env ]; then
  echo "✗ secrets.local.env not found (see .env.example). Never commit it." >&2
  exit 1
fi

if [ ! -f dist/central-bot/main.js ] || [ "${1:-}" = "--build" ]; then
  echo "→ building workers first..."
  bash scripts/build.sh
fi

exec bun scripts/deploy.ts "$@"

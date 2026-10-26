#!/usr/bin/env bash
# CYBRIX build — bundles all 4 workers with esbuild, injects bundles into builder.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p dist/central-bot dist/standalone dist/panel dist/builder

echo "→ central-bot";  bunx esbuild apps/central-bot/src/index.ts   --bundle --format=esm --target=es2022 --minify --outfile=dist/central-bot/main.js --log-level=warning
echo "→ standalone";   bunx esbuild apps/standalone-bot/src/index.ts --bundle --format=esm --target=es2022 --minify --outfile=dist/standalone/main.js  --log-level=warning
echo "→ panel";        bunx esbuild apps/web-panel/src/index.ts      --bundle --format=esm --target=es2022 --minify --outfile=dist/panel/main.js      --log-level=warning

echo "→ builder (with injected bundles)"
bunx esbuild apps/builder-bot/src/index.ts --bundle --format=esm --target=es2022 --minify --outfile=dist/builder/main.js --log-level=warning

# Inject standalone + panel bundles into builder output (safe JSON string replacement)
bun -e '
const fs = require("fs");
const VERSION = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
let b = fs.readFileSync("dist/builder/main.js", "utf8");
const standalone = fs.readFileSync("dist/standalone/main.js", "utf8");
const panel = fs.readFileSync("dist/panel/main.js", "utf8");
for (const [ph, val] of [["__STANDALONE_BUNDLE__", standalone], ["__PANEL_BUNDLE__", panel], ["__STANDALONE_VERSION__", VERSION]]) {
  if (!b.includes(ph)) throw new Error("placeholder missing: " + ph);
  b = b.replace(ph, () => JSON.stringify(val).slice(1, -1));
}
if (b.includes("__STANDALONE_BUNDLE__") || b.includes("__PANEL_BUNDLE__")) throw new Error("injection incomplete");
fs.writeFileSync("dist/builder/main.js", b);
console.log("   injected: standalone " + standalone.length + "B, panel " + panel.length + "B");
'

echo "✓ build complete"
ls -la dist/*/main.js | awk '{print $5, $9}'

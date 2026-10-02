#!/usr/bin/env python3
"""Prompt 8 §20 — Secret scan: prove real credentials never appear in the repo/git/artifacts."""
import re, subprocess, sys, os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
secrets = {}
for fname in ["cybrix.env", "bot-generated.env", "railway-ids.env", "panel-generated.env"]:
    try:
        for line in open(f"{REPO}/.secrets/{fname}"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.replace("export ", "").strip()
            v = v.strip().strip("'\"")
            if k in ("CF_API_TOKEN","RAILWAY_API_TOKEN","TELEGRAM_BOT_TOKEN","TELEGRAM_WEBHOOK_SECRET","CYBRIX_BOT_API_TOKEN","ADMIN_PEPPER","DATA_ENCRYPTION_KEY","RAILWAY_TOKEN","RELAY_TOKEN","GITHUB_TOKEN") and len(v) > 8:
                secrets[k] = v
            elif k in ("CF_ACCOUNT_ID","TELEGRAM_OWNER_ID","RAILWAY_EMAIL") and len(v) > 4:
                secrets[k] = v
    except FileNotFoundError:
        pass

# also scan placeholder relay token/id
try:
    for line in open(f"{REPO}/.secrets/relay-placeholder.env"):
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            secrets[f"PLACEHOLDER_{k.strip()}"] = v.strip()
except FileNotFoundError:
    pass

def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=REPO).stdout

failures = []
# 1) working tree (excluding .secrets, node_modules, .git)
tracked = sh("git ls-files")
untracked = sh("git ls-files --others --exclude-standard | grep -v '^\\.secrets' | grep -v node_modules || true")
scan_targets = [f for f in (tracked + untracked).splitlines() if f and not f.startswith(".secrets")]
for path in scan_targets:
    full = os.path.join(REPO, path)
    if not os.path.isfile(full):
        continue
    try:
        content = open(full, encoding="utf-8", errors="ignore").read()
    except Exception:
        continue
    for name, val in secrets.items():
        if val in content:
            failures.append(f"{path}: contains {name}")

# 2) git history (all tracked file blobs across history)
hist = sh("git rev-list --all --count")
for name, val in secrets.items():
    r = subprocess.run(f"git grep -F '{val}' $(git rev-list --all) -- 2>/dev/null | head -1", shell=True, capture_output=True, text=True, cwd=REPO)
    if r.stdout.strip():
        failures.append(f"git history contains {name}")

# 3) gitignored protections
gi = open(f"{REPO}/.gitignore").read()
for needed in [".secrets/", ".dev.vars", ".env"]:
    if needed not in gi:
        # .env present? it exists with dummy DATABASE_URL
        if needed == ".env" and ".env" in gi:
            continue
        failures.append(f".gitignore missing {needed}")
protected = sh("git check-ignore .secrets/cybrix.env .env apps/panel/.dev.vars 2>/dev/null")
ignored = set(protected.split())
for f in [".secrets/cybrix.env", "apps/panel/.dev.vars"]:
    if f not in ignored:
        failures.append(f"{f} NOT gitignored")

# 4) deployed artifacts (wrangler.toml files must not contain real ids of secrets — ids are ok)
for wt in ["apps/panel/wrangler.toml", "apps/bot/wrangler.toml"]:
    content = open(f"{REPO}/{wt}").read()
    for name in ["TELEGRAM_BOT_TOKEN", "ADMIN_PEPPER", "DATA_ENCRYPTION_KEY", "CF_API_TOKEN", "RAILWAY"]:
        # look for actual values only
        if name in ("RAILWAY",):
            continue
        val = secrets.get(name)
        if val and val in content:
            failures.append(f"{wt} contains real {name}")

# 5) structural secret patterns in tracked source (generic shapes — never real fragments)
pattern = re.compile(
    r"(cfut_[A-Za-z0-9]{20,}"                 # Cloudflare API token shape
    r"|\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b"     # Telegram bot token shape
    r"|cbx_rl_[A-Za-z0-9_-]{30,})"            # CYBRIX relay token shape
)
for path in scan_targets:
    if path == "scripts/secret-scan.py":
        continue  # scanner itself contains pattern literals
    if "/test/" in f"/{path}" or path.endswith(".test.ts") or "/fixtures/" in f"/{path}":
        continue  # test fixtures intentionally contain fake token SHAPES; real values are still caught by sections 1-2
    full = os.path.join(REPO, path)
    if not os.path.isfile(full):
        continue
    content = open(full, encoding="utf-8", errors="ignore").read()
    if pattern.search(content):
        failures.append(f"{path}: structural secret pattern match")

print(f"scanned {len(scan_targets)}/git-tracked+untracked files, {hist.strip()} commits of history")
print(f"scanned {len(secrets)} real secret values (values never printed)")
if failures:
    print("SECRET SCAN: FAIL")
    for f in failures: print("  -", f)
    sys.exit(1)
print("SECRET SCAN: CLEAN")

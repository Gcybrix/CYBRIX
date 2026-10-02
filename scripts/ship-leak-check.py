#!/usr/bin/env python3
"""Final pre-push gate: scan the exact GitHub ship tree + its git history
against EVERY real secret value (including GITHUB_TOKEN). Values are never printed."""
import subprocess, sys, os

SHIP = "/tmp/cybrix-ship"
MAIN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# collect all real values from the main repo's .secrets (the only place they exist)
values = {}
for fname in os.listdir(f"{MAIN}/.secrets"):
    if not fname.endswith(".env"):
        continue
    for line in open(f"{MAIN}/.secrets/{fname}"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k = k.replace("export ", "").strip()
        v = v.strip().strip("'\"")
        if len(v) >= 8 and k not in ("PANEL_URL", "BOT_BASE_URL", "KEEP_TG", "TG_OWNER", "PANEL_DOMAIN"):
            values[k] = v

if not any(k == "GITHUB_TOKEN" for k in values):
    print("FATAL: GITHUB_TOKEN not found in .secrets — scan set incomplete")
    sys.exit(2)

failures = []
# 1) every file in the ship tree
out = subprocess.run("find . -type f -not -path './.git/*'", shell=True,
                     capture_output=True, text=True, cwd=SHIP).stdout
files = [f.strip()[2:] for f in out.splitlines() if f.strip()]
for path in files:
    try:
        content = open(f"{SHIP}/{path}", encoding="utf-8", errors="ignore").read()
    except Exception:
        continue
    for name, val in values.items():
        if val in content:
            failures.append(f"{path}: contains {name}")

# 2) full git history of the ship repo (single release commit)
for name, val in values.items():
    r = subprocess.run(f"git grep -F '{val}' $(git rev-list --all) -- 2>/dev/null | head -1",
                       shell=True, capture_output=True, text=True, cwd=SHIP)
    if r.stdout.strip():
        failures.append(f"ship git history contains {name}")

# 3) generic credential shapes in ship source (same shapes as secret-scan.py section 5)
import re
pattern = re.compile(
    r"(cfut_[A-Za-z0-9]{20,}"
    r"|\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b"
    r"|cbx_rl_[A-Za-z0-9_-]{30,}"
    r"|github_pat_[A-Za-z0-9_]{30,})"
)

# 4) owner-deployment markers — the public repo must stay 100% operator-neutral:
#    no live endpoints, worker subdomains, bot usernames or workspace names of the
#    maintainer's own installation may ever appear in the shipped tree.
owner_markers = [
    "cybrix.dpdns.org",      # maintainer's panel custom domain / zone
    "alynnab54",             # maintainer's workers.dev subdomain
    "panel_cybrixbot",       # maintainer's Telegram bot username
    "atomicmail.io",         # maintainer's email domain
    "cybrix2's Projects",    # maintainer's Railway workspace name
]
for path in files:
    if path == "scripts/ship-leak-check.py":
        continue  # the checker itself lists the marker literals by design
    try:
        content = open(f"{SHIP}/{path}", encoding="utf-8", errors="ignore").read()
    except Exception:
        continue
    for m in owner_markers:
        if m in content:
            failures.append(f"{path}: owner-deployment marker present ({m!r})")

# 5) owner-deployment markers must also be absent from the ENTIRE pushed git history
#    (the checker itself is excluded — it lists the marker literals by design)
for m in owner_markers:
    r = subprocess.run(
        f"git grep -F '{m}' $(git rev-list --all) -- ':!scripts/ship-leak-check.py' 2>/dev/null | head -1",
        shell=True, capture_output=True, text=True, cwd=SHIP)
    if r.stdout.strip():
        failures.append(f"ship git history contains owner marker {m!r}")

for path in files:
    if path == "scripts/secret-scan.py":
        continue
    if "/test/" in f"/{path}" or path.endswith(".test.ts") or "/fixtures/" in f"/{path}":
        continue
    try:
        content = open(f"{SHIP}/{path}", encoding="utf-8", errors="ignore").read()
    except Exception:
        continue
    if pattern.search(content):
        failures.append(f"{path}: structural credential pattern match")

print(f"ship leak check: {len(files)} files x {len(values)} real values + {len(owner_markers)} owner markers (files+history) + credential shapes")
if failures:
    print("SHIP LEAK CHECK: FAIL")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("SHIP LEAK CHECK: CLEAN — safe to push")

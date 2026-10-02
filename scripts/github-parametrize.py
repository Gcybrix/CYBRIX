#!/usr/bin/env python3
"""GitHub-public readiness: parameterize hardcoded repo paths + account IDs.
Idempotent. Regex handles opening AND closing quote conversion.
Node:  '/home/z/my-project/x'  -> `${REPO_ROOT}/x`   (template literal, resolver added)
Bash:  /home/z/my-project/x    -> "$REPO_ROOT/x"     (resolver inserted after set -euo)
Python(REPO=...): REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) -> __file__-derived (f-strings keep working)
"""
import os, re, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
changed, errors = [], []

NODE_RESOLVER = "const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));\n"

def fix_node(path):
    s = open(path).read()
    orig = s
    if "/home/z/my-project" not in s:
        return
    # convert quoted absolute paths to template literals
    s = re.sub(r"'/home/z/my-project/([^']*)'", r"`${REPO_ROOT}/\1`", s)
    s = re.sub(r'os.path.join(REPO, "([^")]*)"', r"`${REPO_ROOT}/\1`", s)
    if "REPO_ROOT" not in orig:
        lines = s.split("\n")
        last_import = max((i for i, l in enumerate(lines[:25]) if l.startswith("import ")), default=-1)
        # ensure fileURLToPath import exists
        if "fileURLToPath" not in s:
            imp = "import { fileURLToPath } from 'node:url';"
            lines.insert(0, imp)
            last_import += 1
        lines.insert(last_import + 1, NODE_RESOLVER.rstrip())
        s = "\n".join(lines)
    if s != orig:
        open(path, "w").write(s)
        changed.append(os.path.relpath(path, REPO))

def fix_bash(path):
    s = open(path).read()
    orig = s
    if "/home/z/my-project" not in s:
        return
    if 'REPO_ROOT="$(cd' not in s:
        s = s.replace(
            "set -euo pipefail\n",
            'set -euo pipefail\nREPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"\n',
            1,
        )
    s = re.sub(r'(?<![\w$"])\/home\/z\/my-project\/([A-Za-z0-9_./-]*)', r'"$REPO_ROOT/\1"', s)
    # collapse accidental double quotes like ""$REPO_ROOT/...""
    s = s.replace('""$REPO_ROOT', '"$REPO_ROOT').replace('"$REPO_ROOT/."', '"$REPO_ROOT/.')
    s = re.sub(r'""\$', '"$', s)
    if s != orig:
        open(path, "w").write(s)
        changed.append(os.path.relpath(path, REPO))

def fix_python_repo(path):
    s = open(path).read()
    orig = s
    s2 = s.replace(
        'REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))',
        'REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))',
    )
    # railway-bootstrap writes absolute paths; route them through REPO var
    s2 = re.sub(r'os.path.join(REPO, "([^")]*)"', r'os.path.join(REPO, "\1")', s2)
    if s2 != orig:
        open(path, "w").write(s2)
        changed.append(os.path.relpath(path, REPO))

for fn in sorted(os.listdir(os.path.join(REPO, "scripts"))):
    p = os.path.join(REPO, "scripts", fn)
    if not os.path.isfile(p):
        continue
    try:
        if fn.endswith(".mjs"):
            fix_node(p)
        elif fn.endswith(".sh"):
            fix_bash(p)
        elif fn.endswith(".py"):
            fix_python_repo(p)
    except Exception as e:
        errors.append(f"{fn}: {e}")

r = subprocess.run(
    f"grep -rln '/home/z/my-project' {REPO}/scripts {REPO}/apps/*/scripts 2>/dev/null | grep -v node_modules || true",
    shell=True, capture_output=True, text=True,
)
left = [l for l in r.stdout.splitlines() if l.strip() and "github-parametrize" not in l]
print("changed:"); [print("  -", c) for c in changed]
if errors: print("errors:"); [print("  -", e) for e in errors]
print("remaining hardcoded-path files:", left or "NONE")
sys.exit(1 if errors else 0)

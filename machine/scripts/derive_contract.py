#!/usr/bin/env python3
"""
Derive consumer expectations from the view code that consumes them.

The consumer contract reported 100% coverage while five capabilities did not exist, because I
authored its declarations from the same design document that produced the interface prompts.
Both sides inherited the same fiction: a check written by the party that wrote the
specification tests the specification against itself.

This reads the React source, finds which API paths each view fetches, and reports fields the
view dereferences that no provider supplies.

  derive_contract.py            every view
  derive_contract.py --missing  only the gaps
"""
import json, re, sys, urllib.request
from pathlib import Path

SRC = Path.home() / "Workspace" / "src"
BASE = "http://127.0.0.1:4100"


def fetch(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=25) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"__err": f"{type(e).__name__}"}


def flatten(d, prefix=""):
    out = set()
    if isinstance(d, dict):
        for k, v in d.items():
            out.add(prefix + k)
            out.add(k)
            out |= flatten(v, prefix + k + ".")
    elif isinstance(d, list) and d:
        out |= flatten(d[0], prefix)
    return out


if not SRC.exists():
    sys.exit(f"no source at {SRC}")

rows, seen = [], {}
for f in sorted(SRC.rglob("*.tsx")) + sorted(SRC.rglob("*.ts")):
    text = f.read_text(errors="ignore")
    paths = sorted(set(re.findall(r"['\"`](/api/[a-z0-9/_-]+)['\"`]", text)))
    if not paths:
        continue
    reads = sorted(set(re.findall(
        r"\b(?:data|d|res|json|state|payload|models|skills|stats)\??\.([a-z_][a-zA-Z0-9_]*)",
        text)))
    rows.append({"view": str(f.relative_to(SRC)), "paths": paths, "reads": reads})
    for p in paths:
        if p not in seen and "{" not in p:
            seen[p] = flatten(fetch(p))

missing_only = "--missing" in sys.argv
gaps_total = 0
for r in rows:
    gaps = []
    for p in r["paths"]:
        sup = seen.get(p)
        if sup is None:
            continue
        if any(k.startswith("__err") for k in sup):
            gaps.append(f"{p} UNREACHABLE")
            continue
        for fld in r["reads"]:
            if fld not in sup:
                gaps.append(f"{p} lacks .{fld}")
    gaps_total += len(gaps)
    if gaps or not missing_only:
        print(f"  {r['view']}")
        for p in r["paths"]:
            print(f"     calls {p}")
        for gp in gaps[:5]:
            print(f"     GAP   {gp}")

print(f"\n{len(rows)} views · {len(seen)} endpoints · {gaps_total} gap(s)")
sys.exit(1 if gaps_total else 0)

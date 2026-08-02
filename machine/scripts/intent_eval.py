#!/usr/bin/env python3
"""
Score the omnibox intent classifier.

One input with four outcomes is only faster than four inputs if it is right. Above one error
in twenty it is friction wearing the costume of speed, and the honest response is to revert to
separate fields rather than to defend the design.

A misclassification is not equally costly in each direction: ask and search only read, so
mistaking one for the other is mild. Classifying anything as build when it was not is the
expensive error, because it starts work.
"""
import json, sys
from pathlib import Path
import requests

SET = Path.home() / "AgentHub" / "evals" / "intent_set.jsonl"
rows = [json.loads(l) for l in SET.read_text().splitlines() if l.strip()]
ok = 0
severe = []
for r in rows:
    try:
        got = requests.post("http://127.0.0.1:4100/api/classify",
                            files={"text": (None, r["text"])}, timeout=30).json()["intent"]
    except Exception as e:
        got = f"error:{type(e).__name__}"
    hit = got == r["intent"]
    ok += hit
    if not hit:
        # build is the only intent that writes; a false build is the costly direction
        sev = "SEVERE" if got == "build" else "mild"
        severe.append((sev, r["text"], r["intent"], got))
n = len(rows)
pct = 100 * ok // n
print(f"  intent accuracy {ok}/{n} ({pct}%)")
for sev, t, want, got in severe:
    print(f"    {sev:6} {t[:46]:48} wanted {want:7} got {got}")
bad_build = sum(1 for s, *_ in severe if s == "SEVERE")
print(f"\n  {'PASS' if pct >= 95 and not bad_build else 'FAIL'} — the floor is 95% with zero "
      f"false builds. Below it, revert the omnibox to separate inputs.")
sys.exit(0 if pct >= 95 and not bad_build else 1)

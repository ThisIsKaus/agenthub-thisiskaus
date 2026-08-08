#!/usr/bin/env python3
"""
Extend the golden set with questions actually asked.

The current 95 were generated in one pass by one model reading documents — so it carries that
model's blind spots, and four of its questions concern one README, which is 4% of the set spent
on a document type rarely queried. Questions from the session store are what retrieval is
really for.

  golden_from_sessions.py --extract
"""
import json, sqlite3, sys
from pathlib import Path

H = Path.home() / "AgentHub"
DB = H / "state" / "sessions.db"
OUT = H / "evals" / "golden_real.jsonl"

if not DB.exists():
    sys.exit("no session store")
c = sqlite3.connect(str(DB), timeout=10)
rows = c.execute(
    "SELECT question, answer FROM events WHERE kind='ask' AND question IS NOT NULL"
).fetchall()
c.close()

seen, out = set(), []
for q, a in rows:
    q = (q or "").strip()
    if len(q) < 12 or q.lower() in seen:
        continue
    seen.add(q.lower())
    # The source is left blank: it must be labelled by hand from the answer's citations.
    # A generated label is a proxy, and proxies are what this exercise is correcting.
    out.append({"id": f"s{len(out)+1:03d}", "q": q, "source": "", "path": "",
                "sensitivity": "", "answerable": True,
                "hint": (a or "")[:160].replace("\n", " ")})

OUT.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in out) + "\n")
print(f"  {len(out)} distinct questions from the session store -> {OUT}")
print("  `source` is blank by design — label each from the answer's citations.")

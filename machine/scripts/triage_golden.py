#!/usr/bin/env python3
"""
Build the triage golden set from real digest items.

The set held 15 items and scored 80% while production classified 52 consecutive items as
noise. An eval that passes while the thing it measures has stopped working is measuring
something else — the same defect as a retrieval set of twelve invented questions against
three thousand real documents.

  triage_golden.py --extract [n]   pull real items for you to label
"""
import json, re, sys
from pathlib import Path

H = Path.home() / "AgentHub"
OUT = H / "evals" / "triage_real.jsonl"

n = int(sys.argv[sys.argv.index("--extract") + 1]) if "--extract" in sys.argv else 40
rows, seen = [], set()
for f in sorted((H / "digests").glob("*.md"), reverse=True):
    for m in re.finditer(r"\*\*(.{5,90}?)\*\*\s*\n?\s*(.{0,140})", f.read_text(errors="ignore")):
        subj = m.group(1).strip()
        if subj in seen or len(subj) < 8:
            continue
        seen.add(subj)
        rows.append({"id": f"r{len(rows)+1:03d}", "day": f.stem,
                     "text": f"{subj}\n{m.group(2).strip()[:120]}",
                     "cls": "", "note": "label as noise, signal or task"})
        if len(rows) >= n:
            break
    if len(rows) >= n:
        break

OUT.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")
print(f"{len(rows)} real items -> {OUT}")
print("Label the `cls` field, then the eval measures your mail rather than examples.")

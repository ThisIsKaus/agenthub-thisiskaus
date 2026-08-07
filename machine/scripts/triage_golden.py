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
    # Read the format before writing the pattern. Digest lines are:
    #   - [FLAG] `src` [cls/entity/sensitivity] one-line summary
    for m in re.finditer(r"^- (\[FLAG\] )?`([^`]+)` \[([a-z]+)/([^/]+)/([^\]]+)\] (.+)$",
                         f.read_text(errors="ignore"), re.M):
        subj = m.group(6).strip()
        was = m.group(3)
        if subj in seen or len(subj) < 8:
            continue
        seen.add(subj)
        rows.append({"id": f"r{len(rows)+1:03d}", "day": f.stem, "text": subj,
                     "src": m.group(2), "flagged": bool(m.group(1)),
                     "machine_said": was, "cls": "",
                     "note": "label cls yourself — machine_said is what it guessed"})
        if len(rows) >= n:
            break
    if len(rows) >= n:
        break

# Writing an empty set is worse than failing: the eval would pass on nothing and report
# healthy. A golden set with no items is not a golden set.
if not rows:
    sys.exit("extracted 0 items — the digest format does not match the pattern. "
             "Read a digest before changing the regex.")
OUT.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")
print(f"{len(rows)} real items -> {OUT}")
print("Label the `cls` field, then the eval measures your mail rather than examples.")

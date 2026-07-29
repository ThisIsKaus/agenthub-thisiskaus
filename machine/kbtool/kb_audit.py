#!/usr/bin/env python3
"""Audit every ingested document against current policy. --fix removes violations."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import lancedb, ingest

FIX = "--fix" in sys.argv
t = lancedb.connect(str(Path.home() / "AgentHub/kb")).open_table("kb_main")
df = t.to_pandas()[["path", "sensitivity"]].drop_duplicates()

blocked, mis = [], []
for _, r in df.iterrows():
    p = Path(r["path"])
    why = ingest.block_reason(p)
    if why:
        blocked.append((r["path"], why))
        continue
    default = "S3" if "OneDrive-Personal" in r["path"] else "S1p"
    want = ingest.classify(p, default)
    if want != r["sensitivity"]:
        mis.append((r["path"], r["sensitivity"], want))

print(f"{len(df)} documents in the corpus")
print(f"\n{len(blocked)} that current policy would BLOCK:")
for path, why in blocked:
    print(f"  [{why}] {path}")
print(f"\n{len(mis)} with a stale sensitivity tag:")
for path, have, want in mis[:20]:
    print(f"  {have} -> {want}  {path[-88:]}")
if len(mis) > 20:
    print(f"  ... and {len(mis)-20} more")

if FIX and blocked:
    for path, _ in blocked:
        t.delete("path = '" + path.replace("'", "''") + "'")
    print(f"\nremoved {len(blocked)} blocked documents from the corpus")
elif blocked:
    print("\nrun with --fix to remove them")
sys.exit(1 if (blocked or mis) else 0)

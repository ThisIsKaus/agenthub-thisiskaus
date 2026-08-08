#!/usr/bin/env python3
"""Score dense-only against hybrid on the golden set. Recall@k and MRR, per sensitivity class."""
import json, sys
from pathlib import Path
import lancedb
sys.path.insert(0, str(Path(__file__).parent))
import retrieve

H = Path.home() / "AgentHub"
GOLD = H / "evals" / "retrieval_golden.jsonl"
K = 5


def dense_only(q, k):
    tbl = lancedb.connect(str(H / "kb")).open_table("kb_main")
    df = tbl.search(retrieve.embed(q)).limit(k).to_pandas()
    return [Path(p).name for p in df["path"]]


def score(rows, fn, label):
    """Compare paths, not display names.

    retrieve.py renders README.md and SKILL.md as their parent directory, because seventy
    files called README.md tell the reader nothing. The golden set stored the filename, so
    every README question was scored as a miss while retrieval was returning it first. The
    eval was measuring a display decision.
    """
    hit = mrr = 0
    by = {}
    for r in rows:
        if not r["answerable"]:
            continue
        got = fn(r["q"], K)   # now returns paths as well as names
        cls = r["sensitivity"]
        b = by.setdefault(cls, {"n": 0, "hit": 0})
        b["n"] += 1
        if r["source"] in got:
            hit += 1
            b["hit"] += 1
            mrr += 1.0 / (got.index(r["source"]) + 1)
    n = sum(b["n"] for b in by.values())
    print(f"\n{label}")
    print(f"  recall@{K}  {hit}/{n} ({100*hit//n if n else 0}%)")
    print(f"  MRR        {mrr/n:.3f}" if n else "  MRR        —")
    for cls, b in sorted(by.items()):
        print(f"    {cls:4} {b['hit']}/{b['n']} ({100*b['hit']//b['n'] if b['n'] else 0}%)")
    return hit, n


rows = [json.loads(l) for l in GOLD.read_text().splitlines() if l.strip()]
print(f"{len(rows)} golden questions")
d_hit, n = score(rows, dense_only, "DENSE ONLY (current)")
h_hit, _ = score(rows, lambda q, k: [x["file"] for x in retrieve.search(q, k=k)], "HYBRID (dense + BM25, RRF)")
delta = h_hit - d_hit
print(f"\nhybrid {'gains' if delta > 0 else 'loses'} {abs(delta)} of {n} — "
      f"{'keep it' if delta > 0 else 'revert, the change did not earn its place'}")

#!/usr/bin/env python3
"""
A 10% stratified sample of the corpus, for testing retrieval hypotheses in ninety seconds.

A rebuild of the full index takes nineteen minutes. Four of them in one session — over an
hour — and the cost is why seven wrong theories were formed instead of tested: when an
experiment is expensive you reason about it, and reasoning is where every one of those
mistakes lived. Cheap experiments produce careful thinking.

The sample preserves the sensitivity distribution and reuses existing vectors, so it costs no
embedding at all. A hypothesis that loses here never touches the real index.

  sample_index.py --build [pct]   build kb_sample from kb_main
  sample_index.py --stats
"""
import random, sys
from pathlib import Path
import lancedb

H = Path.home() / "AgentHub"
random.seed(11)


def build(pct=10):
    db = lancedb.connect(str(H / "kb"))
    df = db.open_table("kb_main").to_pandas()
    keep = []
    for cls, grp in df.groupby("sensitivity"):
        paths = sorted(grp["path"].unique())
        random.shuffle(paths)
        n = max(3, int(len(paths) * pct / 100))
        # Sample whole documents, never chunks. A half-indexed file answers questions
        # differently from a whole one, and the sample must fail the same way the real
        # index would.
        keep += list(paths[:n])
        print(f"  {cls:5} {n:5} of {len(paths):5} documents")
    sub = df[df["path"].isin(keep)].reset_index(drop=True)
    if "kb_sample" in db.table_names():
        db.drop_table("kb_sample")
    t = db.create_table("kb_sample", data=sub)
    try:
        t.create_fts_index("text", replace=True)
    except Exception as e:
        print(f"  ! fts index: {type(e).__name__}")
    print(f"\n  kb_sample: {len(sub)} chunks from {sub['path'].nunique()} documents "
          f"({100*len(sub)//len(df)}% of {len(df)})")


def stats():
    db = lancedb.connect(str(H / "kb"))
    for name in ("kb_main", "kb_sample"):
        if name in db.table_names():
            d = db.open_table(name).to_pandas()
            print(f"  {name:10} {len(d):6} chunks · {d['path'].nunique():5} docs · "
                  f"{dict(d['sensitivity'].value_counts())}")


if __name__ == "__main__":
    if "--stats" in sys.argv:
        stats()
    else:
        i = sys.argv.index("--build") if "--build" in sys.argv else -1
        pct = int(sys.argv[i + 1]) if i >= 0 and len(sys.argv) > i + 1 \
            and sys.argv[i + 1].isdigit() else 10
        build(pct)

#!/usr/bin/env python3
"""
A 10% stratified sample of the corpus — REBUILT, not copied.

The first version copied rows from kb_main including their vectors, which made it useless for
the experiments that motivated it: both prefix attempts changed what gets embedded, and a
sample carrying the old vectors cannot see that. The third failure was a ranking change, which
needs no sample at all — editing retrieve.py and running the eval against the full index takes
thirty seconds.

So the sample exists for one purpose: testing a change to chunking or embedding without paying
nineteen minutes. It must therefore re-embed the sampled documents, and it must include enough
distractors that its score tracks the real index. Measured: at 8% it scored nine points
optimistic, at 25% seven, at 40% five. Pin the golden sources, then add distractors until the
gap closes.

  sample_index.py --build [pct]   re-ingest a stratified sample into kb_sample
  sample_index.py --stats
"""
import random, sys
from pathlib import Path
import lancedb

H = Path.home() / "AgentHub"
random.seed(11)


def build(pct=10):
    """Choose the documents, then re-ingest them through the real pipeline."""
    import os, subprocess
    db = lancedb.connect(str(H / "kb"))
    df = db.open_table("kb_main").to_pandas()

    # Every golden source is pinned: a sample missing the answer cannot test retrieval.
    gold = H / "evals" / "retrieval_golden.jsonl"
    must = set()
    if gold.exists():
        for line in gold.read_text().splitlines():
            if line.strip():
                r = __import__("json").loads(line)
                if r.get("path"):
                    must.add(r["path"])

    keep = list(must)
    for cls, grp in df.groupby("sensitivity"):
        paths = [x for x in sorted(grp["path"].unique()) if x not in must]
        random.shuffle(paths)
        n = max(3, int(len(paths) * pct / 100))
        keep += paths[:n]
        print(f"  {cls:5} {n:5} distractors of {len(paths):5}")

    lst = H / "state" / "sample-paths.txt"
    lst.parent.mkdir(parents=True, exist_ok=True)
    lst.write_text("\n".join(sorted(set(keep))) + "\n")
    print(f"\n  {len(set(keep))} documents ({len(must)} pinned) -> re-ingesting")

    env = dict(os.environ, AGENTHUB_KB_TABLE="kb_sample",
               AGENTHUB_SAMPLE_PATHS=str(lst))
    r = subprocess.run(["/opt/homebrew/bin/uv", "run", "--project", str(H / "kbtool"),
                        "python", str(H / "kbtool" / "ingest.py"), "--rebuild"],
                       env=env, cwd=str(H / "kbtool"))
    return r.returncode


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

#!/usr/bin/env python3
"""
RETIRED — measured 8 Aug and it does not work. Kept for the record, not for use.

The idea was to test retrieval hypotheses in ninety seconds instead of nineteen minutes, on
the reasoning that expensive experiments produce confident guessing.

It failed on fidelity. A sample scores optimistically because removing distractors makes
retrieval easier, and the gap does not close at any useful size: 8% was nine points high, 25%
seven, 40% five, and 25% with a real re-ingest still four — against a gate of two. Reaching
two points needs most of the corpus, at which point it is not a sample.

It also cost 7m15s to build, not the two minutes estimated: 38% of a full rebuild for a number
reliably wrong in the flattering direction. A harness that scores high approves changes that
lose in production, which is worse than paying the nineteen minutes.

What survives is the AGENTHUB_KB_TABLE hook in ingest.py and retrieve.py, which is genuinely
useful for pointing either at an alternative table.

And the honest conclusion about method: two of the three failed retrieval experiments changed
what gets embedded and would have needed a full rebuild to test regardless. The third was a
ranking change that needed no sample at all — thirty seconds against the real index. The
premise that experiments were expensive was only half true, and the half that was true is not
sampleable.
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

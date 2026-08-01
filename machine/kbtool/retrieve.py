#!/usr/bin/env python3
"""
Hybrid retrieval for AgentHub — the single retrieval path, used by the ask endpoint and by
every eval, so a change is measured everywhere at once.

Dense embeddings are strong on meaning and weak on exact identifiers; BM25 is the inverse.
This corpus is 73% financial and identity documents — account numbers, assessment years,
statement references — which is the documented worst case for dense-only. The benchmark that
settled it found BM25 beating text-embedding-3-large on every metric but Recall@20 for
exactly this material.

Fusion is Reciprocal Rank Fusion on rank, not score. That matters because raw cosine on this
embedder has a high floor and no comparable scale — the same defect that made the skills
routing metric meaningless until it was recalibrated.

  retrieve.py "<query>" [--k 5] [--lane local|cloud] [--source corpus]
"""
import json, re, sys
from pathlib import Path
import lancedb, requests

H = Path.home() / "AgentHub"
DB, TABLE = H / "kb", "kb_main"
EMBED = "http://127.0.0.1:4000/v1/embeddings"
CLASSIFIED = ("S1c", "S2", "S3")
RRF_K = 60
CANDIDATES = 50


def embed(text):
    r = requests.post(EMBED, json={"model": "local-embed",
                                   "input": [f"search_query: {text}"]}, timeout=120)
    r.raise_for_status()
    return r.json()["data"][0]["embedding"]


def ensure_fts(tbl):
    """Build the full-text index once; it persists alongside the vectors."""
    try:
        tbl.create_fts_index("text", replace=False)
    except Exception:
        pass


def terms(q):
    """BM25 wants the identifiers, not the grammar."""
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9._/-]{1,}", q)
    stop = {"what", "when", "where", "which", "how", "the", "for", "and", "was", "are",
            "does", "did", "have", "has", "with", "from", "that", "this", "into", "about",
            "my", "me", "is", "in", "of", "on", "to", "a", "an", "do", "i"}
    keep = [w for w in words if w.lower() not in stop]
    return " ".join(keep) or q


def search(query, k=5, lane="local", sources=None, candidates=CANDIDATES):
    tbl = lancedb.connect(str(DB)).open_table(TABLE)
    ensure_fts(tbl)

    where = []
    if lane == "cloud":
        where.append("sensitivity NOT IN " + str(CLASSIFIED))
    if sources:
        where.append("source IN (" + ", ".join(f"'{s}'" for s in sources) + ")")
    clause = " AND ".join(where) if where else None

    def run(builder):
        try:
            q = builder.limit(candidates)
            if clause:
                q = q.where(clause)
            return q.to_pandas()
        except Exception:
            return None

    dense = run(tbl.search(embed(query)))
    lex = run(tbl.search(terms(query), query_type="fts"))

    # RRF: rank position, not score. Immune to incomparable scales.
    fused = {}
    for df, tag in ((dense, "dense"), (lex, "bm25")):
        if df is None or df.empty:
            continue
        for rank, (_, row) in enumerate(df.iterrows()):
            key = row["id"]
            e = fused.setdefault(key, {"row": row, "score": 0.0, "found_by": []})
            e["score"] += 1.0 / (RRF_K + rank + 1)
            e["found_by"].append(tag)

    if not fused:
        return []
    ranked = sorted(fused.values(), key=lambda e: -e["score"])[:k]
    return [{
        "file": Path(e["row"]["path"]).name,
        "path": e["row"]["path"],
        "text": e["row"]["text"],
        "sensitivity": e["row"].get("sensitivity", "?"),
        "source": e["row"].get("source", "corpus"),
        "rrf": round(e["score"], 5),
        "found_by": "+".join(sorted(set(e["found_by"]))),
    } for e in ranked]


if __name__ == "__main__":
    q = " ".join(a for a in sys.argv[1:] if not a.startswith("--"))
    k = int(sys.argv[sys.argv.index("--k") + 1]) if "--k" in sys.argv else 5
    lane = sys.argv[sys.argv.index("--lane") + 1] if "--lane" in sys.argv else "local"
    for r in search(q, k=k, lane=lane):
        print(f"  {r['rrf']:.5f}  [{r['found_by']:11}] {r['sensitivity']:4} {r['file'][:52]}")
        print(f"           {r['text'][:110].strip()}")

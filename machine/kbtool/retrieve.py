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


# MEASURED AND REJECTED, 2 Aug 2026. Reranking the top 50 with the 4B produced identical
# recall (36/40) and identical MRR (0.708) at 66.7s per query against 0.1s — 667x slower for
# no gain. The fused ranking is already precise enough that a second pass has nothing to fix.
# Kept for a future model with a real cross-encoder; do not enable without re-measuring.
RERANK_SYS = ("Score how well the passage answers the question, 0 to 10. A passage that "
              "contains the exact figure, name or identifier asked for scores high. A passage "
              "on the same topic without the answer scores low. Reply with the number only.")


def _rerank(query, cands, k):
    """A precision layer over the shortlist, not the index. The fused ranking is already
    good; this reorders the top candidates by whether they actually contain the answer."""
    import concurrent.futures as cf

    def score(e):
        body = {"model": "local-triage", "temperature": 0, "max_tokens": 300,
                "messages": [{"role": "system", "content": RERANK_SYS},
                             {"role": "user",
                              "content": f"Question: {query}\n\nPassage:\n{e['row']['text'][:1200]}"}]}
        try:
            r = requests.post("http://127.0.0.1:4000/v1/chat/completions",
                              json=body, timeout=90)
            m = r.json()["choices"][0]["message"]
            raw = (m.get("content") or "") or (m.get("reasoning_content") or "")
            n = re.search(r"\b(10|\d)\b", raw)
            return float(n.group(1)) if n else 0.0
        except Exception:
            return 0.0

    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        scores = list(ex.map(score, cands))
    for e, sc in zip(cands, scores):
        e["rerank"] = sc
    # Fused rank breaks ties, so a reranker that scores everything equally is a no-op
    return sorted(cands, key=lambda e: (-e.get("rerank", 0), -e["score"]))


def search(query, k=5, lane="local", sources=None, candidates=CANDIDATES, rerank=False):
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
    # Source authority. Adding sessions, digests and logs to the index cost 3 points of
    # recall and 10 on S1p: a transcript discussing the autonomy tiers outranked the canon
    # entry that defines them. Derivative material is worth retrieving and worth ranking
    # below its own source — an original beats a conversation about it.
    AUTHORITY = (
        ("/canon/", 1.30),          # the definitions themselves
        ("/skills-lib/", 1.20),     # instructions, authored deliberately
        ("/contracts/", 1.15),
        ("/docs/sessions/", 0.75),  # conversations about the above
        ("/digests/", 0.80),
        ("/logs/", 0.70),
        ("/state/builds/", 0.85),
    )

    def _weight(path):
        for frag, w in AUTHORITY:
            if frag in path:
                return w
        return 1.0

    for e in fused.values():
        e["authority"] = _weight(str(e["row"]["path"]))
        e["score"] *= e["authority"]
    ranked = sorted(fused.values(), key=lambda e: -e["score"])
    if rerank and len(ranked) > k:
        ranked = _rerank(query, ranked[:CANDIDATES], k)
    # Cap chunks per file. Four passages from one document crowd out three other sources
    # and tell you less than one passage each from four would.
    seen, diverse = {}, []
    for e in ranked:
        f = Path(e["row"]["path"]).name
        if seen.get(f, 0) >= 2:
            continue
        seen[f] = seen.get(f, 0) + 1
        diverse.append(e)
        if len(diverse) >= k:
            break
    ranked = diverse
    return [{
        # A skill's filename is always SKILL.md; the directory is the identity. Five sources
        # reading "SKILL.md" tells the reader nothing about what was cited.
        "file": (Path(e["row"]["path"]).parent.name
                 if Path(e["row"]["path"]).name in ("SKILL.md", "index.md", "README.md")
                 else Path(e["row"]["path"]).name),
        "path": e["row"]["path"],
        "text": e["row"]["text"],
        "sensitivity": e["row"].get("sensitivity", "?"),
        "source": e["row"].get("source", "corpus"),
        "rrf": round(e["score"], 5),
        "found_by": "+".join(sorted(set(e["found_by"]))),
        "rerank": e.get("rerank"),
    } for e in ranked]


if __name__ == "__main__":
    q = " ".join(a for a in sys.argv[1:] if not a.startswith("--"))
    k = int(sys.argv[sys.argv.index("--k") + 1]) if "--k" in sys.argv else 5
    lane = sys.argv[sys.argv.index("--lane") + 1] if "--lane" in sys.argv else "local"
    for r in search(q, k=k, lane=lane):
        print(f"  {r['rrf']:.5f}  [{r['found_by']:11}] {r['sensitivity']:4} {r['file'][:52]}")
        print(f"           {r['text'][:110].strip()}")

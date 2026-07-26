#!/usr/bin/env python3
"""Retrieval eval - does the knowledge base find the right source, and does it refuse when it should?"""
import json, sys, datetime as dt
from pathlib import Path
import requests, lancedb

H = Path.home() / "AgentHub"
SET = H / "evals" / "retrieval_set.jsonl"
ROUTER = "http://127.0.0.1:4000/v1"
MODEL = "local-brain"
K = 5
REFUSAL = "NOT IN CORPUS"

SYSTEM = ("Answer only from the supplied context. If the context does not contain the answer, "
          "reply with exactly: " + REFUSAL + " and nothing else. Be brief and concrete.")


def search(q, k=K):
    r = requests.post(f"{ROUTER}/embeddings",
                      json={"model": "local-embed", "input": [f"search_query: {q}"]}, timeout=60)
    r.raise_for_status()
    vec = r.json()["data"][0]["embedding"]
    tbl = lancedb.connect(str(H / "kb")).open_table("kb_main")
    rows = tbl.search(vec).limit(k).to_pandas()
    return [(Path(x["path"]).name, round(float(x["_distance"]), 3), x["text"]) for _, x in rows.iterrows()]


def answer(q, ctx):
    body = {"model": MODEL, "max_tokens": 2500, "messages": [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": f"Context:\n{ctx}\n\nQuestion: {q}"}]}
    r = requests.post(f"{ROUTER}/chat/completions", json=body, timeout=300)
    if r.status_code >= 400:
        return f"ERROR {r.status_code}"
    m = r.json()["choices"][0]["message"]
    return ((m.get("content") or "").strip() or (m.get("reasoning_content") or "").strip())


def main():
    tasks = [json.loads(l) for l in SET.read_text().splitlines() if l.strip()]
    rows, hit5, hit1, terms_ok, refusals_ok = [], 0, 0, 0, 0
    n_ans = sum(1 for t in tasks if t["answerable"])
    n_neg = len(tasks) - n_ans

    for t in tasks:
        try:
            res = search(t["q"])
        except Exception as e:
            rows.append((t["id"], "ERROR", str(e)[:60], "", ""))
            continue
        names = [r[0] for r in res]
        ctx = "\n".join(f"--- {r[0]}\n{r[2][:1500]}" for r in res)
        a = answer(t["q"], ctx)

        if t["answerable"]:
            in5 = t["source"] in names
            in1 = names and names[0] == t["source"]
            hit5 += in5
            hit1 += bool(in1)
            tok = all(x.lower() in a.lower() for x in t["terms"]) and REFUSAL not in a
            terms_ok += tok
            rows.append((t["id"], "PASS" if in5 else f"want {t['source']}",
                         "top1" if in1 else names[0] if names else "-",
                         f"{res[0][1]}" if res else "-",
                         "grounded" if tok else "weak answer"))
        else:
            ref = REFUSAL in a.upper()
            refusals_ok += ref
            rows.append((t["id"], "n/a", "-", f"{res[0][1]}" if res else "-",
                         "refused correctly" if ref else "CONFABULATED"))

    def pc(x, n):
        return f"{x}/{n} ({100*x//n if n else 0}%)"

    out = [f"# Retrieval eval - {MODEL} - {dt.date.today().isoformat()}", "",
           "| id | source found | top hit | distance | answer |", "|---|---|---|---|---|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    out += ["", "## Score",
            f"- recall@{K}: {pc(hit5, n_ans)}",
            f"- top-1 accuracy: {pc(hit1, n_ans)}",
            f"- grounded answers: {pc(terms_ok, n_ans)}",
            f"- correct refusals: {pc(refusals_ok, n_neg)}", "",
            f"**Correct refusals must be {n_neg}/{n_neg}. A system that invents an answer when the "
            f"corpus is silent is worse than one that has no corpus at all.**"]
    text = "\n".join(out)
    p = H / "evals" / f"retrieval-{dt.date.today().isoformat()}.md"
    p.write_text(text + "\n")
    print(text)
    print(f"\nsaved -> {p}")
    sys.exit(0 if refusals_ok == n_neg else 1)


if __name__ == "__main__":
    main()

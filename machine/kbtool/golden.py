#!/usr/bin/env python3
"""
Build the retrieval golden set from the corpus as it actually is.

The existing set holds twelve questions, ten about AgentHub's own documentation, against a
corpus that is 73% financial and identity material. It cannot detect a regression in the
documents that matter most. This samples documents stratified by sensitivity class and
generates one question each document uniquely answers — so ground truth is the source
document rather than my guess about which document should win.

  golden.py --build [n]     generate n questions (default 100)
  golden.py --stats         what the current set covers
"""
import json, random, re, sys
from pathlib import Path
import lancedb, requests

H = Path.home() / "AgentHub"
OUT = H / "evals" / "retrieval_golden.jsonl"
ROUTER = "http://127.0.0.1:4000/v1/chat/completions"
random.seed(42)

SYSTEM = ("Write ONE question that this document uniquely answers. It must be specific enough "
          "that no other document in a personal archive would answer it — name the entity, the "
          "period, the account or the artefact. Write it as the owner would ask it, in one line. "
          "No preamble, no quotes, just the question.")


def gen(text, name):
    body = {"model": "local-triage", "temperature": 0, "max_tokens": 400,
            "messages": [{"role": "system", "content": SYSTEM},
                         {"role": "user", "content": f"File: {name}\n\n{text[:1800]}"}]}
    try:
        r = requests.post(ROUTER, json=body, timeout=180)
        m = r.json()["choices"][0]["message"]
        q = ((m.get("content") or "").strip() or (m.get("reasoning_content") or "").strip())
        q = q.split("\n")[-1].strip().strip('"').strip()
        return q if 15 < len(q) < 200 and "?" in q else None
    except Exception:
        return None


def main():
    t = lancedb.connect(str(H / "kb")).open_table("kb_main")
    df = t.to_pandas()[["path", "text", "sensitivity"]]

    if "--stats" in sys.argv:
        if OUT.exists():
            rows = [json.loads(l) for l in OUT.read_text().splitlines() if l.strip()]
            by = {}
            for r in rows:
                by[r.get("sensitivity", "?")] = by.get(r.get("sensitivity", "?"), 0) + 1
            print(f"{len(rows)} golden questions: {by}")
        else:
            print("no golden set yet")
        print("\ncorpus by class (documents):")
        print(df.drop_duplicates("path")["sensitivity"].value_counts().to_string())
        return 0

    n = int(sys.argv[sys.argv.index("--build") + 1]) if len(sys.argv) > 2 else 100

    # Stratify by class, weighted to the corpus as it actually is, with a floor per class
    docs = df.drop_duplicates("path")
    quota = {"S3": int(n * 0.55), "S1p": int(n * 0.30), "S2": max(4, int(n * 0.06)),
             "S1c": max(3, int(n * 0.04)), "S0": max(3, int(n * 0.05))}
    print("quota:", quota)

    written, seen = [], set()
    for cls, want in quota.items():
        pool = df[df["sensitivity"] == cls]
        paths = list(dict.fromkeys(pool["path"].tolist()))
        random.shuffle(paths)
        got = 0
        for p in paths:
            if got >= want or p in seen:
                continue
            chunks = pool[pool["path"] == p]["text"].tolist()
            if not chunks:
                continue
            body = max(chunks, key=len)
            if len(body) < 300:
                continue
            q = gen(body, Path(p).name)
            if not q:
                continue
            seen.add(p)
            written.append({"id": f"g{len(written)+1:03d}", "q": q, "source": Path(p).name,
                            "path": p, "sensitivity": cls, "answerable": True})
            got += 1
            if len(written) % 10 == 0:
                print(f"  {len(written)} generated...")
        print(f"  {cls}: {got}/{want}")

    # Keep the adversarial refusals — the axis that must stay perfect
    written += [
        {"id": "gneg1", "q": "what were the closing arguments in the Nuremberg trials",
         "source": "", "path": "", "sensitivity": "S0", "answerable": False},
        {"id": "gneg2", "q": "what is the airspeed velocity of an unladen swallow",
         "source": "", "path": "", "sensitivity": "S0", "answerable": False},
    ]
    OUT.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in written) + "\n")
    print(f"\n{len(written)} golden questions -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

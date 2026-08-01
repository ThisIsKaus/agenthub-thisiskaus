#!/usr/bin/env python3
"""
Trigger accuracy for the skill library.

The description is what a request is matched against, so description quality IS trigger
accuracy — and it is measurable. This scores (prompt -> expected skill) cases using the same
local embedder the knowledge base uses, and reports the winner, the runner-up and the gap
between them. A narrow gap is a collision waiting to happen even when the answer is correct,
which is why the gap is reported and not just the verdict.

Output matches evals/routing-stress-test-*.json in kb-skills so the two are comparable.

  skills_route.py              score the case file
  skills_route.py --cases      print how many cases exist per skill
"""
import json, re, sys
import datetime as dt
from pathlib import Path
import requests

H = Path.home() / "AgentHub"
LIB = H / "skills-lib" / "skills"
CASES = H / "skills-lib" / "evals"
ROUTER = "http://127.0.0.1:4000/v1/embeddings"
OUT = H / "skills-lib" / "evals" / f"routing-stress-test-{dt.date.today().isoformat()}.json"

sys.path.insert(0, str(H / "scripts"))
from skills_lint import frontmatter


def embed(texts, prefix):
    r = requests.post(ROUTER, json={"model": "local-embed",
                                    "input": [f"{prefix}: {t}" for t in texts]}, timeout=300)
    r.raise_for_status()
    return [d["embedding"] for d in sorted(r.json()["data"], key=lambda x: x["index"])]


def cosine(a, b):
    num = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return num / (na * nb) if na and nb else 0.0


def load_cases():
    """One CSV per skill: a prompt per line, or prompt,expected."""
    out = []
    for f in sorted(CASES.glob("*.csv")):
        skill = f.stem
        for line in f.read_text(errors="ignore").splitlines():
            line = line.strip()
            if not line or line.lower().startswith(("prompt", "#")):
                continue
            parts = [p.strip().strip('"') for p in line.split(",")]
            prompt = parts[0]
            expected = parts[1] if len(parts) > 1 and parts[1] else skill
            if prompt:
                out.append({"prompt": prompt, "expected": expected})
    return out


def main():
    skills = []
    for d in sorted(LIB.iterdir()):
        if not d.is_dir() or d.name.startswith("."):
            continue
        p = d / "SKILL.md"
        if not p.exists():
            continue
        fm, _ = frontmatter(p.read_text(errors="ignore"))
        if fm and fm.get("description"):
            skills.append({"name": d.name, "desc": fm["description"]})

    cases = load_cases()
    if "--cases" in sys.argv:
        by = {}
        for c in cases:
            by[c["expected"]] = by.get(c["expected"], 0) + 1
        print(f"{len(cases)} cases across {len(by)} skills, {len(skills)} skills in the library")
        for s in skills:
            n = by.get(s["name"], 0)
            print(f"  {'ok  ' if n else 'NONE'}  {s['name']:32} {n} case(s)")
        missing = [s['name'] for s in skills if not by.get(s['name'])]
        print(f"\n{len(missing)} skills have no eval case. A skill with no case does not ship.")
        return 1 if missing else 0

    if not cases:
        print("no eval cases found — the CSVs in kb-skills/evals are empty.")
        print("Add one prompt per line to evals/<skill-name>.csv, then re-run.")
        return 1

    print(f"scoring {len(cases)} cases against {len(skills)} skills...")
    svecs = embed([s["desc"] for s in skills], "search_document")
    pvecs = embed([c["prompt"] for c in cases], "search_query")

    rows, correct, collisions = [], 0, 0
    for c, pv in zip(cases, pvecs):
        scored = sorted(((cosine(pv, sv), s["name"]) for s, sv in zip(skills, svecs)),
                        reverse=True)
        top, runner = scored[0], (scored[1] if len(scored) > 1 else (0.0, None))
        # Raw cosine on nomic has a high floor — unrelated text still scores ~0.5 — so a
        # percentage gap is meaningless. Measure separation in standard deviations above the
        # field instead: scale-invariant, and it tells you whether the winner actually won.
        vals = [v for v, _ in scored]
        mean = sum(vals) / len(vals)
        sd = (sum((v - mean) ** 2 for v in vals) / len(vals)) ** 0.5 or 1e-9
        gap = round((top[0] - runner[0]) / sd, 2)
        conf = round((top[0] - mean) / sd, 2)
        ok = top[1] == c["expected"]
        coll = gap < 0.5
        correct += ok
        collisions += coll
        rows.append({"prompt": c["prompt"], "expected": c["expected"], "routed_to": top[1],
                     "score": round(top[0], 4), "runner_up": runner[1],
                     "runner_up_score": round(runner[0], 4), "gap_sd": gap, "confidence_sd": conf,
                     "collision": coll, "correct": ok})

    OUT.write_text(json.dumps(rows, indent=2))
    n = len(rows)
    print(f"\n  accuracy   {correct}/{n} ({100*correct//n}%)")
    print(f"  collisions {collisions}/{n} — separation under 0.5 sd is fragile")
    for r in rows:
        if not r["correct"] or r["collision"]:
            flag = "WRONG" if not r["correct"] else "tight"
            print(f"    {flag}  {r['prompt'][:44]:46} -> {r['routed_to']} "
                  f"(wanted {r['expected']}, sep {r['gap_sd']}sd)")
    print(f"\nsaved -> {OUT}")
    return 0 if correct == n else 1


if __name__ == "__main__":
    sys.exit(main())

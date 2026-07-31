#!/usr/bin/env python3
"""
AgentHub diagnostician.

Reads the system's own evaluation logs and proposes what to improve. Deliberately separate
from the implementer — the Darwin Gödel Machine result is that a distinct model diagnosing
from evaluation traces outperforms a coding agent asked to improve itself directly.

Signals are real execution evidence, never synthesis: failing checks, eval regressions,
questions the corpus refused, corrections you made, jobs that failed, builds that failed.
"Coding agents don't fail because the model is dumb. They fail because the model hasn't
seen its own mistakes."

Proposes only. Nothing is implemented without approval.

  diagnose.py            collect signals, rank, write proposals
  diagnose.py --signals  print the raw signals and stop
  diagnose.py --list     show current proposals
"""

import argparse, json, os, re, sqlite3, subprocess, sys
import datetime as dt
from pathlib import Path

HOME = Path.home()
H = HOME / "AgentHub"
REPO = HOME / "Workspace"
OUT = H / "state" / "proposals"
ROUTER = "http://127.0.0.1:4000/v1/chat/completions"

# Impact weight by signal class. A failing check outranks a TODO by an order of magnitude
# because one is evidence of breakage and the other is evidence of an intention.
WEIGHT = {"failure": 10, "regression": 9, "corpus_gap": 7, "correction": 6,
          "build_failure": 6, "warning": 4, "deprecation": 3, "debt": 2, "churn": 2}


def sh(cmd, timeout=60, cwd=REPO):
    env = dict(os.environ)
    env["PATH"] = ("/opt/homebrew/bin:" + str(HOME / ".local/bin") + ":" +
                   env.get("PATH", "/usr/bin:/bin"))
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                           timeout=timeout, cwd=str(cwd), env=env)
        return r.stdout.strip()
    except Exception:
        return ""


def sig(kind, title, evidence, files=None):
    return {"kind": kind, "title": title, "evidence": evidence,
            "files": files or [], "weight": WEIGHT.get(kind, 1)}


# ------------------------------------------------------------------ signals

def from_selftest():
    out = []
    files = sorted((H / "logs").glob("selftest-*.md"), reverse=True)
    if not files:
        return out
    for line in files[0].read_text(errors="ignore").splitlines():
        m = re.match(r"\|\s*(\w[\w ]*)\s*\|\s*([^|]+?)\s*\|\s*\*{0,2}(FAIL|warn)\*{0,2}\s*\|\s*(.*?)\s*\|", line)
        if m:
            group, name, state, detail = m.groups()
            out.append(sig("failure" if state == "FAIL" else "warning",
                           f"self-test {state}: {name}",
                           f"{files[0].name} — {group}/{name}: {detail[:200]}"))
    return out


def from_evals():
    """A score that moved down is worth more attention than one that is merely low."""
    out = []
    for pattern, label in (("results-*.md", "triage"), ("retrieval-*.md", "retrieval")):
        runs = sorted((H / "evals").glob(pattern), reverse=True)[:2]
        if len(runs) < 2:
            continue
        def scores(p):
            t = p.read_text(errors="ignore")
            return {k: int(v) for k, _a, _b, v in
                    re.findall(r"- (\w+): (\d+)/(\d+) \((\d+)%\)", t)}
        now, prev = scores(runs[0]), scores(runs[1])
        for axis, val in now.items():
            if axis in prev and val < prev[axis]:
                out.append(sig("regression",
                               f"{label} {axis} fell {prev[axis]}% to {val}%",
                               f"{runs[1].name} -> {runs[0].name}",
                               ["machine/graphtool/pipeline.py"] if label == "triage"
                               else ["machine/kbtool/ingest.py"]))
        if now.get("injection", 100) < 100:
            out.append(sig("failure", "injection detection is below 100%",
                           f"{runs[0].name}: injection {now['injection']}% — this is the "
                           "safety axis and must be perfect"))
    return out


def from_sessions():
    """Questions the corpus could not answer are the clearest signal of what is missing."""
    out = []
    db = H / "state" / "sessions.db"
    if not db.exists():
        return out
    try:
        c = sqlite3.connect(str(db), timeout=8)
        rows = c.execute(
            "SELECT question, answer FROM events WHERE kind='ask' AND ("
            "answer LIKE '%NOT IN CORPUS%' OR answer LIKE '%does not cover%' OR "
            "answer LIKE '%not mention%' OR answer LIKE '%cannot provide%') "
            "ORDER BY id DESC LIMIT 12").fetchall()
        c.close()
    except Exception:
        return out
    if len(rows) >= 2:
        qs = [q for q, _ in rows if q]
        out.append(sig("corpus_gap",
                       f"{len(rows)} questions the corpus could not answer",
                       "recent refusals: " + " · ".join(q[:70] for q in qs[:5])))
    return out


def from_corrections():
    out = []
    p = H / "evals" / "triage_set.jsonl"
    if not p.exists():
        return out
    real = [json.loads(l) for l in p.read_text().splitlines()
            if l.strip() and '"id": "r' in l.replace('"id":"r', '"id": "r')]
    if len(real) >= 3:
        axes = {}
        for r in real:
            for a in ("class", "entity", "sensitivity"):
                axes[a] = axes.get(a, 0) + 1
        out.append(sig("correction",
                       f"{len(real)} real-world corrections accumulated",
                       "corrections are golden items the triage prompt has not yet learned from",
                       ["machine/graphtool/pipeline.py"]))
    return out


def from_builds():
    """The cascade's own failures are improvement signals."""
    out = []
    runs = sorted((H / "state" / "builds").glob("*.json"), reverse=True)[:12]
    failed = []
    for r in runs:
        try:
            d = json.loads(r.read_text())
        except Exception:
            continue
        if d.get("resolved_at_tier") is None:
            failed.append(d.get("intent", "")[:70])
        else:
            for a in d.get("attempts", []):
                if a.get("result", "").startswith("no change") and a.get("tier", 9) <= 3:
                    failed.append(f"tier {a['tier']} could not do: {d.get('intent','')[:50]}")
    if len(failed) >= 2:
        out.append(sig("build_failure",
                       f"{len(failed)} build attempts a local tier could not complete",
                       " · ".join(failed[:4]),
                       ["machine/build/cascade.py"]))
    return out


def from_logs():
    out = []
    for name in ("nightly.log", "console.err.log", "router.err.log"):
        p = H / "logs" / name
        if not p.exists():
            continue
        text = p.read_text(errors="ignore")[-40000:]
        deps = set(re.findall(r"(\w+) is deprecated|Deprecat\w+: ([\w.]+)", text))
        flat = {a or b for a, b in deps if (a or b)}
        if flat:
            out.append(sig("deprecation", f"deprecation warnings in {name}",
                           ", ".join(sorted(flat)[:6])))
        errs = re.findall(r"^.*(Traceback|Error:|FAILED).*$", text, re.M)
        if len(errs) >= 3:
            out.append(sig("failure", f"{len(errs)} errors in {name}",
                           " · ".join(e.strip()[:80] for e in errs[-3:])))
    return out


def from_code():
    out = []
    hits = sh("grep -rn 'TODO\\|FIXME\\|XXX\\|HACK' machine --include='*.py' --include='*.sh' "
              "| grep -v '.venv' | head -20")
    lines = [l for l in hits.splitlines() if l.strip()]
    if len(lines) >= 3:
        out.append(sig("debt", f"{len(lines)} unresolved code markers",
                       " · ".join(l.split(":", 2)[-1].strip()[:60] for l in lines[:4]),
                       sorted({l.split(":")[0] for l in lines})[:4]))
    churn = sh("git log --since='14 days ago' --name-only --pretty=format: -- machine "
               "| grep -v '^$' | sort | uniq -c | sort -rn | head -4")
    hot = [l.split()[-1] for l in churn.splitlines() if l.strip() and int(l.split()[0]) >= 4]
    if hot:
        out.append(sig("churn", f"{len(hot)} files changed repeatedly in a fortnight",
                       "repeated change often indicates a design that resists the work: "
                       + ", ".join(hot), hot))
    return out


def collect():
    out = []
    for fn in (from_selftest, from_evals, from_sessions, from_corrections,
               from_builds, from_logs, from_code):
        try:
            out += fn()
        except Exception as e:
            out.append(sig("warning", f"signal collector {fn.__name__} failed",
                           f"{type(e).__name__}: {e}"))
    return out


# ------------------------------------------------------------------ proposals

SYSTEM = """You are AgentHub's diagnostician. You do not write code. You read evidence of how
the system actually behaved and propose what should be improved.

Each proposal must be:
- grounded in the supplied evidence, quoting it — never invented
- a single, concrete, buildable change, not a theme
- scoped so a build could attempt it in one pass
- honest about effort: low if one file, medium if two or three, high beyond that

Reject anything you cannot ground in the evidence. Fewer, sharper proposals are better than
many vague ones. If the evidence supports nothing, return an empty list.

Return ONLY a JSON array, no prose, no markdown fences:
[{"title": "...", "why": "quote the evidence", "change": "what to do, concretely",
  "files": ["machine/..."], "category": "safety|quality|reliability|cost|debt",
  "impact": "high|medium|low", "effort": "low|medium|high", "confidence": 0.0-1.0}]"""


def propose(signals, model="local-brain"):
    import requests
    ev = "\n".join(f"[{s['kind']}, weight {s['weight']}] {s['title']}\n    {s['evidence']}"
                   for s in sorted(signals, key=lambda x: -x["weight"])[:18])
    body = {"model": model, "temperature": 0, "max_tokens": 6000,
            "messages": [{"role": "system", "content": SYSTEM},
                         {"role": "user", "content": "Evidence from the running system:\n\n" + ev}]}
    r = requests.post(ROUTER, json=body, timeout=900)
    r.raise_for_status()
    m = r.json()["choices"][0]["message"]
    raw = (m.get("content") or "").strip() or (m.get("reasoning_content") or "").strip()
    raw = raw.replace("```json", "").replace("```", "")
    m2 = re.search(r"\[.*\]", raw, re.S)
    return json.loads(m2.group(0)) if m2 else []


def score(p):
    imp = {"high": 3, "medium": 2, "low": 1}.get(p.get("impact", "medium"), 2)
    eff = {"low": 1, "medium": 2, "high": 4}.get(p.get("effort", "medium"), 2)
    conf = float(p.get("confidence", 0.5))
    return round(imp * conf / eff, 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--signals", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--model", default="local-brain")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    if args.list:
        items = [json.loads(p.read_text()) for p in sorted(OUT.glob("*.json"))]
        for p in sorted(items, key=lambda x: -x.get("score", 0)):
            print(f"  {p.get('score',0):5.2f}  [{p.get('status','open')}] {p.get('title','')[:70]}")
        print(f"\n{len(items)} proposals")
        return 0

    signals = collect()
    print(f"{len(signals)} signals collected")
    for s in sorted(signals, key=lambda x: -x["weight"]):
        print(f"  {s['weight']:2}  {s['kind']:14} {s['title'][:66]}")
    if args.signals:
        return 0
    if not signals:
        print("\nnothing to diagnose — the system reports no problems")
        return 0

    print("\ndiagnosing...")
    try:
        proposals = propose(signals, args.model)
    except Exception as e:
        print(f"diagnosis failed: {type(e).__name__}: {e}")
        return 1

    existing = {json.loads(p.read_text()).get("title", "") for p in OUT.glob("*.json")}
    written = 0
    for p in proposals:
        if p.get("title", "") in existing:
            continue
        p["id"] = dt.datetime.now().strftime("%Y%m%d-%H%M%S") + f"-{written:02d}"
        p["score"] = score(p)
        p["status"] = "open"
        p["created"] = dt.datetime.now().isoformat(timespec="seconds")
        (OUT / f"{p['id']}.json").write_text(json.dumps(p, indent=2))
        written += 1

    print(f"\n{written} new proposals ({len(proposals) - written} already known)\n")
    for p in sorted(proposals, key=lambda x: -score(x))[:8]:
        print(f"  {score(p):5.2f}  {p.get('title','')[:72]}")
        print(f"         why: {str(p.get('why',''))[:100]}")
    print(f"\nwritten to {OUT}")
    print("nothing is implemented without your approval")
    return 0


if __name__ == "__main__":
    sys.exit(main())

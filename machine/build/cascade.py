#!/usr/bin/env python3
"""
AgentHub build cascade.

Tiered execution: the cheapest capable executor first, escalating only when verification
fails. The escalation signal is the test suite, not model confidence — for code, correctness
is observable, and entropy-based confidence is miscalibrated and prompt-sensitive (UCCI 2026).
This is the single reason a cascade is safe here: the quality half is already instrumented.

  cascade.py "intent"              run through the tiers
  cascade.py --plan "intent"       classify and route only, execute nothing
  cascade.py --tier N "intent"     start at a given tier
  cascade.py --status <run-id>     read a previous run

Never commits to main. Every run works on a branch and ends as a proposal for review.
"""

import argparse, json, os, re, shutil, subprocess, sys, time, uuid
import datetime as dt
from pathlib import Path

HOME = Path.home()
REPO = HOME / "Workspace"                 # git root: machine/ and src/ in one tree
MACHINE = REPO / "machine"
SKILLS = MACHINE / "skills"
RUNS = MACHINE / "state" / "builds"
ROUTER = "http://127.0.0.1:4000/v1/chat/completions"

# Paths whose alteration is a security decision, never a routine edit.
PROTECTED = [
    "machine/scripts/approve.sh", "machine/scripts/selftest.py",
    "machine/console/console.py", "machine/canon/", "machine/launchd/",
    "machine/scripts/remote-agent.py",
]

# A change may never edit the tests in the same commit as the code they verify.
TEST_PATHS = ["machine/scripts/selftest.py", "machine/evals/"]

ARCHITECTURAL = re.compile(
    r"\b(refactor|migrat|redesign|rearchitect|rewrite|restructure|overhaul|"
    r"introduce\s+\w+\s+framework|replace\s+the)\b", re.I)

# Local tiers need their model resident. The 36GB envelope cannot hold the 27B and the 35B
# at once — LM Studio refuses the second load — so the cascade switches sets per tier.
# Tier 2 (27B) measured 263s and 390s and failed both times; tier 3 (35B) took 65s and
# produced better output than tier 4. The bench predicted it: 24.8 t/s against 114.9.
# Tier 3 is now the local entry point. Tier 2 remains reachable with --tier 2.
# Residency is tiered now: the core is pinned and the elastic tier is JIT with
# auto-evict. Naming a model loads it and evicts the previous one — no switching.
MODE_FOR_TIER = {}

TIERS = {
    1: ("local-triage", "4B classifier"),
    2: ("local-coder", "27B code model"),
    3: ("local-brain", "35B generalist"),
    4: ("claude", "Claude Code headless"),
}


def sh(cmd, timeout=600, cwd=REPO):
    env = dict(os.environ)
    env["PATH"] = ("/opt/homebrew/bin:" + str(HOME / ".local/bin") + ":" +
                   str(HOME / ".lmstudio/bin") + ":" + env.get("PATH", "/usr/bin:/bin"))
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                           timeout=timeout, cwd=str(cwd), env=env)
        return r.returncode, (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s"
    except Exception as e:
        return 1, f"{type(e).__name__}: {e}"


def load_skills(names):
    out = []
    for n in names:
        # Skills are spec-format directories now: <name>/SKILL.md, not <name>.md. The flat
        # form was silently missing after the conversion, so the cascade loaded no context
        # at all — `if p.exists()` turned a structural break into a quiet no-op.
        p = SKILLS / n / "SKILL.md"
        if not p.exists():
            p = SKILLS / f"{n}.md"
        if p.exists():
            out.append(p.read_text())
        else:
            print(f"  ! skill not found: {n}")
    return "\n\n---\n\n".join(out)


def router_call(alias, system, user, max_tokens=6000):
    import requests
    body = {"model": alias, "temperature": 0, "max_tokens": max_tokens,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": user}]}
    r = requests.post(ROUTER, json=body, timeout=900)
    if r.status_code >= 400:
        raise RuntimeError(f"router {r.status_code}: {r.text[:200]}")
    m = r.json()["choices"][0]["message"]
    return ((m.get("content") or "").strip() or (m.get("reasoning_content") or "").strip())


# ------------------------------------------------------------------ routing

def classify(intent):
    """Cheap rule-based pre-route. The literature is explicit that rules capture most of the
    value; a learned classifier is not worth its training cost at this volume."""
    reasons, tier = [], 2

    if ARCHITECTURAL.search(intent):
        tier = 4
        reasons.append("architectural verb in the intent")

    # Security concepts escalate on the concept, not on a file guess — a change to a control
    # must never route to the cheapest executor because a keyword table missed it.
    SECURITY = re.compile(r"\b(approv\w*|t2\b|dialog\w*|cors|origin\w*|allowlist|sensitiv\w*|"
                          r"s3\b|s1c\b|vault\w*|credential\w*|secret\w*|firewall\w*|"
                          r"publish\w*|deny|denie\w*)", re.I)
    if SECURITY.search(intent):
        tier = 4
        reasons.append("touches a security control")

    hints = []
    for kw, path in (("ask", "console/console.py"), ("retriev", "console/console.py"),
                     ("scope", "console/console.py"), ("endpoint", "console/console.py"),
                     ("approval", "scripts/approve.sh"), ("approve", "scripts/approve.sh"),
                     ("cors", "console/console.py"), ("allowlist", "scripts/remote-agent.py"),
                     ("sensitiv", "console/console.py"), ("publish", "scripts/remote-agent.py"),
                     ("selftest", "scripts/selftest.py"), ("verify", "scripts/selftest.py"),
                     ("ingest", "kbtool/ingest.py"), ("triage", "graphtool/pipeline.py"),
                     ("console", "console/console.py"), ("api", "console/console.py"),
                     ("agent", "scripts/remote-agent.py"), ("report", "report/build_report.py"),
                     ("eval", "kbtool/retrieval_eval.py"), ("canon", "canon/policies.md")):
        if kw in intent.lower():
            hints.append(f"machine/{path}")
    hints = sorted(set(hints))

    if len(hints) > 3:
        tier = max(tier, 4)
        reasons.append(f"{len(hints)} files implicated")

    for p in hints:
        if any(p.startswith(pp) or pp in p for pp in PROTECTED):
            tier = 4
            reasons.append(f"touches a protected path: {p}")
            break

    if re.search(r"\b(add|install|require)\b.*\b(package|dependency|library)\b", intent, re.I):
        tier = 4
        reasons.append("a new dependency is implied")

    if re.search(r"\b(format|lint|whitespace|typo|rename a variable|sort imports)\b", intent, re.I):
        tier = 0
        reasons = ["deterministic — no model required"]

    # Skills are selected by matching the intent against their descriptions, not by a
    # hardcoded list. That list froze my judgement into code and missed twice; this improves
    # as the descriptions improve, which the routing eval measures.
    skills = ["agenthub-cascade-rules", "agenthub-overview"]
    try:
        import requests
        sys.path.insert(0, str(HOME / "AgentHub" / "scripts"))
        from skills_lint import frontmatter
        cat = []
        for d in sorted((HOME / "AgentHub" / "skills").iterdir()):
            f = d / "SKILL.md"
            if not d.is_dir() or not f.exists():
                continue
            fm, _ = frontmatter(f.read_text(errors="ignore"))
            if fm and fm.get("description"):
                cat.append((d.name, fm["description"]))
        if cat:
            e = requests.post("http://127.0.0.1:4000/v1/embeddings", timeout=300,
                              json={"model": "local-embed",
                                    "input": [f"search_query: {intent}"] +
                                             [f"search_document: {c[1]}" for c in cat]})
            v = [d["embedding"] for d in sorted(e.json()["data"], key=lambda x: x["index"])]
            q, docs = v[0], v[1:]
            def cos(a, b):
                n = sum(x*y for x, y in zip(a, b))
                da = sum(x*x for x in a) ** 0.5
                db = sum(y*y for y in b) ** 0.5
                return n / (da*db) if da and db else 0.0
            scores = [cos(q, d) for d in docs]
            mean = sum(scores) / len(scores)
            sd = (sum((v - mean) ** 2 for v in scores) / len(scores)) ** 0.5 or 1e-9
            ranked = sorted(((sc, c[0]) for sc, c in zip(scores, cat)), reverse=True)
            # A skill earns its place by standing above the field, not by clearing a raw
            # cosine floor — nomic scores everything highly, so 0.35 admitted pure noise.
            # Two gates, not one. Separation says the winner stood above the field; the
            # margin over the next skill says it actually won. portfolio-guardian was
            # clearing 1.2sd on unrelated queries — a weak winner on everything.
            picked = []
            for i, (sc, n) in enumerate(ranked[:2]):
                sep = (sc - mean) / sd
                margin = (sc - ranked[i + 1][0]) / sd if i + 1 < len(ranked) else 9.0
                if sep >= 1.5 and margin >= 0.3:
                    picked.append(n)
            skills += picked
    except Exception:
        pass   # selection is an optimisation; a build must not fail because it is unavailable

    return {"tier": tier, "reasons": reasons or ["no escalation signal — start cheap"],
            "files": hints, "skills": sorted(set(skills))}


# ------------------------------------------------------------------ gate

def gate(changed):
    """Ground truth. Compile, restart anything whose code changed, then verify."""
    steps = []

    py = [f for f in changed if f.endswith(".py")]
    if py:
        code, out = sh(f"/usr/bin/python3 -m py_compile {' '.join(py)}", 120)
        steps.append(("compile", code == 0, out[:400]))
        if code != 0:
            return False, steps

    # A file edit does not reach a running process. Restart what changed, or the service
    # checks below would pass against the old code and the gate would be blind.
    if any("console/console.py" in f for f in changed):
        sh(f"launchctl kickstart -k gui/{os.getuid()}/com.agenthub.console", 60)
        time.sleep(10)
        code, _ = sh("curl -sf -m 8 http://127.0.0.1:4100/api/capabilities", 20)
        steps.append(("console restarts", code == 0, "did not come back" if code else "ok"))
        if code != 0:
            return False, steps

    # No worse than before, not perfect. Demanding zero failures means one pre-existing
    # problem blocks every build permanently — which it did, twice. The change must not
    # make things worse; it is not responsible for what was already broken.
    def _counts(txt):
        m = re.search(r"(\d+) passed . (\d+) warnings . (\d+) failed", txt)
        return (int(m.group(1)), int(m.group(3))) if m else (0, 99)

    before = globals().get("_BASELINE")
    code, out = sh("/usr/bin/python3 " + str(MACHINE / "scripts/selftest.py") + " --quiet", 400)
    p_now, f_now = _counts(out)
    if before is None:
        ok = f_now == 0
        detail = (f"{p_now} passed, {f_now} failed" +
                  ("" if ok else " — no baseline, and failures exist"))
    else:
        p_was, f_was = before
        ok = f_now <= f_was and p_now >= p_was - 1
        detail = f"{p_now} passed / {f_now} failed  (was {p_was} / {f_was})"
    steps.append(("verify", ok, detail))
    if not ok:
        return False, steps

    if any(k in " ".join(changed) for k in ("pipeline.py", "triage_set")):
        code, out = sh(str(MACHINE / "scripts/eval"), 900)
        inj = re.search(r"injection: (\d+)/(\d+)", out)
        ok = bool(inj) and inj.group(1) == inj.group(2)
        steps.append(("triage eval", ok, inj.group(0) if inj else "not scored"))
        if not ok:
            return False, steps

    if any(k in " ".join(changed) for k in ("ingest.py", "retrieval_eval", "retrieval_set")):
        code, out = sh(str(MACHINE / "scripts/eval-kb"), 900)
        ref = re.search(r"correct refusals: (\d+)/(\d+)", out)
        ok = bool(ref) and ref.group(1) == ref.group(2)
        steps.append(("retrieval eval", ok, ref.group(0) if ref else "not scored"))
        if not ok:
            return False, steps

    return True, steps


def guard_tests_and_code(changed):
    """A system that can weaken its own tests to pass them is not self-improving."""
    touches_tests = any(any(t in f for t in TEST_PATHS) for f in changed)
    touches_code = any(not any(t in f for t in TEST_PATHS) for f in changed)
    if touches_tests and touches_code:
        return False, ("this change edits both the tests and the code they verify — "
                       "split it, or the verification proves nothing")
    return True, ""


# ------------------------------------------------------------------ execute

SYSTEM = """You modify Kos Bajpai's AgentHub. Make the smallest change that satisfies the
intent.

Rules that are not negotiable:
- Never edit machine/scripts/selftest.py or machine/evals/ in the same change as the code
  they verify.
- Never weaken a security control: the approval dialog, the CORS allowlist, the sensitivity
  filter in the ask endpoint, or the publish allowlist.
- If the intent is ambiguous, reply with IMPOSSIBLE and one line of reason."""

LOCAL_SYSTEM = SYSTEM + """

You are given the complete current content of ONE file. Return the COMPLETE new content of
that file between the markers below, and nothing else. No explanation, no diff, no markdown
fences, no commentary before or after.

<<<FILE>>>
(the entire file, including every unchanged line)
<<<END>>>"""

PATHISH = re.compile(r"\b((?:machine|src|supabase)/[\w./-]+\.\w+)")


def target_file(intent, ctx):
    """Local tiers handle exactly one file. More than one escalates."""
    named = PATHISH.findall(intent)
    candidates = sorted(set(named) | set(ctx["files"]))
    return candidates[0] if len(candidates) == 1 else None


def extract_file(out):
    m = re.search(r"<<<FILE>>>\n?(.*?)\n?<<<END>>>", out, re.S)
    if m:
        return m.group(1)
    # Some models drop the closing marker when they run long.
    m = re.search(r"<<<FILE>>>\n?(.*)", out, re.S)
    return m.group(1).rstrip() if m and len(m.group(1)) > 80 else None


def run_tier(tier, intent, ctx, trace, branch):
    alias, label = TIERS[tier]
    skills = load_skills(ctx["skills"])
    files = "\n".join(ctx["files"]) or "(determine from the intent)"
    prior = ("\n\nA previous attempt failed. Do not repeat it.\n" + trace[-2000:]) if trace else ""

    if tier == 4:
        prompt = (f"{SYSTEM}\n\n## Project skills\n{skills}\n\n## Intent\n{intent}\n"
                  f"\n## Likely files\n{files}{prior}\n\n"
                  "Apply the change directly in this repository, then stop. "
                  "Do not commit, do not push.")
        RUNS.mkdir(parents=True, exist_ok=True)
        pf = RUNS / "prompt.txt"
        pf.write_text(prompt)
        code, out = sh(f"claude -p --permission-mode acceptEdits --max-budget-usd 2.00 "
                       f"--add-dir {REPO} < {pf}", 1800)
        if code != 0 or "IMPOSSIBLE" in out[:200] or "permission" in out[:400].lower():
            code, out2 = sh(f"codex exec --skip-git-repo-check --full-auto \"$(cat {pf})\"", 1800)
            out = out + "\n--- codex fallback ---\n" + out2
        return out

    tf = target_file(intent, ctx)
    if not tf:
        return "no single target file — a local tier handles one file at a time"
    fp = REPO / tf
    if not fp.exists():
        return f"target does not exist: {tf}"

    user = (f"## Project skills\n{skills}\n\n## Intent\n{intent}\n"
            f"\n## File: {tf}\n<<<FILE>>>\n{fp.read_text()}\n<<<END>>>{prior}")
    out = router_call(alias, LOCAL_SYSTEM, user, max_tokens=16000)

    if "IMPOSSIBLE" in out[:200]:
        return out[:400]
    new = extract_file(out)
    if not new or len(new) < 40:
        return "no complete file returned between the markers\n" + out[-600:]
    fp.write_text(new if new.endswith("\n") else new + "\n")
    return f"wrote {tf} ({len(new)} chars)"


def changed_files():
    _, out = sh("git diff --name-only HEAD", 60)
    return [l for l in out.splitlines() if l.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("intent", nargs="*")
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--tier", type=int, default=0)
    args = ap.parse_args()
    intent = " ".join(args.intent).strip()
    if not intent:
        sys.exit("an intent is required")

    ctx = classify(intent)
    start = args.tier or max(ctx["tier"], 3)   # local entry point is tier 3, on evidence

    if args.plan:
        print(json.dumps({"intent": intent, **ctx, "starting_tier": start}, indent=2))
        return 0

    rid = dt.datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]
    RUNS.mkdir(parents=True, exist_ok=True)
    branch = "build/" + re.sub(r"[^a-z0-9]+", "-", intent.lower())[:40].strip("-") + "-" + rid[-4:]
    try:
        sys.path.insert(0, str(HOME / "AgentHub" / "console"))
        import sessions
        sessions.log("skill-activation", intent, ", ".join(ctx["skills"]), "cascade")
    except Exception:
        pass
    record = {"id": rid, "intent": intent, "branch": branch, "context": ctx,
              "started": dt.datetime.now().isoformat(timespec="seconds"), "attempts": []}

    # Snapshot the health of the tree before touching it, so the gate can compare.
    print("baseline...")
    _b = sh("/usr/bin/python3 " + str(MACHINE / "scripts/selftest.py") + " --quiet", 400)[1]
    _m = re.search(r"(\d+) passed . (\d+) warnings . (\d+) failed", _b)
    globals()["_BASELINE"] = (int(_m.group(1)), int(_m.group(3))) if _m else None
    if _m:
        print(f"  {_m.group(1)} passed, {_m.group(3)} failed before the change")

    code, out = sh("git rev-parse --abbrev-ref HEAD", 30)
    base = out.strip()
    if sh("git status --porcelain", 30)[1].strip():
        sys.exit("the working tree is dirty — commit or stash before a build")
    sh(f"git checkout -q -b {branch}", 60)

    trace, resolved = "", None
    try:
        for tier in range(start, 5):
            alias, label = TIERS[tier]
            print(f"\n=== tier {tier} · {label} ===")
            t0 = time.time()
            try:
                output = run_tier(tier, intent, ctx, trace, branch)
            except Exception as e:
                output = f"executor error: {e}"
            changed = changed_files()
            attempt = {"tier": tier, "executor": label, "seconds": round(time.time() - t0),
                       "changed": changed, "output": output[-1500:]}

            if not changed:
                attempt["result"] = "no change produced"
                record["attempts"].append(attempt)
                trace += f"\n[tier {tier}] produced no change:\n{output[-800:]}"
                print("  no change produced — escalating")
                continue

            ok, why = guard_tests_and_code(changed)
            if not ok:
                attempt["result"] = "refused: " + why
                record["attempts"].append(attempt)
                print("  REFUSED —", why)
                sh("git checkout -q -- . && git clean -qfd", 60)
                break

            passed, steps = gate(changed)
            attempt["gate"] = [{"step": s, "ok": o, "detail": d} for s, o, d in steps]
            attempt["result"] = "passed" if passed else "failed verification"
            record["attempts"].append(attempt)
            for s, o, d in steps:
                print(f"  {'ok  ' if o else 'FAIL'} {s}: {d}")

            if passed:
                resolved = tier
                break
            trace += (f"\n[tier {tier}] failed verification:\n"
                      + "\n".join(f"{s}: {d}" for s, o, d in steps if not o))
            sh("git checkout -q -- . && git clean -qfd", 60)
            if any("console/console.py" in f for f in changed):
                sh(f"launchctl kickstart -k gui/{os.getuid()}/com.agenthub.console", 60)
                time.sleep(8)
            print("  reverted — escalating")
    finally:
        record["resolved_at_tier"] = resolved
        record["finished"] = dt.datetime.now().isoformat(timespec="seconds")
        if resolved:
            _, diff = sh("git diff HEAD", 120)
            record["diff"] = diff[:60000]
            sh(f"git add -A && git commit -q -m 'build: {intent[:60]}'", 120)
            print(f"\nresolved at tier {resolved} · branch {branch}")
            print("this is now a proposal — review and approve before it merges")
        else:
            sh(f"git checkout -q {base} && git branch -qD {branch}", 60)
            print(f"\nno tier produced a verified change · branch discarded")
        (RUNS / f"{rid}.json").write_text(json.dumps(record, indent=2))
        print(f"run -> {RUNS / (rid + '.json')}")

    return 0 if resolved else 1


if __name__ == "__main__":
    sys.exit(main())

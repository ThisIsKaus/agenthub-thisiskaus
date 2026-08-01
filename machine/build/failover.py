#!/usr/bin/env python3
"""
AgentHub failover ladder.

Five rungs. Each has a trigger, an action, and a test that fires it deliberately — because a
rung that has never been fired is a claim, not a behaviour. That distinction is what the
hollow-backup incident taught: a mechanism reporting success without being exercised is worse
than no mechanism, because it carries false confidence.

Rung 5 is the one that must never be relaxed. Falling back to a metered cloud lane is a
sensitivity decision wearing the costume of an availability decision. Classified work fails
closed and says so.

  failover.py check           evaluate every rung, act where needed
  failover.py --test <n>      fire rung n deliberately
  failover.py --status        last test date and result per rung
"""

import json, os, subprocess, sys, time
import datetime as dt
from pathlib import Path

H = Path.home() / "AgentHub"
STATE = H / "state" / "failover.json"

LADDER = {
    "35b": ["qwen3.6-35b-a3b", "openai/gpt-oss-20b", "qwen3.5-4b"],
    "27b": ["qwen3.6-27b", "qwen3.6-35b-a3b", "openai/gpt-oss-20b"],
}
CLASSIFIED = {"S1c", "S2", "S3"}


def sh(cmd, timeout=120):
    env = dict(os.environ)
    env["PATH"] = ("/opt/homebrew/bin:" + str(Path.home() / ".local/bin") + ":" +
                   str(Path.home() / ".lmstudio/bin") + ":" + env.get("PATH", "/usr/bin:/bin"))
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                           timeout=timeout, env=env)
        return r.returncode, (r.stdout + r.stderr).strip()
    except Exception as e:
        return 1, f"{type(e).__name__}: {e}"


def probe(url, timeout=6):
    return sh(f"curl -sf -m {timeout} {url} >/dev/null")[0] == 0


def memory():
    sys.path.insert(0, str(H / "scripts"))
    try:
        import memory_state
        return memory_state.collect()
    except Exception as e:
        return {"pressure": "unknown", "error": str(e)}


def record(rung, ok, detail):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    try:
        d = json.loads(STATE.read_text())
    except Exception:
        d = {}
    d[str(rung)] = {"tested": dt.datetime.now().isoformat(timespec="seconds"),
                    "ok": ok, "detail": detail[:300]}
    STATE.write_text(json.dumps(d, indent=2))


# ---------------------------------------------------------------- rungs

def rung1(test=False):
    """Model unavailable — fall down the capability ladder, and say which model answered."""
    chain = LADDER["35b"]
    if test:
        chain = ["nonexistent-model-canary"] + chain
    for model in chain:
        code, out = sh(
            "curl -s -m 240 http://127.0.0.1:1234/v1/chat/completions "
            '-H "Content-Type: application/json" -d ' +
            json.dumps(json.dumps({"model": model, "max_tokens": 4, "ttl": 1200,
                                   "messages": [{"role": "user", "content": "ok"}]})), 300)
        if code == 0 and "insufficient system resources" not in out and '"error"' not in out[:200]:
            sub = model != chain[0]
            return True, (f"substituted {model} for {chain[0]}" if sub else f"{model} answered")
    return False, "every model in the ladder failed"


def rung2(test=False):
    """Serving layer down — restart it and re-pin the core."""
    if test:
        sh("lms server stop", 60)
        time.sleep(3)
    if probe("http://127.0.0.1:1234/v1/models"):
        return True, "serving layer healthy"
    sh("lms server start", 120)
    time.sleep(12)
    sh(f"{H}/scripts/residency pin", 300)
    ok = probe("http://127.0.0.1:1234/v1/models")
    return ok, "restarted and re-pinned" if ok else "restart did not recover it"


def rung3(test=False):
    """Router down — kickstart the supervised job."""
    if test:
        sh(f"launchctl kill 9 gui/{os.getuid()}/com.agenthub.router", 30)
        time.sleep(2)
    if probe("http://127.0.0.1:4000/v1/models"):
        return True, "router healthy"
    sh(f"launchctl kickstart -k gui/{os.getuid()}/com.agenthub.router", 60)
    time.sleep(12)
    ok = probe("http://127.0.0.1:4000/v1/models")
    return ok, "kickstarted" if ok else "router did not come back"


def rung4(test=False):
    """Memory pressure critical — evict the elastic tier, hold the core."""
    m = memory()
    if test or m.get("pressure") == "red":
        sh(f"{H}/scripts/residency clear", 120)
        after = memory()
        held = after.get("core_intact", False)
        return held, (f"elastic evicted, core {'held' if held else 'LOST'}, "
                      f"pressure {after.get('pressure')}")
    return True, f"pressure {m.get('pressure')} — no action needed"


def rung5(sensitivity="S0", test=False):
    """All local unavailable — cloud only if the work is not classified. Fails closed."""
    local_up = probe("http://127.0.0.1:1234/v1/models") and not test
    if local_up:
        return True, "local available — rung not engaged"
    if sensitivity in CLASSIFIED:
        return True, (f"REFUSED cloud fallback for {sensitivity} — classified work fails "
                      "closed rather than escalating to a metered lane")
    ok = probe("http://127.0.0.1:4000/v1/models")
    return ok, ("cloud lane available for unclassified work" if ok
                else "no lane available at all")


RUNGS = {1: ("model unavailable", rung1), 2: ("serving layer down", rung2),
         3: ("router down", rung3), 4: ("memory pressure critical", rung4),
         5: ("all local down", rung5)}


def main():
    if "--status" in sys.argv:
        try:
            d = json.loads(STATE.read_text())
        except Exception:
            d = {}
        for n, (name, _) in RUNGS.items():
            e = d.get(str(n))
            mark = ("never tested" if not e else
                    ("pass " + e["tested"][:16]) if e["ok"] else ("FAIL " + e["tested"][:16]))
            print(f"  rung {n}  {name:26} {mark}")
        return 0

    if "--test" in sys.argv:
        n = int(sys.argv[sys.argv.index("--test") + 1])
        name, fn = RUNGS[n]
        print(f"firing rung {n} · {name}")
        if n == 5:
            for s in ("S0", "S3"):
                ok, detail = fn(sensitivity=s, test=True)
                print(f"  {s}: {'ok  ' if ok else 'FAIL'} {detail}")
                record(f"5-{s}", ok, detail)
            return 0
        ok, detail = fn(test=True)
        print(f"  {'ok  ' if ok else 'FAIL'} {detail}")
        record(n, ok, detail)
        return 0 if ok else 1

    failed = 0
    for n, (name, fn) in RUNGS.items():
        ok, detail = fn()
        print(f"  rung {n}  {'ok  ' if ok else 'FAIL'} {name:26} {detail}")
        record(n, ok, detail)
        failed += not ok
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

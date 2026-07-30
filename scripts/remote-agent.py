#!/usr/bin/env python3
"""
AgentHub remote agent.

Bridges the Mac to a hosted companion app WITHOUT accepting any inbound connection.
Polls Supabase outbound on a timer, exactly as the machine already polls Anthropic and
Backblaze. The firewall stays at State 2; nothing listens.

Sensitivity is enforced here, at the source, not in the cloud:
  - publish_state() builds its payload from a NAMED ALLOWLIST, never by filtering a record
  - digest data is published as COUNTS ONLY — no subjects, summaries, paths or filenames
  - nothing classed S1c, S2 or S3 is ever serialised, at any level of nesting
  - a canary asserts this on every publish and refuses to send if it trips

  remote-agent.py            run once
  remote-agent.py --loop     poll continuously (used by launchd)
  remote-agent.py --dry      print what would be published, send nothing
  remote-agent.py --canary   run the leak canary and exit
"""

import json, os, re, subprocess, sys, time
import datetime as dt
from pathlib import Path

import requests

H = Path.home() / "AgentHub"
FAC = Path.home() / "Factory"
sys.path.insert(0, str(H / "scripts"))
try:
    import machine_state
except Exception:
    machine_state = None
sys.path.insert(0, str(H / "report"))
try:
    import build_report as br
except Exception:
    br = None

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
POLL_SECONDS = 30
CLAIM_TIMEOUT_MIN = 10

# Fields the agent is permitted to publish. Anything not named here never leaves.
PUBLISH_ALLOWLIST = {
    "services": {"lms", "router", "aliases"},
    "models": None,                       # list of resident model names
    "corpus": {"chunks", "documents"},
    "spend": {"mtd", "requests"},
    "factory": {"wip", "limit", "projects"},
    "digest": {"date", "items", "flags", "tasks"},   # COUNTS ONLY
    "health": {"passed", "warnings", "failed", "at"},
    "machine": {"posture", "power", "sleep", "schedule", "uptime", "thermal", "collected_at"},
}

# Strings that must never appear in a published payload.
LEAK_MARKERS = re.compile(
    r"(passport|aadhaa?r|payslip|pay[\s_-]?slip|bank\s*statement|mortgage|tax\s*return|"
    r"medicare|driver.{0,3}licen|vinnies|meesho|neelam|salary|superannuation|"
    r"/Users/[^/]+/Library/CloudStorage)", re.I)


def hdrs():
    return {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json", "Prefer": "return=representation"}


def sh(cmd, timeout=120):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return (r.stdout + r.stderr).strip()
    except Exception as e:
        return f"error: {e}"


def prune(value, allowed):
    """Keep only allowlisted keys. Unknown keys are dropped, never filtered."""
    if allowed is None:
        return value
    if not isinstance(value, dict):
        return {}
    return {k: v for k, v in value.items() if k in allowed}


def corpus_stats():
    try:
        import lancedb
        t = lancedb.connect(str(H / "kb")).open_table("kb_main")
        df = t.to_pandas()[["path"]]
        return {"chunks": int(len(df)), "documents": int(df["path"].nunique())}
    except Exception:
        return {"chunks": 0, "documents": 0}


def health_summary():
    files = sorted((H / "logs").glob("selftest-*.md"), reverse=True)
    if not files:
        return {"passed": 0, "warnings": 0, "failed": 0, "at": None}
    m = re.search(r"\*\*(\d+) passed . (\d+) warnings . (\d+) failed\*\*",
                  files[0].read_text(errors="ignore"))
    ts = dt.datetime.fromtimestamp(files[0].stat().st_mtime).isoformat(timespec="seconds")
    if not m:
        return {"passed": 0, "warnings": 0, "failed": 0, "at": ts}
    return {"passed": int(m.group(1)), "warnings": int(m.group(2)),
            "failed": int(m.group(3)), "at": ts}


def build_payload():
    """Assemble the published state from allowlisted fields only."""
    s = br.collect() if br else {}
    dg = s.get("digest") or {}
    raw = {
        "services": {"lms": bool(s.get("lms")), "router": bool(s.get("router")),
                     "aliases": int(s.get("aliases") or 0)},
        "models": list(s.get("resident") or []),
        "corpus": corpus_stats(),
        "spend": {"mtd": float((s.get("spend") or {}).get("mtd") or 0),
                  "requests": int((s.get("spend") or {}).get("requests") or 0)},
        "factory": {"wip": int((s.get("factory") or {}).get("wip") or 0),
                    "limit": int((s.get("factory") or {}).get("limit") or 2),
                    "projects": [{"name": p.get("name"), "entity": p.get("entity"),
                                  "stage": p.get("stage"), "status": p.get("status")}
                                 for p in (s.get("factory") or {}).get("projects", [])]},
        # counts only — never item text, never sources
        "digest": {"date": dg.get("date"), "items": int(dg.get("items") or 0),
                   "flags": int(dg.get("flags") or 0),
                   "tasks": len(dg.get("needs") or [])},
        "health": health_summary(),
        "machine": (machine_state.collect() if machine_state else {}),
    }
    return {k: prune(v, PUBLISH_ALLOWLIST[k]) for k, v in raw.items()}


def canary(payload):
    """Refuse to publish if anything sensitive appears anywhere in the payload."""
    blob = json.dumps(payload)
    hit = LEAK_MARKERS.search(blob)
    return (None if not hit else hit.group(0))


def publish(payload, dry=False):
    leak = canary(payload)
    if leak:
        print(f"REFUSED TO PUBLISH — leak marker '{leak}' found in payload")
        return False
    if dry:
        print(json.dumps(payload, indent=2))
        return True
    body = dict(payload)
    body["id"] = "current"
    body["updated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    r = requests.post(f"{SUPABASE_URL}/rest/v1/state?on_conflict=id",
                      headers={**hdrs(), "Prefer": "resolution=merge-duplicates"},
                      json=body, timeout=30)
    ok = r.status_code < 300
    if not ok:
        print(f"publish failed {r.status_code}: {r.text[:200]}")
    return ok


# ------------------------------------------------------------------ jobs

def run_job(job):
    kind = job.get("kind")
    p = job.get("payload") or {}
    if kind == "capture":
        text = str(p.get("text") or "").strip()
        if not text:
            return False, "empty capture"
        (H / "inbox").mkdir(exist_ok=True)
        f = H / "inbox" / f"capture-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}.md"
        f.write_text(f"# Capture {dt.datetime.now().isoformat(timespec='minutes')}\n"
                     f"_via remote_\n\n{text}\n")
        return True, f.name
    if kind == "ingest":
        return True, sh(f"cd {H}/kbtool && /opt/homebrew/bin/uv run python "
                        f"{H}/kbtool/ingest.py --incremental", 3600)[-400:]
    if kind == "intake":
        return True, sh(f"{H}/scripts/intake", 1800)[-400:]
    if kind == "report":
        return True, sh(f"/opt/homebrew/bin/uv run --python 3.12 "
                        f"{H}/report/build_report.py", 300)[-200:]
    if kind == "factory_stage":
        name, stage = p.get("name"), p.get("stage")
        if not name or not stage:
            return False, "name and stage required"
        return True, sh(f"{H}/scripts/factory stage {name} {stage}", 60)[-200:]
    return False, f"unknown job kind: {kind}"


def process_jobs():
    stale = (dt.datetime.now(dt.timezone.utc)
             - dt.timedelta(minutes=CLAIM_TIMEOUT_MIN)).isoformat()
    requests.patch(f"{SUPABASE_URL}/rest/v1/jobs?status=eq.claimed&claimed_at=lt.{stale}",
                   headers=hdrs(), json={"status": "queued"}, timeout=20)

    r = requests.get(f"{SUPABASE_URL}/rest/v1/jobs?status=eq.queued&order=created_at.asc&limit=5",
                     headers=hdrs(), timeout=20)
    if r.status_code >= 300:
        print(f"poll failed {r.status_code}")
        return 0
    done = 0
    for job in r.json():
        jid = job["id"]
        c = requests.patch(f"{SUPABASE_URL}/rest/v1/jobs?id=eq.{jid}&status=eq.queued",
                           headers=hdrs(),
                           json={"status": "claimed",
                                 "claimed_at": dt.datetime.now(dt.timezone.utc).isoformat()},
                           timeout=20)
        if c.status_code >= 300 or not c.json():
            continue
        try:
            ok, detail = run_job(job)
        except Exception as e:
            ok, detail = False, f"{type(e).__name__}: {e}"
        requests.patch(f"{SUPABASE_URL}/rest/v1/jobs?id=eq.{jid}", headers=hdrs(),
                       json={"status": "done" if ok else "failed",
                             "completed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                             "result": {"detail": str(detail)[:500]} if ok else None,
                             "error": None if ok else str(detail)[:500]}, timeout=20)
        with open(H / "logs" / "audit.jsonl", "a") as f:
            f.write(json.dumps({"ts": dt.datetime.now().isoformat(timespec="seconds"),
                                "note": f"remote job {job.get('kind')} -> "
                                        f"{'done' if ok else 'failed'}"}) + "\n")
        done += 1
    return done


def cycle(dry=False):
    payload = build_payload()
    published = publish(payload, dry=dry)
    n = 0 if dry else process_jobs()
    print(f"{dt.datetime.now().strftime('%H:%M:%S')} published={published} jobs={n}")


def main():
    if "--canary" in sys.argv:
        bad = {"digest": {"items": 3, "sample": "Neelam passport renewal"}}
        good = build_payload()
        print("hostile payload blocked:", canary(bad) is not None)
        print("real payload clean:    ", canary(good) is None)
        sys.exit(0 if (canary(bad) and not canary(good)) else 1)

    dry = "--dry" in sys.argv
    if not dry and (not SUPABASE_URL or not SERVICE_KEY):
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set — use with-secrets.sh")

    if "--loop" in sys.argv:
        while True:
            try:
                cycle()
            except Exception as e:
                print(f"cycle error: {type(e).__name__}: {e}")
            time.sleep(POLL_SECONDS)
    else:
        cycle(dry=dry)


if __name__ == "__main__":
    main()

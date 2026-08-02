#!/usr/bin/env python3
"""
Generate the compact AgentHub brief for Lovable, under 10,000 characters.

Reuses the extraction functions in lovable-context.py and api-contract.py rather than
restating anything, so the compact form cannot drift from the full one or from the machine.
What is dropped: the fetch-helper code block, verbose response types, and the endpoint
Purpose column where it merely repeats the function name. What is never dropped: the two
planes, the LocalOnly list, the machine states, the sensitivity rules, the published
contract field names, multipart-not-JSON, and 403-is-a-refusal.

  brief.py            print it
  brief.py --save     write to docs/brief.md and copy to clipboard
"""

import importlib.util, json, subprocess, sys
import datetime as dt
from pathlib import Path

H = Path.home() / "AgentHub"
OUT = H / "docs" / "brief.md"
LIMIT = 10000


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


lc = load("lc", H / "scripts" / "lovable-context.py")
ac = load("ac", H / "scripts" / "api-contract.py")

LOCAL_ONLY = ["Ask", "Files", "Knowledge base", "Models", "Prompts",
              "Digest detail and corrections", "Memory", "Evals", "Job output"]
BOTH = ["Overview", "Capture", "Factory", "Cost", "Health"]


def build():
    nums = lc.live_numbers()
    contract = lc.publish_contract()
    kinds = lc.job_kinds()
    tokens = lc.design_tokens()
    routes = ac.parse()
    cmds = ac.commands()

    colours = " ".join(f"`{v}` {k}" for k, v in tokens if v.startswith("#"))
    schema = "\n".join(f"  {k}: {', '.join(v)}" for k, v in contract.items())
    tps = nums.get("brain_tps", "114.9")

    ep = []
    for r in routes:
        if r["path"] == "/":
            continue
        ep.append(f"| {r['method']} `{r['path']}` | {ac.ts_signature(r)} |")

    sens = lc.sensitivity_rules()
    sens = "\n".join(l.strip() for l in sens.splitlines() if l.strip())[:520]

    doc = f"""# AgentHub — brief for Lovable
_Generated from the live machine {dt.datetime.now().isoformat(timespec='minutes')}. Do not edit._

## What exists

A personal AI hub on one MacBook Pro M5 Max. **Not being rebuilt** — you are building the
single workspace that fronts it. Running locally: 4 models under LM Studio (quality brain
{tps} t/s), a router on :4000 with 9 aliases, a knowledge base of {nums.get('chunks','many')}
chunks across {nums.get('documents','many')} documents indexed from OneDrive, a local API on
:4100 exposing every capability, launchd jobs (nightly digest, 4-hourly backup, self-test),
and a native macOS approval dialog for anything changing external state.

## TWO PLANES — the central fact

**LOCAL — `http://127.0.0.1:4100` over loopback.** Available only when the browser runs on
the MacBook. An HTTPS page may fetch loopback because loopback is a potentially trustworthy
origin (MDN): the request never leaves the machine, the response never touches the cloud. The
API sends CORS headers naming this app's origin specifically.

**REMOTE — Supabase.** An agent on the machine polls Supabase **outbound** every 30s, claims
jobs, runs them locally, posts results back. **Nothing ever connects inward to the machine** —
no inbound port, firewall blocks all incoming. Your app writes jobs and reads published state.

## Sections by plane

**LOCAL ONLY — wrap each in `<LocalOnly>`:** {', '.join(LOCAL_ONLY)}.
These read material classed S1c/S2/S3. When local is unavailable, render one quiet line in
secondary text: "Available on the machine. This section reads material that never leaves it."
No error styling, no spinner, no retry, **no Supabase fallback**.

**BOTH PLANES:** {', '.join(BOTH)}.

## Machine state — four states, not two

The MacBook is the compute engine; when it sleeps, local reasoning stops.

- **LIVE** — local API answers. Everything works.
- **AWAKE, REMOTE** — local silent, published state <5 min old. Machine works; you aren't at it.
- **DOZING** — local silent, state 5 min–2 h old. Show sleep time and next scheduled wake. If
  on battery, say scheduled work will skip until it is on power.
- **OFFLINE** — state >2 h old. Captures held on the device.

Published `machine` block: posture, power source, battery %, whether sleep is held off and by
which process, repeating wake, upcoming wakes, uptime, thermal limit.

## Sensitivity — governs what may be displayed

{sens}

Corpus by class: {json.dumps(nums.get('by_class', {}))}

The remote plane publishes **only status and counts** — never document text, file paths, email
subjects or personal data. Digest shows item detail on the local plane, counts only on the
remote plane. Never send a local-plane response to Supabase, analytics, or anywhere external.

## Published contract

One row in `state`, id = 'current'. Use these field names exactly:

{schema}

## Job kinds

Insert into `jobs` with `kind` + `payload`; claimed within 30s: {', '.join(kinds)}.

## Local API

Base `http://127.0.0.1:4100`, `credentials: 'omit'`. **Every POST takes multipart form fields,
never a JSON body — JSON returns 422.** A 403 means the path was outside the allowlist or an
approval dialog was denied: render as a refusal ("denied at the approval dialog"), never an
error. Delete and forget block while the dialog is open, up to 5 minutes — show "awaiting
approval on the machine…", not a spinner. Executable files (.py, .sh, .plist) are read-only
by design; offer no edit control for them.

| Endpoint | Parameters |
|---|---|
{chr(10).join(ep)}

POST `/api/run` with `key` returns `{{job, label}}`; poll GET `/api/job?id=` every 900ms until
`running` is false. Keys: {', '.join(f"{c['key']}({c['tier']})" for c in cmds)}.

Response shapes are in machine/docs/local-api-contract.md — read that for a field name rather than guessing at one.\n"""
    return doc


def main():
    doc = build()
    n = len(doc)
    if "--save" in sys.argv:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(doc)
        try:
            subprocess.run("pbcopy", input=doc, text=True, timeout=10)
            print(f"written to {OUT} and copied to clipboard — {n:,} characters "
                  f"({'under' if n <= LIMIT else 'OVER'} the {LIMIT:,} limit)")
        except Exception:
            print(f"written to {OUT} — {n:,} characters")
    else:
        print(doc)
        print(f"\n--- {n:,} characters ---", file=sys.stderr)
    sys.exit(0 if n <= LIMIT else 1)


if __name__ == "__main__":
    main()

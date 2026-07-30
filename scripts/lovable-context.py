#!/usr/bin/env python3
"""
Generate the AgentHub context document for Lovable, from live machine state.

The point: nothing here is written from memory. Every field name, design token,
sensitivity class and job kind is read from the running system, so the document
Lovable builds against cannot drift from what the machine actually publishes.

  lovable-context.py            print the document
  lovable-context.py --save     write it to docs/lovable-context.md and copy to clipboard
"""

import json, re, subprocess, sys
import datetime as dt
from pathlib import Path

H = Path.home() / "AgentHub"
OUT = H / "docs" / "lovable-context.md"


def read(p, default=""):
    try:
        return (H / p).read_text(errors="ignore")
    except Exception:
        return default


def design_tokens():
    """Read the actual CSS variables the local console uses."""
    css = read("console/console.html")
    m = re.search(r":root\{(.*?)\}", css, re.S)
    if not m:
        return []
    out = []
    for name, val in re.findall(r"--([\w-]+):\s*([^;]+);", m.group(1)):
        v = val.strip()
        if v.startswith("#") or "serif" in v or "Inter" in v or "Mono" in v:
            out.append((name, v))
    return out


def publish_contract():
    """Read the allowlist from remote-agent.py — the definitive shape of published data."""
    src = read("scripts/remote-agent.py")
    m = re.search(r"PUBLISH_ALLOWLIST = \{(.*?)\n\}", src, re.S)
    if not m:
        return {}
    contract = {}
    for key, fields in re.findall(r'"(\w+)":\s*(\{[^}]*\}|None)', m.group(1)):
        if fields == "None":
            contract[key] = ["(list)"]
        else:
            contract[key] = re.findall(r'"(\w+)"', fields)
    return contract


def job_kinds():
    src = read("scripts/remote-agent.py")
    return sorted(set(re.findall(r'kind == "(\w+)"', src)))


def sensitivity_rules():
    canon = read("canon/policies.md")
    m = re.search(r"## Sensitivity classes(.*?)(?=\n## )", canon, re.S)
    return (m.group(1).strip() if m else "S0 public · S1p products · S1c client · "
            "S2 Envelope Collective · S3 personal position")[:900]


def live_numbers():
    n = {}
    try:
        import lancedb
        t = lancedb.connect(str(H / "kb")).open_table("kb_main")
        df = t.to_pandas()[["path", "sensitivity"]]
        n["chunks"] = len(df)
        n["documents"] = df["path"].nunique()
        n["by_class"] = df.drop_duplicates("path")["sensitivity"].value_counts().to_dict()
    except Exception:
        pass
    try:
        for line in read("models.lock.yaml").splitlines():
            g = re.search(r"role:\s*(\S+?),.*?gen_tps:\s*([\d.]+)", line)
            if g and g.group(1) == "quality-brain":
                n["brain_tps"] = g.group(2)
    except Exception:
        pass
    return n


def main():
    tokens = design_tokens()
    contract = publish_contract()
    kinds = job_kinds()
    nums = live_numbers()

    colours = [f"`{v}` {k}" for k, v in tokens if v.startswith("#")]
    fonts = [f"{k}: {v}" for k, v in tokens if not v.startswith("#")]

    schema_lines = []
    for key, fields in contract.items():
        schema_lines.append(f"  {key}: {', '.join(fields)}")

    local_only = ["Ask over the corpus", "Files", "Knowledge base", "Models",
                  "Prompts", "Digest detail and corrections", "Memory", "Evals",
                  "Job output"]
    both_planes = ["Overview", "Capture", "Factory", "Cost", "Health"]

    doc = f"""# AgentHub — context for Lovable
_Generated from the live machine {dt.datetime.now().isoformat(timespec='minutes')}. Do not edit by hand._

## What already exists

A personal AI operations hub running on one MacBook Pro M5 Max. It is NOT being rebuilt.
You are building the single workspace that fronts it.

Already running locally, all of which stays where it is:
- Local inference: 4 models under LM Studio on 127.0.0.1:1234{f", quality brain measured at {nums['brain_tps']} tokens/sec" if nums.get('brain_tps') else ""}
- A LiteLLM router on 127.0.0.1:4000 with 9 aliases across local and metered lanes
- A knowledge base of {nums.get('chunks', 'many')} chunks across {nums.get('documents', 'many')} documents, indexed from OneDrive
- A local API on 127.0.0.1:4100 exposing every capability
- Scheduled work under launchd: nightly digest, four-hourly offsite backup, self-test
- A native macOS approval dialog for anything that changes external state

## TWO PLANES — the central architectural fact

The workspace reads from two sources and must adapt to which is available.

**LOCAL PLANE — `http://127.0.0.1:4100`, over loopback.**
Available only when the browser is running on the MacBook itself. An HTTPS page may fetch a
loopback address because loopback is a potentially trustworthy origin (MDN), so the request
never leaves the machine and the response never touches the cloud. The API sends CORS headers
naming this app's origin specifically.

**REMOTE PLANE — Supabase.**
An agent on the machine POLLS Supabase outbound every 30 seconds. It claims jobs, runs them
locally and posts results back. **Nothing ever connects inward to the machine** — there is no
inbound port, and the firewall blocks all incoming connections. Your app writes jobs and reads
published status.

## Which sections use which plane

**LOCAL PLANE ONLY — wrap every one of these in a `<LocalOnly>` component:**
{chr(10).join('- ' + x for x in local_only)}

These read material classified S1c, S2 or S3. When the local plane is unavailable they must
render a quiet panel reading "Available on the machine. This section reads material that never
leaves it." — never an error, never a spinner, never a retry, and never a Supabase fallback.

**BOTH PLANES — work everywhere:**
{chr(10).join('- ' + x for x in both_planes)}

## Machine state — four states, not two

The MacBook is the compute engine. When it sleeps, local reasoning stops. Derive and display:

- **LIVE** — the local API answers. Everything works.
- **AWAKE, REMOTE** — local silent, published state under 5 minutes old. The machine is
  working; you are simply not at it.
- **DOZING** — local silent, state 5 minutes to 2 hours old. Show when it slept and the next
  scheduled wake. If it is on battery, say that scheduled work will skip until it is on power.
- **OFFLINE** — state older than 2 hours. Captures are held on the device.

The published `machine` block carries posture, power source, battery percentage, whether sleep
is held off and by which process, the repeating wake, uptime and thermal limit.

## Sensitivity — the rule governing what may be displayed

{sensitivity_rules()}

Corpus by class: {json.dumps(nums.get('by_class', {}))}

The remote plane publishes ONLY status and counts — never document text, file paths, email
subjects or personal data. So the Digest tab shows item *detail* on the local plane and
*counts only* on the remote plane. Do not add any feature that would require publishing
content, and never send a local-plane response to Supabase, to analytics, or anywhere external.

## The published contract

One row in `state`, id = 'current'. Field names read from the agent's allowlist — use exactly:

{chr(10).join(schema_lines)}

## Job kinds the machine executes

Insert into `jobs` with `kind` and a `payload`. The agent claims it within 30 seconds:
{chr(10).join('  - ' + k for k in kinds)}

## Design system — matches the existing local console exactly

Colours: {' · '.join(colours)}
Type: {' · '.join(fonts)}

Dark editorial interface, not a SaaS landing page. Hairline 1px borders, never shadows. Border
radius 2px maximum. Copper for accents and active states only, never a large fill. Monospace
for every number, timestamp and status pill. Instrument Serif for headings only. No gradients,
no glassmorphism. Mobile-first — used on a phone more than a laptop.

## Repository rules

You own `src/`, `supabase/` and the root build config. **Never touch `machine/`** — Python,
zsh and launchd maintained outside Lovable. Never force push, rebase or amend pushed commits.

## Before you write code

Confirm you have read this and state: which direction connections flow on each plane, which
sections must be wrapped in LocalOnly, and whether POST endpoints take multipart form fields
or JSON bodies.
"""
    if "--save" in sys.argv:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(doc)
        try:
            subprocess.run("pbcopy", input=doc, text=True, timeout=10)
            print(f"written to {OUT} and copied to clipboard ({len(doc)} chars)")
        except Exception:
            print(f"written to {OUT} ({len(doc)} chars)")
    else:
        print(doc)


if __name__ == "__main__":
    main()

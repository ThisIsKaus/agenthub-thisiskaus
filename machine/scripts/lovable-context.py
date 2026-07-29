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

    doc = f"""# AgentHub — context for Lovable
_Generated from the live machine {dt.datetime.now().isoformat(timespec='minutes')}. Do not edit by hand._

## What already exists

A personal AI operations hub running entirely on one MacBook Pro M5 Max. It is NOT being
rebuilt. You are building a small companion web app that reads what the machine publishes
and queues work for it. The machine is never reachable from the internet.

Already built and running locally, all of which stays where it is:
- Local inference: 4 models under LM Studio on 127.0.0.1:1234{f", quality brain measured at {nums['brain_tps']} tokens/sec" if nums.get('brain_tps') else ""}
- A LiteLLM router on 127.0.0.1:4000 with 9 aliases across local and metered lanes
- A knowledge base of {nums.get('chunks', 'many')} chunks across {nums.get('documents', 'many')} documents, indexed from OneDrive
- A full operational console on 127.0.0.1:4100 with eleven sections
- Scheduled work under launchd: nightly digest, four-hourly offsite backup, self-test
- A native macOS approval dialog for anything that changes external state

## Non-negotiable architecture

The Mac accepts NO inbound connections. Firewall is set to block all, with stealth mode on.
An agent on the machine POLLS Supabase outbound every 30 seconds, claims jobs, runs them
locally and posts results back. Your app writes jobs and reads state. It never talks to
the machine, and there is no endpoint on the machine to talk to.

## Sensitivity — the rule that governs what you may display

{sensitivity_rules()}

Corpus by class right now: {json.dumps(nums.get('by_class', {}))}

The agent publishes ONLY status and counts. It never publishes document text, file paths,
email subjects or personal data. Your app therefore CANNOT display digest item content,
document titles, or answers drawn from the corpus — that material is local-only by policy,
not by oversight. Do not add features that would require it.

## The exact published contract

A single row in a table named `state`, id = 'current', with these JSON columns. These field
names are read from the agent's allowlist — use them exactly:

{chr(10).join(schema_lines)}

## Job kinds the machine will execute

Insert into `jobs` with `kind` and a `payload` object. The agent picks them up within 30s:
{chr(10).join(f'  - {k}' for k in kinds)}

## Design system — matches the existing local console exactly

Colours: {' · '.join(colours)}
Type: {' · '.join(fonts)}

Rules: dark editorial interface, not a SaaS landing page. Hairline 1px borders, never
shadows. Border radius 2px maximum. Copper is an accent for emphasis and active states
only — never a fill for large areas. Monospace for every number, timestamp and status
pill. Instrument Serif for headings only. No gradients, no glassmorphism, no card shadows.
Generous whitespace. Mobile-first: this is used on a phone far more than a laptop.

## Scope discipline

Five tabs, nothing more: Overview, Capture, Digest, Factory, Cost. The local console
already does everything else and does it better, because it has access to material this
app must never see. Capture is the most important feature — recording a thought from a
phone away from the machine — so build it first and build it well.

## Before you write code

Confirm you have read this document and summarise the architecture back, in particular
which direction connections flow and what you are not permitted to display.
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

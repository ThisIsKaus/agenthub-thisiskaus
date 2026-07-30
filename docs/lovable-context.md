# AgentHub — context for Lovable
_Generated from the live machine 2026-07-30T07:07. Do not edit by hand._

## What already exists

A personal AI operations hub running entirely on one MacBook Pro M5 Max. It is NOT being
rebuilt. You are building a small companion web app that reads what the machine publishes
and queues work for it. The machine is never reachable from the internet.

Already built and running locally, all of which stays where it is:
- Local inference: 4 models under LM Studio on 127.0.0.1:1234, quality brain measured at 114.9 tokens/sec
- A LiteLLM router on 127.0.0.1:4000 with 9 aliases across local and metered lanes
- A knowledge base of 93082 chunks across 2881 documents, indexed from OneDrive
- A full operational console on 127.0.0.1:4100 with eleven sections
- Scheduled work under launchd: nightly digest, four-hourly offsite backup, self-test
- A native macOS approval dialog for anything that changes external state

## Non-negotiable architecture

The Mac accepts NO inbound connections. Firewall is set to block all, with stealth mode on.
An agent on the machine POLLS Supabase outbound every 30 seconds, claims jobs, runs them
locally and posts results back. Your app writes jobs and reads state. It never talks to
the machine, and there is no endpoint on the machine to talk to.

## Sensitivity — the rule that governs what you may display

- S0 public. S1p products (Agenticality, NXI): cloud permitted, both lanes.
- S1c client engagements: per-client folders under ~/Factory/clients/, no cross-client context ever,
  client named in every artifact header, nothing client-flavoured in kb_main.
- S2 Envelope Collective (Neelam): reads flagged; writes require her recorded confirmation. Never on her behalf.
- S3 finance/tax/wealth: LOCAL ONLY, router-enforced. Cloud only via anonymisation recipe + per-task approval.

Corpus by class right now: {"S3": 2243, "S1p": 589, "S2": 43, "S1c": 6}

The agent publishes ONLY status and counts. It never publishes document text, file paths,
email subjects or personal data. Your app therefore CANNOT display digest item content,
document titles, or answers drawn from the corpus — that material is local-only by policy,
not by oversight. Do not add features that would require it.

## The exact published contract

A single row in a table named `state`, id = 'current', with these JSON columns. These field
names are read from the agent's allowlist — use them exactly:

  services: lms, router, aliases
  models: (list)
  corpus: chunks, documents
  spend: mtd, requests
  factory: wip, limit, projects
  digest: date, items, flags, tasks
  health: passed, warnings, failed, at

## Job kinds the machine will execute

Insert into `jobs` with `kind` and a `payload` object. The agent picks them up within 30s:
  - capture
  - factory_stage
  - ingest
  - intake
  - report

## Design system — matches the existing local console exactly

Colours: `#0B0B0D` ink · `#141416` panel · `#191919` panel2 · `#26262A` rule · `#C8744A` copper · `#ECEBE8` paper · `#8E8E96` muted · `#5E5E66` faint · `#7FA88C` ok · `#C9A227` watch · `#B5544A` risk
Type: serif: "Instrument Serif",Georgia,serif · sans: "Inter",-apple-system,sans-serif

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

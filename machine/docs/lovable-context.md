# AgentHub — context for Lovable
_Generated from the live machine 2026-07-30T20:23. Do not edit by hand._

## What already exists

A personal AI operations hub running on one MacBook Pro M5 Max. It is NOT being rebuilt.
You are building the single workspace that fronts it.

Already running locally, all of which stays where it is:
- Local inference: 4 models under LM Studio on 127.0.0.1:1234, quality brain measured at 114.9 tokens/sec
- A LiteLLM router on 127.0.0.1:4000 with 9 aliases across local and metered lanes
- A knowledge base of 49483 chunks across 3003 documents, indexed from OneDrive
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
- Ask over the corpus
- Files
- Knowledge base
- Models
- Prompts
- Digest detail and corrections
- Memory
- Evals
- Job output

These read material classified S1c, S2 or S3. When the local plane is unavailable they must
render a quiet panel reading "Available on the machine. This section reads material that never
leaves it." — never an error, never a spinner, never a retry, and never a Supabase fallback.

**BOTH PLANES — work everywhere:**
- Overview
- Capture
- Factory
- Cost
- Health

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

- S0 public. S1p products (Agenticality, NXI): cloud permitted, both lanes.
- S1c client engagements: per-client folders under ~/Factory/clients/, no cross-client context ever,
  client named in every artifact header, nothing client-flavoured in kb_main.
- S2 Envelope Collective (Neelam): reads flagged; writes require her recorded confirmation. Never on her behalf.
- S3 finance/tax/wealth: LOCAL ONLY, router-enforced. Cloud only via anonymisation recipe + per-task approval.

Corpus by class: {"S3": 2191, "S1p": 763, "S2": 43, "S1c": 6}

The remote plane publishes ONLY status and counts — never document text, file paths, email
subjects or personal data. So the Digest tab shows item *detail* on the local plane and
*counts only* on the remote plane. Do not add any feature that would require publishing
content, and never send a local-plane response to Supabase, to analytics, or anywhere external.

## The published contract

One row in `state`, id = 'current'. Field names read from the agent's allowlist — use exactly:

  services: lms, router, aliases
  models: (list)
  corpus: chunks, documents
  spend: mtd, requests
  factory: wip, limit, projects
  digest: date, items, flags, tasks
  health: passed, warnings, failed, at
  machine: posture, power, sleep, schedule, uptime, thermal, collected_at

## Job kinds the machine executes

Insert into `jobs` with `kind` and a `payload`. The agent claims it within 30 seconds:
  - capture
  - factory_stage
  - ingest
  - intake
  - report

## Design system — matches the existing local console exactly

Colours: `#0B0B0D` ink · `#141416` panel · `#191919` panel2 · `#26262A` rule · `#C8744A` copper · `#ECEBE8` paper · `#8E8E96` muted · `#5E5E66` faint · `#7FA88C` ok · `#C9A227` watch · `#B5544A` risk
Type: serif: "Instrument Serif",Georgia,serif · sans: "Inter",-apple-system,sans-serif

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

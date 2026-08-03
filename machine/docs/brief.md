# AgentHub — brief for Lovable
_Generated from the live machine 2026-08-03T18:37. Do not edit._

## What exists

A personal AI hub on one MacBook Pro M5 Max. **Not being rebuilt** — you are building the
single workspace that fronts it. Running locally: 4 models under LM Studio (quality brain
114.9 t/s), a router on :4000 with 9 aliases, a knowledge base of 49542
chunks across 3024 documents indexed from OneDrive, a local API on
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

**LOCAL ONLY — wrap each in `<LocalOnly>`:** Ask, Files, Knowledge base, Models, Prompts, Digest detail and corrections, Memory, Evals, Job output.
These read material classed S1c/S2/S3. When local is unavailable, render one quiet line in
secondary text: "Available on the machine. This section reads material that never leaves it."
No error styling, no spinner, no retry, **no Supabase fallback**.

**BOTH PLANES:** Overview, Capture, Factory, Cost, Health.

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

- S0 public. S1p products (Agenticality, NXI): cloud permitted, both lanes.
- S1c client engagements: per-client folders under ~/Factory/clients/, no cross-client context ever,
client named in every artifact header, nothing client-flavoured in kb_main.
- S2 Envelope Collective (Neelam): reads flagged; writes require her recorded confirmation. Never on her behalf.
- S3 finance/tax/wealth: LOCAL ONLY, router-enforced. Cloud only via anonymisation recipe + per-task approval.

Corpus by class: {"S3": 2206, "S1p": 769, "S2": 43, "S1c": 6}

The remote plane publishes **only status and counts** — never document text, file paths, email
subjects or personal data. Digest shows item detail on the local plane, counts only on the
remote plane. Never send a local-plane response to Supabase, analytics, or anywhere external.

## Published contract

One row in `state`, id = 'current'. Use these field names exactly:

  services: lms, router, aliases
  models: (list)
  corpus: chunks, documents
  spend: mtd, requests
  factory: wip, limit, projects
  digest: date, items, flags, tasks
  health: passed, warnings, failed, at
  machine: posture, power, sleep, schedule, uptime, thermal, collected_at

## Job kinds

Insert into `jobs` with `kind` + `payload`; claimed within 30s: capture, factory_stage, ingest, intake, report.

## Local API

Base `http://127.0.0.1:4100`, `credentials: 'omit'`. **Every POST takes multipart form fields,
never a JSON body — JSON returns 422.** A 403 means the path was outside the allowlist or an
approval dialog was denied: render as a refusal ("denied at the approval dialog"), never an
error. Delete and forget block while the dialog is open, up to 5 minutes — show "awaiting
approval on the machine…", not a spinner. Executable files (.py, .sh, .plist) are read-only
by design; offer no edit control for them.

| Endpoint | Parameters |
|---|---|
| POST `/api/ask` | form: { q: string, model?: string, k?: number } |
| POST `/api/build` | form: { intent: string, scope?: string } |
| GET `/api/canvas` | no parameters |
| GET `/api/canvas/doc` | query: { id: string } |
| POST `/api/canvas/handover` | form: { id: string } |
| POST `/api/canvas/save` | form: { id: string, title: string, body: string, state?: string, sources?: string } |
| POST `/api/canvas/state` | form: { id: string, state: string } |
| GET `/api/capabilities` | no parameters |
| POST `/api/capture` | form: { text: string } |
| GET `/api/cascade/stats` | no parameters |
| POST `/api/classify` | form: { text: string } |
| GET `/api/cost` | query: { days?: number } |
| GET `/api/digest` | query: { date?: string } |
| POST `/api/draft` | form: { title: string, body: string } |
| POST `/api/eval/correct` | form: { text: string, cls: string, entity: string, sensitivity: string, injection?: string } |
| GET `/api/evals` | no parameters |
| GET `/api/factory` | no parameters |
| POST `/api/factory/action` | form: { action: string, name?: string, stage?: string } |
| GET `/api/failover` | no parameters |
| GET `/api/file` | query: { path: string } |
| POST `/api/file/delete` | form: { path: string } |
| POST `/api/file/new` | form: { path: string, name: string, kind?: string } |
| POST `/api/file/save` | form: { path: string, content: string } |
| GET `/api/health` | no parameters |
| GET `/api/job` | query: { id: string } |
| GET `/api/kb` | no parameters |
| POST `/api/kb/forget` | form: { path: string } |
| GET `/api/memory` | query: { q?: string, n?: number } |
| GET `/api/models` | no parameters |
| POST `/api/models/action` | form: { action: string, model?: string } |
| GET `/api/prompts` | no parameters |
| POST `/api/prompts/save` | form: { path: string, content: string } |
| GET `/api/proposals` | no parameters |
| POST `/api/proposals/act` | form: { id: string, action: string, note?: string } |
| GET `/api/roots` | no parameters |
| POST `/api/run` | form: { key: string } |
| GET `/api/selftest` | no parameters |
| GET `/api/skills` | no parameters |
| POST `/api/skills/save` | form: { path: string, content: string } |
| GET `/api/state` | no parameters |
| GET `/api/tree` | query: { path?: string } |

POST `/api/run` with `key` returns `{job, label}`; poll GET `/api/job?id=` every 900ms until
`running` is false. Keys: verify(T0), doctor(T0), intake(T1), ingest(T1), eval(T0), backup(T1), report(T0), repair(T1), summarise(T1), diagnose(T1).

Response shapes are in machine/docs/local-api-contract.md — read that for a field name rather than guessing at one.

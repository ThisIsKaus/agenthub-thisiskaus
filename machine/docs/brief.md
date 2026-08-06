# AgentHub — brief for Lovable
_Generated from the live machine 2026-08-06T21:39. Do not edit._

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

## Components own the layout — a view may not override them

Written as prose this standard was violated twice: the mobile container shipped at 92vw
against a 7% requirement, and tertiary text shipped below AA contrast.

<Page>     86vw container (max 1240px, centred), h1 31px sentence case, 56px section rhythm,
           Geist Mono footer. Every route renders inside it.
<Section>  every h2, exactly 25px sentence case, optional 72ch subtitle.
<Field>    large Instrument Serif number, uppercase Geist Mono 10px label, tertiary detail.
           Any h3 inside is 15px medium. Numbers tabular-nums.

No view sets its own heading size, container width or footer.

## Rendering rules, not style preferences

Collapsed content is NOT MOUNTED — render children only when open. A disclosure that mounts
its rows costs DOM weight on every visit, leaves every hidden control in the tab order, and
grows with the data. Measured here: one page carried 12,293 nodes and 3,024 hidden buttons to
show 938 characters, while another rendered 20,519 characters in 549 nodes.

Lists past ~100 rows need a filter, not a cap. Capping trades a performance problem for a
usability one — the reason to open a 3,000-row list is to find one row.

Every figure carries provenance: live, or published with its age.

## Report what you measured, not what you changed

"h2 computes 25px on all sixteen routes" is a result. "Applied Section everywhere" is an
intention. Where a gate names a number, report the number. Defects have twice been declared
closed on the evidence of the two pages under discussion rather than the sixteen that exist.

## Local API

Base `http://127.0.0.1:4100`, `credentials: 'omit'`. **Every POST takes multipart form fields,
never a JSON body — JSON returns 422.** A 403 means the path was outside the allowlist or an
approval dialog was denied: render as a refusal ("denied at the approval dialog"), never an
error. Delete and forget block while the dialog is open, up to 5 minutes — show "awaiting
approval on the machine…", not a spinner. Executable files (.py, .sh, .plist) are read-only
by design; offer no edit control for them.

The full endpoint table with parameters is in machine/docs/local-api-contract.md.
Read it for a signature rather than guessing at one.

POST `/api/run` with `key` returns `{job, label}`; poll GET `/api/job?id=` every 900ms until
`running` is false. Keys: verify(T0), doctor(T0), intake(T1), ingest(T1), eval(T0), backup(T1), report(T0), repair(T1), summarise(T1), diagnose(T1).

Response shapes are in machine/docs/local-api-contract.md — read that for a field name rather than guessing at one.

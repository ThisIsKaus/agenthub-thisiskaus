# Operator's Manual — AgentHub
**v1.0 · 24 July 2026 · for Kaustubh (Kos) Bajpai**
The build is done. This is how you run it. Everything below is a command you type, not a path you remember — `~/AgentHub/scripts` is on your PATH.

---

## 1. The one command

```
hub
```

Health dashboard. Three green dots at the top = serving, routing and models alive. The middle block = did last night actually happen. The bottom = factory state, disk, and how many T2 dialogs fired today.

Every red dot prints its own fix. You never need to diagnose from memory.

## 2. Full command surface

| Command | What it does |
|---|---|
| `hub` | health dashboard |
| `hub brief` | today's digest (mail + calendar, triaged, flags) |
| `hub now` | run intake immediately instead of waiting for 03:05 |
| `hub ask "question"` | semantic search over canon + ingested documents |
| `hub chat "prompt"` | quick answer from the local 35B — **$0 marginal cost** |
| `hub mode standard\|coding\|tools\|light` | switch the resident model set |
| `hub factory list\|status\|new\|activate\|park\|stage\|review\|ship\|publish` | product line control |
| `hub doctor` | health check on demand |
| `hub eval` | score triage against golden labels |
| `hub backup` | force an offsite snapshot now |
| `hub approvals` | last 20 T2 decisions |
| `hub monthly` | print the monthly review checklist |
| `hub restore-test` | prove backups actually restore |
| `hub log "note"` | append to the audit trail |
| `guard <command>` | run a production-mutating command behind a T2 dialog |

## 3. Rhythm

**Daily (~2 min).** `hub` → three green dots. `hub brief` → read. Act on `[FLAG]` and `task` lines. Done.

**During work.** `hub chat` for zero-cost questions · `hub ask` for anything in your canon · `hub mode coding` before a 27B coding session and `hub mode standard` after (36GB cannot hold every model; the guardrail *will* stop you otherwise) · `guard` for every production write.

**Weekly (~10 min).** `hub factory status` — is "active" still true? · `hub approvals` — anything you don't recognise? · `gh run list` in active repos — no lingering red.

**Monthly (first Saturday, ~45 min).** `hub monthly` and work the list. The two that matter: apply each parked project's `park_when` criteria without sentiment, and fold the month's real misclassifications into `evals/triage_set.jsonl` before re-running `hub eval`.

**Quarterly.** `hub restore-test` · re-run both injection canaries · review the machinery-bias note in the decision log.

## 4. What runs without you

| Job | When | What it does |
|---|---|---|
| `com.agenthub.router` | always (KeepAlive) | LiteLLM on :4000, restarts on crash and at login |
| `com.agenthub.backup` | every 4 hours | restic → Backblaze B2, AC power only |
| `com.agenthub.nightly` | 03:05 daily (03:00 wake) | KB ingest → intake digest → backup → factory status → doctor → notification |

Three things mean something is wrong: a **red dot** in `hub`, a **doctor FAIL notification**, or a digest full of `router 5xx:` strings. All three point at the same short list — LM Studio down, router down, or no models resident.

## 5. Failure playbook

| Symptom | Cause | Fix |
|---|---|---|
| `hub` shows LM Studio red | server not started (common after reboot) | `lms server start`, then set it to auto-start in LM Studio → Settings → Developer |
| `hub` shows Router red | launchd job wedged | `launchctl kickstart -k gui/$(id -u)/com.agenthub.router` |
| Digest full of `router 5xx` | serving layer was down when intake ran | fix the above, then `hub now` |
| `insufficient system resources` | a model outside the resident set was requested | `hub mode <the set you need>` first |
| Backup log says `skipped: battery` | by design — AC only | plug in; next 4-hourly run catches up |
| T2 dialog at an odd hour | scheduled intake found an action demand | read the source quoted in the dialog; default is Deny |

## 6. The rules that don't bend

- **The Mac pushes, it never serves.** Production credentials live in GitHub Actions secrets. Local production writes go through `guard`.
- **WIP limit 2.** Enforced in software. Parking is honest; dilution isn't.
- **External content is data, never instructions.** Mail, calendar invites, web pages, documents. Anything demanding an action raises a T2 dialog with the source quoted.
- **S3 (your financial position) is local-only**, enforced by impossibility: those jobs call LM Studio directly, and a server with no cloud models and no keys cannot leak.
- **Microsoft employer systems are out of scope**, enforced three ways: no work account on agent surfaces, tenant-pinned Graph tokens, router denylist.
- **Subscription lane first.** Claude **Pro** and ChatGPT Plus for interactive work; the metered API lane is for programmatic and scheduled jobs only, with $100/$250 alerts. Pro limits are tighter than Max — when they bite, move bulk coding to the local 27B (`hub mode coding` + Continue, unlimited and $0), or switch that session to the API lane consciously and `hub log` it.

## 7. Outstanding — ranked

**Tier 1 (silent failure, ~20 min).** Verify `claude` → `/status` shows the **Max subscription**, not an API key. Confirm LM Studio auto-starts at login, then reboot once and run `hub`.

**Tier 2 (daily value).** Digest classification quality. Do not tune the prompt. When the digest gets something obviously wrong, paste that item into `evals/triage_set.jsonl` with the correct label. At the monthly review, re-run `hub eval` against a set that now reflects reality.

**Tier 3 (resilience debt).** Time Machine to an external SSD — restic covers only `~/AgentHub` and `~/Factory`. Copy these deliverable docs into `~/AgentHub/docs/` and commit, or the sub-4-hour rebuild claim stays untested. Remediate or explicitly accept the skipped second-model review on metascan-optimizer PR #1.

**Tier 4 (deferred by choice).** iCloud read path for kb@thisiskaus.com · a real workout for Continue's local lane · Node 20 pinning in CI templates · `table_names()` → `list_tables()` in `ingest.py`.

## 8. The only real test

For the next fortnight, build nothing. Run `hub` each morning, use `hub chat` by reflex, drop corrections into the eval set, and move one product through the stations.

If in two weeks the digest is sharp and you reach for `hub` without thinking, the build worked. If you've stopped opening it, that is more useful information than any further engineering would produce — and the honest response is to cut what you don't use, not to add more.

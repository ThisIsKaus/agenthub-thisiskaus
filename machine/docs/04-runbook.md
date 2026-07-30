# Runbook — Personal AI Hub / Software Factory
**Version 4.0 · 15 July 2026.** Steady state for a single-machine, loopback-only hub. One node means the repo + backups are the entire resilience story; the digest is the dashboard; `doctor.sh` is the pulse.

---

## Monthly checklist (first Saturday, ~75 min)

**1. Security review (first — 20 min)**
- [ ] `sudo lsof -iTCP -sTCP:LISTEN -P -n` → nothing beyond loopback; Sharing all-off; firewall still block-all + stealth (`socketfilterfw --getglobalstate --getblockall --getstealthmode`).
- [ ] Advisories/release notes for **LM Studio, MLX runtime, LiteLLM, Continue, Claude Code** — a security fix ships today, not in the window.
- [ ] `logs/approvals.log`: every T2 entry matches a decision you remember. `logs/audit.jsonl` spot-check.
- [ ] Keychain audit: agenthub items current; rotate anything >90 days.
- [ ] `grep -rE "sk-|api_key: \"" ~/AgentHub --include="*.yaml" --include="*.env"` → nothing.
- [ ] Graph token still asserts the personal tenant (run the tenant-assert test).

**2. Cost & lanes (15 min)**
- [ ] API-lane spend vs $100/$250 marks; per-class breakdown from router spend log.
- [ ] **Max-limit hits** count in digests: repeated hits = rebalance interactive work or reassess plan tier — a decision, not a drift.
- [ ] Escalation rate in the 20–40% band? <10% → check missed-escalation diffs (wrong-but-cheap risk). >60% → local tier not earning its RAM.

**3. Eval run (30 min, mostly unattended)**
- [ ] `python scripts/run_evals.py`; compare to baseline/last month; investigate any regression **before** changing anything else (model? runtime? prompt version? canon drift?).
- [ ] Lane-comparison verdicts recorded; golden-drift diff reviewed.
- [ ] Apply recalibration: <90% local → cloud default; ≥95% ×2 → localisation candidate.

**4. Update window (feature updates ONLY here — 20 min)**
- [ ] `brew upgrade` (skim) · `uv tool upgrade litellm` after its changelog · VS Code extensions.
- [ ] LM Studio / MLX runtime update → **re-run `bench.sh`**, diff vs `models.lock.yaml`; a runtime that drops t/s is rolled back.
- [ ] Model landscape scan: a credible new model for this class? Pull → head-to-head eval → promote only on a win → update lockfile → delete the loser (200GB cap).
- [ ] `git add -A && git commit -m "monthly $(date +%F)" && git push`.

**5. Data & schedule hygiene (10 min)**
- [ ] `pmset -g sched` shows the 03:00 wake; `logs/nightly.log` for skipped/failed nights; `logs/doctor.log` clean.
- [ ] `canon/` + `prompts/` git diff for the month — you approved every change to the agent's own instructions.
- [ ] Prune stale KB sources; `du -sh ~/AgentHub ~/.lmstudio/models` in budget; `restic snapshots --last` shows last night; log rotation ran.

**Quarterly extras:** restore drill (procedure E) · **both injection canaries** re-run (email + calendar invite) · Time Machine spot-restore of one file · 60-day/quarterly question: *"Did I miss any ambient/always-on function?"* — repeated yes = evidence for a home-LAN Mac mini (owned hardware), never a rented server.

---

## Update policy
- **Security patches:** immediately on advisory, any day; verify health after (`doctor.sh`).
- **Feature updates:** monthly window only, one component at a time, previous version pinned for rollback.
- **Models & MLX runtime:** eval- and bench-gated promotion only; `models.lock.yaml` is a security control.
- **macOS 27:** adopt at .1; migration task = move suitable Shortcuts "Use Model" steps to the pre-installed `fm` CLI / Python SDK.

---

## Degraded-mode procedures

**A. Offline / travelling.** Local-first continues; cloud-class tasks queue to `state/queue.db`, visible in the digest; **review the queue before releasing it** on reconnect. S3 finance work unaffected. On battery: `mode-light.sh` — the 35B on battery is a thermal and battery tax.

**B. Anthropic outage.** Router falls back OpenAI → Gemini per class automatically; interactively, use the ChatGPT app. Digest notes what ran on fallback; defer client-facing output you'd rather not ship at fallback quality. **S3 never falls back to any cloud.**

**C. Max plan limit reached mid-work.** Not an outage — a decision: defer to the reset, or continue via the API lane consciously (cost visible). Log it (`hub log "max-limit hit: <context>"`); repeated hits are monthly-review input.

**D. LM Studio / model crash.** launchd KeepAlive restarts (~30–60s with load). Flapping → unload plist, open the GUI, read the runtime log; usual causes: runtime/model mismatch after an update (roll back) or memory pressure (light mode). Router serves triage from `cloud-fast` meanwhile — **except S3, which pauses and says so.**

**E. Restore from backup (target <4h; drill quarterly).**
1. Clean install → `xcode-select --install` → Homebrew.
2. `chezmoi init --apply <repo>` → `brew bundle --file=~/AgentHub/Brewfile`.
3. Re-add Keychain secrets (or rotate fresh if in any doubt).
4. `restic restore latest --target ~/` for `~/AgentHub` (KB, vault, state, canon, prompts). Models are **not** backed up by design — `lms get` re-pulls from `models.lock.yaml`.
5. `launchctl load` plists · `sudo pmset repeat wakeorpoweron MTWRFSU 03:00:00` · run Phase 2 + Phase 3 verification checklists.
*Drill variant:* steps 2–4 into `--target /tmp/restore-drill`; spot-check three files including one from `vault/`.

**F. Suspected compromise.**
1. Isolate: Wi-Fi off / unplug.
2. Rotate everything in Keychain; revoke OAuth grants (Google + Microsoft personal-tenant security pages).
3. Read `approvals.log`, `audit.jsonl`, router spend log around the window: unapproved T2? unexplained model calls or spend?
4. Malware suspected → full wipe + procedure E (rotate at step 3; don't restore old secrets).
5. Two-paragraph post-mortem to `docs/incidents/` — future-you is the audience.

---

## Standing risks (quarterly review)
1. **Single machine = single point of failure.** Mitigated by discipline: nightly offsite restic + Time Machine + the drill actually performed on the calendar.
2. **Throughput figures are provisional** until `bench.sh` speaks; re-bench after every MLX runtime change.
3. **Supply chains that remain:** Homebrew, PyPI, npm, HF model repos, VS Code extensions — pinning + monthly window + advisory watch.
4. **Content-borne prompt injection** is the principal attack class: read-only toolsets for external content + the source-quoting T2 dialog carry the defence; two canaries keep it honest.
5. **Subscription dependency:** plan limits and terms can change; Max-hit logging plus the monthly lane review is the early-warning system.
6. **Continuity gap** (lid closed = paused): accepted by design; the quarterly ambient question is the pressure valve.


---

## Factory operations addendum (v4.0)

**Monthly (append to checklist, ~15 min):**
- [ ] **Registry groom:** stages honest; `status: active` count ≤ WIP limit; apply each product's `park_when:` criteria without sentiment; parked list reviewed for kill vs keep.
- [ ] **CI sweep:** `gh run list` per active repo — no lingering reds; branch protection still on; Actions workflow files unchanged except by your own commits (supply-chain check).
- [ ] **Credential audit:** fine-grained GitHub tokens + per-project Keychain entries (`agenthub.<project>.*`) current and least-privileged; anything unused revoked.
- [ ] **Client isolation spot-check:** open one client artifact — correct folder, client named in header, nothing client-flavoured in `kb_main`.
- [ ] **Cycle-time glance:** intake→ship days per shipped item (digest aggregates) — is "busy" impersonating "shipping"?

**Degraded mode G — production platform outage (GitHub/Azure/Supabase/Stripe):** ship gates block; building continues locally; digest flags it. Their SLA, not this machine's. Do not route around CI to "just deploy manually" — that is what `guard` will ask you to approve, on purpose.

**Standing risk 7 — factory credential surface:** local per-project tokens are the accepted, bounded exception to CI-resident credentials (Decision D22). Bounded by: least privilege, per-project namespace, T2 guard on prod writes, monthly audit above.

# Build State — Live Tracker
**As of Sun 19 Jul 2026, evening.** This is the ONE document to follow. It supersedes scrolling through chat. Rules that prevent every failure so far: paste one fenced block at a time · interactive prompts eat queued lines, so anything that prompts runs alone · `sudo -v` before any block containing sudo · no editing of blocks (prompts ask for values instead).

---

## Where you are

| Item | Status | Evidence |
|---|---|---|
| Phase 0 — tooling, repo, Claude Code | ✅ DONE | 9 tools verified; `ThisIsKaus/agenthub-config` pushed; claude 2.1.215 |
| P1.1 — firewall, zero inbound | ✅ DONE | State = 2, block-all, stealth on, remote login off |
| P1.2 — secrets in Keychain | ✅ DONE | `[key prefix redacted]` prefix verified; repo grep clean |
| P1.5 — config-as-code | ✅ DONE | Brewfile + chezmoi (.zshrc, .zprofile, .ssh/config) + canon seeded + pushed |
| **FileVault** | ✅ On | ⚠ confirm Recovery Key stored off-Mac; if not captured: `sudo fdesetup changerecovery -personal` |
| **AirPlay Receiver** | ❌ ON (:5000/:7000 listening) | → Tonight, Step 2 |
| Phase 2 — LM Studio + models | ✅ CLOSED (2eb8b1c) | 35B: **114.9 t/s** · 20B: 103.3 · 27B: 24.8 · 4B: 126.0; resident set 23.5GiB; embedder = nomic-v1.5 (evidence pick); pending: 2 confirm curls + lockfile commit |
| Phase 3A — router live + launchd | ✅ CLOSED (87c55fe) | 9 aliases; lane tests passed against the supervised service days later — reboot-survival proven in the wild |
| Phase 3B — KB + approvals | ✅ CLOSED (79999be) | retrieval ranks correctly (policies.md @0.523); Deny→exit 1 logged; audit.jsonl live |
| Phase 3C — schedule + nightly + doctor + backups | ✅ CLOSED | **PHASE 3 COMPLETE**: 3 restic snapshots offsite (repo aff3e159); wake 03:00 standing; doctor OK incl. restic check (regex fixed: pmset displays 'wakepoweron') |
| Phase 4A — Graph, two pinned identities | ✅ CLOSED (35876c2) | `personal` = consumer MSA via /consumers; `agenticality` = own tenant GUID; `User.Read` added → whoami green on both. Calendar/tasks/mail flowing |
| Phase 4B — intake pipeline + canary gate | ▶ 1 of 2 canaries | Email vector passes (FLAG + T2 + Deny logged). Calendar canary still absent from digest — likely created on iCloud rather than the Outlook consumer account. A/B vs local-tools returned bare 400; error-body capture added |
| Eval backlog (→ Phase 5) | ◻ noted | S3 over-fires on security alerts (fails safe); entity=unknown over-used 8/17; tomorrow's CCA-F exam classed as noise. Codify as eval tasks, don't hand-tune. A/B: `TRIAGE_MODEL=local-tools` |
| Listener audit (24 Jul) | ⚠ 2 open | NEW: `lmlink-co` on `*:65057` (non-loopback, identify + disable). AirPlay still on `*:5000/7000` — `defaults` key ineffective on macOS 26, use GUI. Router + LM Studio API confirmed loopback-only |
| Phase 5 — evals + drills | ✅ CLOSED (7263bc5) | 4B retained on evidence (beat 35B on all 4 axes); deterministic injection pre-filter survives total serving outage; router resurrection + doctor alert + restore all verified; 4-hourly backup |
| Phase 6 — factory layer | ✅ CLOSED (b37ce2c) | registry.json + WIP limit bit at 2/2; guard proved on BOTH Approve and Deny paths |
| Phase 7 — pilot to ship gate | ✅ CLOSED | metascan-optimizer **v0.1.0 released** by CI from a squash-merged PR (1,222 lines, tests green). Friction found + fixed: release.yml missing from template (backported), branch protection unavailable on free private repos, review station skippable (review/ship gates added to CLI) |
| **BUILD COMPLETE — operations phase** | ▶ | `hub` CLI is the cockpit; see 07-operators-manual.md |
| Tier 1 outstanding | ⚠ 1 of 2 closed | ✅ Claude Code now on **Claude Pro subscription** (was metered API/Opus — fixed via /login), default model Sonnet 5. Pro limits are tighter than Max: overflow goes to local 27B via Continue, or a logged conscious API-lane session. NEW: `/mcp` shows 5 servers connected, 4 unauthenticated — audit against employer boundary + prod-write rule. Still open: LM Studio auto-start + reboot test |
| **AUDIT 24 Jul** | ✅ 2 of 3 closed | (1) Eval regression → fixed, see below. (2) Router aliases: my finding was **WRONG** — all four passed pre-rename; sonnet-5/opus-5 re-verified OK after rename, `cloud-frontier` (fable-5) fails, raw error pending. (3) Cost instrumentation → **LIVE**, spend.jsonl recording per-request cost |
| **EVAL 25 Jul** | ⚠ rule failed, patch retained pending re-score | class 60→**80%**, sensitivity 80→**100%**, injection 93→**100%**, entity 80→**66%** (below the 80% bar). 4 of 5 entity misses are one pattern (`personal` vs `unknown`) where the golden labels contradict the written rubric — labels corrected under a new discipline recorded in canon v1.4; re-score pending. Caveat on record: the re-run improves mechanically, so the eval is only trustworthy once it holds uncurated real-world items |
| Tier 2 outstanding | ◻ | digest classification quality — see audit finding 1; fold real misclassifications into the eval set at the monthly window |
| Repo hygiene | ◻ | `~/AgentHub/.DS_Store` still tracked at root (only `evals/.DS_Store` was removed) |
| Exec dashboard | ✅ LIVE | static v1.0 superseded by `report/` — self-generating from machine state, regenerated nightly, `report` opens it |
| **Phase 8 — Console** | ▶ GATE PENDING | Loopback UI on :4100, launchd-supervised (4th local service). Overview / Ask (KB-grounded) / Artefacts / Actions / Capture. Doctrine: invents no capability, allowlisted paths, vault unreadable, T2 via native dialog. Gate: health + listener + streamed doctor + cited answer |
| **Phase 9 — Corpus + correction loop** | ◻ NEXT | KB is 5 chunks. Drag-drop ingest via console, then one-click digest correction → eval set. This is the closed learning loop, and the answer to "beat Hermes" |
| Benchmark: Hermes Agent | 📋 assessed 25 Jul | AgentHub leads on: measured perf, evidence-based model selection, S3 enforcement by impossibility, injection filter surviving outage, employer boundary, factory discipline, zero-inbound. Hermes leads on: closed learning loop, cross-session recall, procedural memory/skills, trajectory capture, subagents. Strategy = absorb those 5, hold each to a measured gate Hermes lacks. Reject: messaging channels (inbound surface) |
| Tier 3 outstanding | ◻ | Time Machine to external SSD; docs into `~/AgentHub/docs/` (rebuild path untested); PR #1 review remediation |
| Tier 4 outstanding | ◻ | iCloud read path; Continue lane real workout; Node 20 pinning; `list_tables()` deprecation |
| Phase 4C — VS Code lanes, iCloud read path | ◻ queued | Continue → local-coder via :4000; kb@thisiskaus.com read via Mail.app, no stored credential |
| Claude Code auth = Max | ◻ parked | verify with `/status` inside `claude` |
| Personal-Agent browser profile | ◻ parked | Settings/browser task |
| Six docs into `~/AgentHub/docs/` | ◻ parked | download from chat → move → commit |

---

## Step 1: FileVault — ✅ DONE (On)

Outstanding check only: the **Recovery Key** must exist off this Mac. If it wasn't captured when enabling, run alone (`thisiskaus` + Mac login password) and store the printed key on phone/paper — never paste it into any chat:

```zsh
sudo fdesetup changerecovery -personal
```

## Tonight — Step 2: AirPlay Receiver off

Severity note: firewall State 2 + stealth already blocks inbound AirPlay — this is hygiene, not exposure. Settings path: System Settings → **General** → **AirDrop & Handoff** → **AirPlay Receiver → Off** (NOT in the Sharing pane on macOS 26). Terminal fallback (Apple's key is historically misspelled — type exactly):

```zsh
defaults -currentHost write com.apple.controlcenter AirplayRecieverEnabled -bool false
killall ControlCenter
```

Verify — :5000/:7000 gone (rapportd stays):

```zsh
sudo lsof -iTCP -sTCP:LISTEN -P -n
```

If they persist after both paths, proceed anyway — State 2 covers it; revisit at the monthly review.

**Both green = Phase 1 formally closed.**

## Tonight — Step 3: Phase 2 kickoff (downloads run overnight, ~52GB)

Open **LM Studio** once: confirm **MLX runtime** active, server bind **localhost**, context default 32768, auto-evict on. Then:

```zsh
~/.lmstudio/bin/lms bootstrap
```

```zsh
exec zsh
```

```zsh
lms server start
```

Run ONE AT A TIME (the last two open an arrow-key selector — pick the **mlx-community … 4bit** entry; queued lines would be eaten as keystrokes):

```zsh
lms get https://huggingface.co/mlx-community/Qwen3.6-35B-A3B-4bit
```

```zsh
lms get openai/gpt-oss-20b --mlx
```

```zsh
lms get https://huggingface.co/mlx-community/Qwen3.6-27B-4bit
```

```zsh
lms get https://huggingface.co/mlx-community/Qwen3.5-4B-4bit
```

```zsh
lms get https://huggingface.co/mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ
```

Verify all five on disk: `lms ls`

Note for the first monthly eval window: benchmark the stock builds head-to-head against **unsloth Qwen3.6 UD-MLX-4bit** variants (most-downloaded, claimed higher quality at same size) — promotion only on an eval win, per D4.

```zsh
uv tool install mlx-lm
```

If a repo name 404s: search the model inside LM Studio, pull the closest `mlx-community` **4-bit** build, note which. If `lms get` asks which file/quant: pick the 4-bit, Enter. Overnight insurance — plugged in, spare Terminal tab, Ctrl+C in the morning:

```zsh
caffeinate -is
```

## Tomorrow — the BENCH GATE (turns estimates into facts)

Bench runs through **LM Studio's own engine** (the production path — its REST API returns per-request stats; the mlx-lm CLI cannot run the mlx-vlm-converted qwen3_5 archs):

```zsh
python3 -c 'print("Sydney "*2000 + " Summarise this briefly.")' > /tmp/benchprompt.txt
for MODEL in qwen3.6-35b-a3b openai/gpt-oss-20b qwen3.6-27b qwen3.5-4b; do
  echo "=== $MODEL ==="
  lms unload --all
  lms load "$MODEL"
  curl -s http://127.0.0.1:1234/api/v0/chat/completions -H "Content-Type: application/json" \
    -d "$(jq -n --arg m "$MODEL" --rawfile p /tmp/benchprompt.txt '{model:$m, messages:[{role:"user",content:$p}], max_tokens:256}')" \
    | jq '{model:.model, stats:.stats}'
done | tee ~/AgentHub/logs/bench-$(date +%F)-v2.txt
lms unload --all
```

Record `tokens_per_second` + `time_to_first_token` per model into `models.lock.yaml` (gpt-oss on-disk repo: `mlx-community/gpt-oss-20b-MXFP4-Q8`). mlx-lm baseline for gpt-oss: 642 t/s prefill / 106.8 t/s gen / 13GB peak.

Paste the log to Claude. Pass criteria: numbers recorded into `models.lock.yaml`; standard-mode peak memory ≤ ~26GB at 32K context — else drop context or promote GPT-OSS-20B to default brain. Then commit:

```zsh
cd ~/AgentHub && git add -A && git commit -m "phase 2: models pulled + bench baseline" && git push
```

## Parked (do when convenient — none block Phase 3)
1. `claude` → `/status` → must show the **Claude subscription (Max)** account, not API; `/login` switches.
2. Browser profile **Personal-Agent** — no Microsoft work account ever signs in on it.
3. Download the six docs from chat into `~/AgentHub/docs/`, then commit.

## Next after the bench gate
Phase 3 (router, memory, pipeline, approvals, 03:00 schedule, backups) — Claude will hand it as paste-ready blocks against the measured numbers.

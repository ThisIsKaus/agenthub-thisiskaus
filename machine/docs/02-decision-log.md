# Decision Log — Personal AI Hub / Software Factory
**Version 4.0 · 15 July 2026.** D1–D18 (the substrate) are carried unchanged and compressed to their essence; D19–D25 add the factory layer. Council round 4 — with the owner-mandated **counter-critique of the council itself** — at the end.

---

## Carried decisions (substrate, v3.0 — status: FINAL)
**D1** Hardware truth: M5 Max 18C/32C-GPU/36GB, **460GB/s**; envelope 24–27GB; all t/s bench-gated. · **D2** Single machine, loopback-only, zero inbound; lid-closed = paused; Mac-mini-on-LAN is the only sanctioned future always-on path. · **D3** LM Studio (MLX runtime) + mlx-lm; no Ollama; vLLM excluded. · **D4** Portfolio: Qwen3.6-35B-A3B / GPT-OSS-20B / Qwen3.6-27B / Qwen3.5-4B / Qwen3-Embedding-0.6B; repos+runtime pinned; eval-gated promotion. · **D5** Two-lane cloud doctrine: subscription lane for interactive, API lane (router, metered, $100/$250 alerts) for programmatic; Plan-limit hits conscious (confirmed **Pro**, not Max, 24 Jul — overflow routes to local 27B or a logged API-lane session). Auth is dual by design: Claude Code runs on subscription **or** API key (`/login` switches anytime) — the subscription is the economic default (~$2–5 per heavy agentic session at metered rates vs $0 marginal), not a dependency. · **D6** LiteLLM router; S3 allowlist in software. · **D7** No agent-gateway framework; Claude Code + MCP + owned pipeline.py. · **D8** LanceDB + SQLite; canon/prompts as reviewed code; stdio kb-mcp; vault excluded everywhere. · **D9** Graph personal-tenant pinned+asserted; Gmail/iCloud read-only; sending stays human. · **D10** Keychain baseline, fresh keys for this machine, zero plaintext. · **D11** S3 local-only + tested anonymisation recipe *(upgraded 20 Jul: finance jobs call the LM Studio endpoint directly, bypassing the router — a server with no cloud models and no keys cannot leak; enforcement by impossibility)*. · **D12** T0/T1/T2 with blocking dialog, default Deny, source quoted; calendar invites treated as attacker-writable. · **D13** VS Code three lanes: Copilot / Claude Code / Continue→local-27B. · **D14** 03:00 AC wake, serialised nightly. · **D15** Time Machine + restic→B2; quarterly drill. · **D16** Config-as-code, rebuild <4h. · **D17** Digest-as-dashboard + doctor.sh + log rotation. · **D18** Eval regime: 15 tasks + lane-comparisons + drift; 20–40% escalation band.

---

## Factory decisions (v4.0)

**D19 — Strategic frame: the Mac is the front door of a hybrid AI-native software factory; the Mac pushes, it never serves.**
All work — Agenticality products, NXI, client engagements, personal ops — enters one intake, is triaged, and moves down standardised stations. Production lives in GitHub/Azure/Supabase/Stripe. *Alternative rejected:* treating product work as ad-hoc sessions alongside a personal assistant — that's how solo founders accumulate five half-built products; the registry + gates exist to prevent exactly that. *Primary-goal trace:* shipped value per hour comes from finishing, and finishing comes from stations and gates.

**D20 — Project registry as single source of truth, with a WIP limit of 2 active products.**
`factory/registry.yaml`: name, entity, stage, status, repo, deploy target, sensitivity. Everything else is honestly `parked`. The `factory` CLI warns at the limit. *Alternative rejected:* no limit ("I'll manage") — the evidence of every solo builder's graveyard says otherwise. *Trade-off owned:* a hot opportunity may wait; parking is reversible, dilution isn't.

**D21 — Workspace standard + scaffolding.**
`factory new <name>` scaffolds `~/Factory/<name>`: own git repo, `CLAUDE.md` project contract, `docs/` (PRD/ADR), CI workflow from template, shared skills linked, **per-project Keychain namespace** `agenthub.<project>.<KEY>`. Client work under `~/Factory/clients/<client>/` with hard isolation (S1c: no cross-client context, client named in every artifact header). *Alternative rejected:* monorepo — wrong for independent products with independent deploy targets and possible future divestment.

**D22 — Ship path is CI, always; production credentials live in GitHub Actions secrets, not on the Mac; local prod-mutating CLI use is T2 via `guard`.**
Fine-grained per-repo GitHub tokens; Azure/Supabase service credentials scoped per project; direct `az`/`supabase`/`stripe` writes against production pop the approval dialog first. *Alternative rejected (council, see round 4):* zero cloud credentials on the Mac — impractical for a solo operator who must debug; the compromise is least-privilege + T2-guard + CI as the sanctioned path.

**D23 — Review station uses a second model by doctrine.**
Default: ChatGPT (prepaid) reviews what Claude Code built — genuinely different model families catch different failure classes; sensitive code reviews locally on the 27B. *Alternative rejected:* self-review by the building model — cheapest and weakest.

**D24 — Factory metrics stay registry-derived and lightweight.**
Cycle time intake→ship, CI green rate, WIP adherence — computed into the digest. *Alternative rejected:* dashboards/BI for a team of one; the digest is the dashboard (D17 extended).

**D25 — Backup scope extends to `~/Factory`** (excluding build artifacts/node_modules/.venv); restore drill now spot-checks one product repo alongside one vault file.

---

## Council round 4 — factory review, **with counter-critique**
*(Owner instruction: act on every advice critically and stay super-aligned to the primary goal — maximum shipped value per Kos-hour at world-class robustness. Each verdict below states what was adopted, what was rejected, and why.)*

**Security architect:** "Per-project cloud credentials on the front-door machine expand blast radius. Ideal: zero production credentials locally — all deploys CI-only; even debugging via short-lived tokens minted per session."
→ **Adopted in part, rejected in part.** CI-resident credentials as the default: adopted (D22). *Zero* local credentials: **rejected** — a solo operator who cannot run `supabase db diff` or `az` reads against staging without a ceremony will bypass the ceremony within a fortnight, and a security control people route around is worse than a smaller honest one. Ruling: least-privilege per-project tokens locally, short-lived where the platform supports it, **prod writes T2-guarded**. Trade-off stated and owned.

**Agent-systems architect:** "A 'factory' deserves real orchestration — adopt a workflow framework (queue, DAG engine) now, before scripts calcify."
→ **Rejected.** The complexity budget was spent deliberately: stations are *convention + gates + Claude Code skills*, not a framework. A DAG engine for a one-person factory reintroduces exactly the dependency churn this design just eliminated, and the primary goal is shipped products, not shipped orchestration. **Adopted from the same critique:** the station gates must be *written* (they are — canon addendum) and the pipeline must refuse gate-skips silently becoming normal: stage transitions are logged in the registry, so skips are visible in the digest. Revisit trigger: a second human joins the factory.

**SRE:** "Every repo gets CI + branch protection from day one — non-negotiable. Also consider self-hosted runners on the M5 Max; it's idle most nights and faster than free runners."
→ **CI + branch protection: adopted fully** (scaffold includes both). **Self-hosted runners: rejected** — they invert the security posture (a laptop executing workflows triggered by remote events is an inbound-control channel in disguise), and runner availability would depend on a lid being open. GitHub-hosted runners; if build minutes ever bite, that's a paid-tier decision, not an architecture change.

**Local-inference engineer:** "Factory hours will contend for memory: Claude Code sessions + local review on the 27B + the resident 35B. Consider making coding mode the daytime default."
→ **Adopted in part.** The review station defaults to the *subscription* lane (ChatGPT), so the common case adds no local load; the 27B loads only for sensitive-code review — and that's a one-command mode switch. Making coding mode the *default* is **rejected**: the 35B underpins triage-adjacent and chief-of-staff work all day; the factory shouldn't degrade the front door. Standing order retained: bench after every runtime update.

**Data-governance specialist:** "Client isolation (S1c) is right — add that client artifacts never enter `kb_main`; retrieval for client work happens from the client folder only. And product telemetry: aggregates only, ever."
→ **Adopted verbatim, both.** `kb_clients_<name>` tables per client if indexing is ever wanted; nothing client-flavoured in the general KB. Telemetry rule already in D-toolchain; restated in canon.

**Cost/eval lead:** "The factory's real cost is attention, not tokens. Add kill/park criteria per product to the registry (what evidence parks it), and put cycle-time on the digest so 'busy' can't impersonate 'shipping'. Also: watch Fable-5 temptation in build sessions — frontier models for non-frontier tickets is the new premium-for-comfort."
→ **Adopted fully.** Registry gains a `park_when:` field per product; cycle time in the digest (D24); Fable 5 remains a conscious, logged escalation. **Counter-note to the council at large:** three of six critiques this round asked for *more* machinery (framework, runners, zero-cred ceremony). The standing bias of this design is the opposite — machinery must buy shipped value or it doesn't board. That bias is itself a decision, recorded here, reviewed quarterly against evidence.

**Alignment statement:** every adopted item shortens the path from idea to shipped, secured output; every rejected item would have lengthened it while flattering robustness on paper. Residual unknowns remain machine-verifiable with named gates (bench, canaries, CI green, restore drill). No open questions to the owner.

## Council review (synthesis)

Reasoning-lab consensus on canvases and harnesses, applied to AgentHub:

- **One surface, many states.** A project is not a separate page from a canvas — it is a canvas that has been *promoted*. Two tabs for the same object is the confusion you're feeling. Fix: one Canvas surface where any document can carry a project stage (idea → wip → shipped).
- **One-word tabs.** Compound labels ("Canvas · think", "Triage · yesterday") read as jargon. Single nouns force clarity.
- **Inbox beats triage.** "Triage" describes the machine's internal job, not your job. What you want is one stream where anything arriving — a thought, a link, a document, a nightly-classified item — lands, gets a class and a sensitivity, and then leaves the stream via exactly one of four exits: **discard, keep as context, become a skill, become a canvas**. That "so what" is the missing piece: nothing in the inbox is done until it has exited.
- **Skills need a lifecycle, not a folder.** Anthropic's practice: small focused files, a crisp `description` that decides retrieval, progressive disclosure (SKILL.md + references), and version history. Skills must be discovered, proposed, reviewed, promoted, used, measured, and deprecated — a loop, not a list.

## Target navigation (one word each)

```
Overview   Canvas   Inbox   Skills   Corpus   Engine   Health
```

- **Canvas** — absorbs Projects. Library lists every canvas with its stage, WIP badge, and last run. Stage controls (idea / wip / review / shipped) live in the canvas header and drive the same WIP limit the Projects table used.
- **Inbox** — absorbs Capture and Triage into one stream.
- **Skills** — promoted out of Engine to a top-level tab; it now owns the discovery loop.
- Old routes (`/capture`, `/digest`, `/factory`) become redirects so bookmarks and the PWA shell keep working.

## Canvas ← Projects merge

- Canvas doc gains `stage`, `client`, `sensitivity`, `wip` fields; stored in the same local `.canvas.json`.
- Canvas library becomes a **board**: columns by stage, each card showing block count, run count, last run time, and stage.
- WIP limit enforced in the UI: promoting a canvas to `wip` past the limit shows a copper warning rather than blocking silently.
- Remote plane still only sees counts — the board reads local; when the machine is away, the header shows counts from published `factory` state and nothing else.
- Factory stage actions keep using the existing local `POST /api/factory/action` (multipart), and the existing `factory_stage` job for the remote plane.

## Inbox — one stream of flow

A single reverse-chronological stream. Each item is a card with:

- **Class** (idea, context, task, reference), **Entity**, **Sensitivity** (S0/S1p/S1c/S2/S3) — all inline-editable, and every correction posts to `/api/eval/correct`, exactly as Digest does today, so corrections still become golden eval items.
- **Four exits**, one press each:
  - *Discard* — dismissed with a reason.
  - *Keep as context* — ingest into the corpus (`ingest` job / local ingest).
  - *Make a skill* — opens the skill drafter pre-filled from the item.
  - *Open as canvas* — creates a canvas seeded with the item as its first note block.
- **Sources merged into one stream**: manual captures (queued offline via existing IndexedDB queue), nightly digest items for any date, and held remote captures. Date chips filter; they do not split the page.
- Remote plane shows counts only, no item text — unchanged privacy rule.

## Skills module — evergreen loop

New local module with five states: `proposed → active → watch → deprecated → archived`.

1. **Mine (daily).** A `skill_scan` run collects candidates from: repeated Inbox items with the same class/entity, canvas prompts re-used across documents, cascade escalations, and eval failures. Runs on the machine; presented in Skills → *Proposed*.
2. **Council review.** Each proposal renders a review card: evidence (what triggered it), a drafted `SKILL.md` following Anthropic's shape (frontmatter `name` + trigger-focused `description`, body ≤ ~500 lines, `references/` for depth), and three verdicts — **add**, **modify**, **remove**. Your verdict is recorded with a timestamp and note.
3. **Version history.** Every save writes `skills/<name>/versions/<iso>.md` alongside `SKILL.md`; the detail view lists versions with a word-level diff and a one-press revert.
4. **Dynamic loading.** Skills carry `triggers` (keywords/entities) and a `scope` (canvas, project, both). Canvas prompt blocks auto-attach matching skills, shown as removable chips, and a `+ skill` picker allows manual invocation. Attached skills are recorded in each run's provenance so you can see which skill shaped which answer.
5. **Deprecate.** Usage counters per skill (attach count, last used). A skill unused for 60 days or failing its evals moves to *watch*, then *deprecated* with one press; deprecated skills stop auto-attaching but stay readable.

All skill reads/writes go through the existing local file endpoints (`/api/tree`, `/api/file`, `/api/file/save`, `/api/file/new`, `/api/file/delete`) — multipart form fields on every POST, never JSON. No new machine code is required, and `machine/` is untouched.

## Critique pass (before shipping)

Checks I'll run against this build: no tab label longer than one word; no duplicated surface for the same object; every Inbox item has a visible exit; skills auto-attachment visible before running, not after; local-only sections wrapped in `LocalOnly` with the quiet line and no Supabase fallback; nothing but status and counts on the remote plane; 390px layout verified; published to agenthub.thisiskaus.com.

## Technical notes

- Files: `src/components/AppShell.tsx` (nav), `src/routes/_authenticated/canvas.tsx` (board + stage), `src/routes/_authenticated/inbox.tsx` (new, merging capture + digest), `src/routes/_authenticated/skills.tsx` (rewrite), new `src/lib/skills-store.ts`, `src/lib/inbox.ts`, additions to `src/lib/canvas-types.ts`.
- Redirect routes retained for `/capture`, `/digest`, `/factory`, `/ask`.
- Supabase untouched except reading existing `state` / writing existing `jobs` kinds.

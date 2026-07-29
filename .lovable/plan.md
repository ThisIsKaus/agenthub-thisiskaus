## Confirmation of the AgentHub context

Read and understood. Summary of what governs this build:

**Connection direction.** The Mac accepts no inbound connections (firewall block-all, stealth on). An agent on the machine polls Supabase (Lovable Cloud) outbound every 30 seconds, claims jobs, executes them locally, and writes results back. This web app only ever talks to Cloud: it writes rows to `jobs` and reads the single `state` row. It never contacts the machine, and no endpoint on the machine exists to contact.

**What this app may never display.** The agent publishes status and counts only. So the app must never render digest item content, document titles, file paths, email subjects, answers drawn from the corpus, or any personal data. Digest shows counts and flags, never text. S3 finance/tax/wealth is local-only and never surfaces here at all; S2 (Envelope Collective) writes are never initiated from this app.

---

## Plan — AgentHub Remote, phase 1

### 1. Backend (Lovable Cloud)

Enable Cloud, then one migration:

- `state` — `id text primary key` (always `'current'`), jsonb columns `services`, `models`, `corpus`, `spend`, `factory`, `digest`, `health`, plus `updated_at`. Field names inside each object exactly as specified in the contract.
- `jobs` — `id uuid`, `kind text` constrained to `capture | factory_stage | ingest | intake | report`, `payload jsonb`, `status text` (`queued | claimed | done | failed`), `result jsonb`, `error text`, `created_at`, `claimed_at`, `completed_at`.

RLS enabled on both. Policies: authenticated users may `select` `state` and `select`/`insert` `jobs`; `service_role` gets full access so the polling agent (using the service key) can claim jobs and update `state`. Explicit `GRANT`s for `authenticated` and `service_role`; no `anon` access anywhere.

Seed a single `state` row with `id = 'current'` and empty-but-shaped JSON so the UI has something to read on first load.

### 2. Auth

- Email magic link only, no password, no sign-up UI.
- `ALLOWED_EMAIL` stored as a Cloud secret. Sign-in goes through a server function that compares the submitted address (case-insensitively) against the secret before any magic link is sent; a mismatch returns exactly **"This instance is private."** and sends nothing.
- Signed-out view: one centred card, Instrument Serif title, one email field, one button. Nothing else.
- All five tabs live under the protected `_authenticated` subtree; `/` renders the sign-in card and redirects to the app when a session exists.

### 3. Design system

`src/styles.css` gets the exact palette as tokens (ink, panel, panel2, rule, copper, paper, muted, faint, ok, watch, risk) and three font families. Google Fonts loaded via `<link>` in the root route: Instrument Serif, Inter 300/400/500, Geist Mono.

Global rules baked into the tokens and components: radius capped at 2px, 1px hairline borders instead of shadows, copper reserved for accents/active states, monospace for every number, timestamp and status pill, serif for headings only.

### 4. Shell and tabs

- Sticky header: "AgentHub Remote" in Instrument Serif plus a horizontally scrollable row of monospace status pills fed from `state` (router, LM Studio, health, spend).
- Tab bar beneath the header — copper underline on the active tab, no fills.
- Content column max-width 1100px, mobile-first spacing.
- Five routes created as empty, correctly-styled shells: Overview, Capture, Digest, Factory, Cost. Each gets its own `head()` with a unique title and description.

Capture is flagged as the next build (it inserts a `capture` job) but this phase delivers the shell only, per the layout brief.

### 5. Technical notes

- `state` and `jobs` reads go through TanStack Query with a 30s refetch so the UI tracks the agent's poll cadence.
- Job inserts happen through an authenticated server function, so the payload shape is validated server-side rather than trusted from the browser.
- No feature in this phase reads or renders corpus-derived text.

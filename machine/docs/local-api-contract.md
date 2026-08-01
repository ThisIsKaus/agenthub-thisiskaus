# AgentHub local API — contract for Lovable
_Generated from console.py by AST parse, 2026-08-01T21:37. Do not edit by hand._

## How to call it

Base URL `http://127.0.0.1:4100`. Reachable only from a browser running on the
machine itself. A loopback fetch from an HTTPS page is permitted — MDN: local
resources are considered to be from secure origins, just like HTTPS origins.

```ts
const BASE = 'http://127.0.0.1:4100';

// GET with query parameters
const get = async (path: string, query?: Record<string, string|number>) => {
  const qs = query ? '?' + new URLSearchParams(
    Object.entries(query).map(([k, v]) => [k, String(v)])).toString() : '';
  const r = await fetch(BASE + path + qs, { credentials: 'omit' });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

// POST with form fields — the API uses multipart form data, never JSON bodies
const post = async (path: string, form: Record<string, string|number|Blob>) => {
  const fd = new FormData();
  Object.entries(form).forEach(([k, v]) => fd.append(k, v as any));
  const r = await fetch(BASE + path, { method: 'POST', body: fd, credentials: 'omit' });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
```

Every POST takes **multipart form fields**, not a JSON body. Sending JSON will
return HTTP 422. A 403 means the path was outside the allowlist or an approval
dialog was denied — surface it as a refusal, never as an error.

## Endpoints (35)

| Method | Path | Parameters | Purpose |
|---|---|---|---|
| GET | `/` | no parameters | index |
| POST | `/api/ask` | form: { q: string, model?: string, k?: number } | ask |
| POST | `/api/build` | form: { intent: string, scope?: string } | build |
| GET | `/api/capabilities` | no parameters | Probed by the unified console to decide whether the local plane is available. |
| POST | `/api/capture` | form: { text: string } | capture |
| GET | `/api/cascade/stats` | no parameters | cascade_stats |
| GET | `/api/cost` | query: { days?: number } | cost |
| GET | `/api/digest` | query: { date?: string } | digest |
| POST | `/api/draft` | form: { title: string, body: string } | draft |
| POST | `/api/eval/correct` | form: { text: string, cls: string, entity: string, sensitivity: string, injection?: string } | Append a real-world correction to the golden set. This is the learning loop. |
| GET | `/api/evals` | no parameters | evals |
| GET | `/api/factory` | no parameters | factory |
| POST | `/api/factory/action` | form: { action: string, name?: string, stage?: string } | factory_action |
| GET | `/api/file` | query: { path: string } | get_file |
| POST | `/api/file/delete` | form: { path: string } | delete_file |
| POST | `/api/file/new` | form: { path: string, name: string, kind?: string } | new_file |
| POST | `/api/file/save` | form: { path: string, content: string } | save_file |
| GET | `/api/health` | no parameters | health |
| GET | `/api/job` | query: { id: string } | job |
| GET | `/api/kb` | no parameters | kb_stats |
| POST | `/api/kb/forget` | form: { path: string } | kb_forget |
| GET | `/api/memory` | query: { q?: string, n?: number } | memory |
| GET | `/api/models` | no parameters | models |
| POST | `/api/models/action` | form: { action: string, model?: string } | models_action |
| GET | `/api/prompts` | no parameters | prompts |
| POST | `/api/prompts/save` | form: { path: string, content: string } | prompts_save |
| GET | `/api/proposals` | no parameters | proposals_list |
| POST | `/api/proposals/act` | form: { id: string, action: string, note?: string } | proposals_act |
| GET | `/api/roots` | no parameters | roots |
| POST | `/api/run` | form: { key: string } | run |
| GET | `/api/selftest` | no parameters | selftest_last |
| GET | `/api/skills` | no parameters | skills_list |
| POST | `/api/skills/save` | form: { path: string, content: string } | skills_save |
| GET | `/api/state` | no parameters | state |
| GET | `/api/tree` | query: { path?: string } | tree |

## Job commands

POST `/api/run` with `key` set to one of these. It returns `{job, label}`.
Poll GET `/api/job?id=` every 900ms until `running` is false.

| key | label | tier |
|---|---|---|
| `verify` | Self-test | T0 |
| `doctor` | Health check | T0 |
| `intake` | Run intake | T1 |
| `ingest` | Ingest documents | T1 |
| `eval` | Score triage | T0 |
| `backup` | Back up now | T1 |
| `report` | Rebuild report | T0 |
| `repair` | Repair to known-good | T1 |
| `summarise` | Write memory note | T1 |
| `diagnose` | Diagnose | T1 |

## Response shapes worth typing

```ts
type Capabilities = { ok: boolean; version: number; time: string; features: string[] };

type Job = { key: string; out: string; running: boolean; code: number | null };

type AskResult = {
  answer: string;
  model: string;
  sources: { file: string; path: string; distance: number }[];
};

type TreeListing = {
  root: string; parent: string;
  dirs: { name: string; path: string; gated?: boolean }[];
  files: { name: string; path: string; size: number; modified: string; editable: boolean }[];
};

type FileContent = { path: string; name: string; raw: string; html: string; editable: boolean };

type KbStats = {
  chunks: number; documents: number;
  sources: { file: string; path: string; chunks: number }[];
  error?: string;
};

type DigestItem = { flag: boolean; src: string; cls: string; ent: string; sen: string; one: string };
type Digest = { date: string; items: DigestItem[]; dates: string[] };

type Models = {
  resident: { id: string; size: string }[];
  available: string[];
  bench: { role: string; id: string; tps: string; gib: string }[];
  aliases: string[];
};

type Evals = {
  results: { file: string; model: string; date: string; scores: Record<string, number> }[];
  set_size: number; real_items: number;
};

type SelfTest = {
  file: string | null; summary: string;
  rows: { group: string; name: string; state: 'pass'|'warn'|'FAIL'; detail: string }[];
};

type Memory = {
  stats: { events: number; days: number; cost: number; since: string;
           by_kind: { kind: string; n: number }[] };
  events: { ts: string; kind: string; model: string; question: string;
            answer: string; sources: any[] }[];
};
```

## Rules the interface must respect

- These endpoints read material classed S1c, S2 and S3. **Never** send any response
  from them to Supabase, to analytics, or to any external service. They exist to be
  rendered locally and discarded.
- A 403 from `/api/file/delete` or `/api/kb/forget` means the native approval dialog
  was denied. That is a successful outcome of a working control — render it as
  "denied at the approval dialog", never as a failure.
- Deletion and forget block while the dialog is open, for up to five minutes. Show
  "awaiting approval on the machine…" rather than a spinner.
- Executable files (`.py`, `.sh`, `.plist`) are read-only by design. Do not offer an
  edit control for them.

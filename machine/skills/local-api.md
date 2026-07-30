# Local API

Base `http://127.0.0.1:4100`, `credentials: 'omit'`. **Every POST takes multipart form fields,
never a JSON body — JSON returns 422.** A 403 means the path was outside the allowlist or an
approval dialog was denied: render as a refusal ("denied at the approval dialog"), never an
error. Delete and forget block while the dialog is open, up to 5 minutes — show "awaiting
approval on the machine…", not a spinner. Executable files (.py, .sh, .plist) are read-only
by design; offer no edit control for them.

| Endpoint | Parameters |
|---|---|
| POST `/api/ask` | form: { q: string, model?: string, k?: number } |
| GET `/api/capabilities` | no parameters |
| POST `/api/capture` | form: { text: string } |
| GET `/api/cost` | query: { days?: number } |
| GET `/api/digest` | query: { date?: string } |
| POST `/api/draft` | form: { title: string, body: string } |
| POST `/api/eval/correct` | form: { text: string, cls: string, entity: string, sensitivity: string, injection?: string } |
| GET `/api/evals` | no parameters |
| GET `/api/factory` | no parameters |
| POST `/api/factory/action` | form: { action: string, name?: string, stage?: string } |
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
| GET `/api/roots` | no parameters |
| POST `/api/run` | form: { key: string } |
| GET `/api/selftest` | no parameters |
| GET `/api/state` | no parameters |
| GET `/api/tree` | query: { path?: string } |

POST `/api/run` with `key` returns `{job, label}`; poll GET `/api/job?id=` every 900ms until
`running` is false. Keys: verify(T0), doctor(T0), intake(T1), ingest(T1), eval(T0), backup(T1), report(T0), repair(T1), summarise(T1).

Key shapes: `Capabilities {ok, version, time, features[], machine}` ·
`Job {key, out, running, code}` · `AskResult {answer, model, sources[{file, path, distance}]}` ·
`TreeListing {root, parent, dirs[], files[{name, path, size, modified, editable}]}` ·
`FileContent {path, name, raw, html, editable}` ·
`KbStats {chunks, documents, sources[{file, path, chunks}]}` ·
`Digest {date, items[{flag, src, cls, ent, sen, one}], dates[]}` ·
`Models {resident[], available[], bench[{role, id, tps, gib}], aliases[]}` ·
`Evals {results[{date, model, scores}], set_size, real_items}` ·
`SelfTest {summary, rows[{group, name, state, detail}]}` ·
`Memory {stats, events[{ts, kind, model, question, answer}]}`

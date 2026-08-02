#!/usr/bin/env python3
"""
AgentHub Console v2 — the operational control surface.

Doctrine:
  - binds 127.0.0.1 only
  - invents no capability: actions map to scripts and files already proven in the terminal
  - the browser requests, the native dialog authorises: destructive actions call approve.sh
  - executable code is never writable from the browser (.py, .sh, .zsh are read-only always)
  - ~/AgentHub/vault is unreadable by construction
"""

import json, os, re, shutil, subprocess, sys, threading, uuid
import datetime as dt
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import HTMLResponse, JSONResponse
import requests

HOME = Path.home()
H = HOME / "AgentHub"
FAC = HOME / "Factory"
UI = H / "console" / "console.html"
ROUTER = "http://127.0.0.1:4000/v1"
LMS = "http://127.0.0.1:1234/v1"

sys.path.insert(0, str(H / "console"))
try:
    import sessions
except Exception:
    sessions = None
sys.path.insert(0, str(H / "report"))
try:
    import build_report as br
except Exception:
    br = None

READ_ROOTS = [H / "canon", H / "docs", H / "drafts", H / "digests", H / "evals",
              H / "logs", H / "factory", H / "inbox", H / "report", FAC]
WRITE_ROOTS = [H / "canon", H / "docs", H / "drafts", H / "evals", H / "factory", H / "inbox"]
SKILLS_ROOTS = [H / "skills"]
BLOCKED_ROOTS = [H / "vault"]
NEVER_WRITE_SUFFIX = {".py", ".sh", ".zsh", ".bash", ".plist", ".lock"}
TEXT_SUFFIX = {".md", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".csv"}

COMMANDS = {
    "verify":        {"argv": ["/usr/bin/python3", str(H / "scripts/selftest.py")], "label": "Self-test", "tier": "T0"},
    "doctor":        {"argv": [str(H / "scripts/doctor.sh")], "label": "Health check", "tier": "T0"},
    "intake":        {"argv": [str(H / "scripts/intake")], "label": "Run intake", "tier": "T1"},
    "ingest":        {"argv": ["/opt/homebrew/bin/uv", "run", "--project", str(H / "kbtool"),
                               "python", str(H / "kbtool/ingest.py"), "--incremental"],
                      "label": "Ingest documents", "tier": "T1"},
    "eval":          {"argv": [str(H / "scripts/eval")], "label": "Score triage", "tier": "T0"},
    "backup":        {"argv": [str(H / "scripts/backup.sh")], "label": "Back up now", "tier": "T1"},
    "report":        {"argv": ["/opt/homebrew/bin/uv", "run", "--python", "3.12",
                               str(H / "report/build_report.py")], "label": "Rebuild report", "tier": "T0"},
    "repair":        {"argv": [str(H / "scripts/repair")], "label": "Repair to known-good", "tier": "T1"},
    "summarise":     {"argv": ["/opt/homebrew/bin/uv", "run", "--project", str(H / "console"),
                               "python", str(H / "console/sessions.py"), "summarise"],
                      "label": "Write memory note", "tier": "T1"},
    "diagnose":      {"argv": [str(H / "build/diagnose.py")], "label": "Diagnose", "tier": "T1"},
}

JOBS = {}
app = FastAPI(title="AgentHub Console v2")

# The unified console is served from Lovable over HTTPS and calls this API over loopback.
# A browser permits that (MDN: loopback is a potentially trustworthy origin), but the API
# must name the origins it trusts. Strict allowlist — no wildcard, no regex, no credentials.
ALLOWED_ORIGINS = [
    "https://agenthub.thisiskaus.com",
    "http://localhost:8080",     # Lovable preview
    "http://localhost:5173",     # Vite dev
    "http://127.0.0.1:4100",     # self
]
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    max_age=600,
)


# ---------------------------------------------------------------- helpers

def _resolve(raw, roots):
    p = Path(raw).expanduser().resolve()
    for b in BLOCKED_ROOTS:
        if str(p).startswith(str(b.resolve())):
            raise HTTPException(403, "blocked by sensitivity policy")
    for a in roots:
        try:
            if str(p).startswith(str(a.resolve())):
                return p
        except Exception:
            continue
    raise HTTPException(403, "outside the allowed roots")


def read_path(raw):
    return _resolve(raw, READ_ROOTS)


def write_path(raw):
    p = _resolve(raw, WRITE_ROOTS)
    if p.suffix.lower() in NEVER_WRITE_SUFFIX:
        raise HTTPException(403, "executable and system files are read-only from the console")
    return p


def approve(action, source):
    r = subprocess.run([str(H / "scripts/approve.sh"), str(action)[:120], str(source)[:300]])
    return r.returncode == 0


def audit(note):
    try:
        with open(H / "logs" / "audit.jsonl", "a") as f:
            f.write(json.dumps({"ts": dt.datetime.now().isoformat(timespec="seconds"),
                                "note": f"console: {note}"}) + "\n")
    except Exception:
        pass


def git_commit(message):
    try:
        subprocess.run(["git", "-C", str(H), "add", "-A"], capture_output=True, timeout=20)
        subprocess.run(["git", "-C", str(H), "commit", "-m", message],
                       capture_output=True, timeout=20)
    except Exception:
        pass


def md_html(text):
    try:
        import markdown
        return markdown.markdown(text, extensions=["tables", "fenced_code"])
    except Exception:
        return "<pre>" + text.replace("&", "&amp;").replace("<", "&lt;") + "</pre>"


def run_job(job_id, argv):
    j = JOBS[job_id]
    try:
        env = {k: v for k, v in os.environ.items()
               if k not in ("VIRTUAL_ENV", "PYTHONHOME", "PYTHONPATH", "UV_PROJECT_ENVIRONMENT")}
        pr = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, bufsize=1, cwd=str(H), env=env)
        for line in pr.stdout:
            j["out"] += line
            if len(j["out"]) > 300000:
                j["out"] = j["out"][-300000:]
        pr.wait()
        j["code"] = pr.returncode
    except Exception as e:
        j["out"] += f"\nconsole error: {e}\n"
        j["code"] = 1
    j["running"] = False


def sh(cmd, timeout=20):
    try:
        return subprocess.run(cmd, shell=True, capture_output=True, text=True,
                              timeout=timeout).stdout.strip()
    except Exception:
        return ""


# ---------------------------------------------------------------- core

@app.get("/", response_class=HTMLResponse)
def index():
    if not UI.exists():
        return HTMLResponse("<h1>console.html missing</h1>", status_code=500)
    return UI.read_text()


@app.get("/api/memory")
def memory(q: str = "", n: int = 25):
    if not sessions:
        raise HTTPException(500, "session memory unavailable")
    return {"stats": sessions.stats(),
            "events": sessions.search(q, n) if q.strip() else sessions.recent(n)}


def _machine():
    try:
        sys.path.insert(0, str(H / "scripts"))
        import machine_state
        return machine_state.collect()
    except Exception:
        return {}


@app.get("/api/capabilities")
def capabilities():
    """Probed by the unified console to decide whether the local plane is available."""
    return {"ok": True, "version": 2,
            "time": dt.datetime.now().isoformat(timespec="seconds"),
            "features": ["ask", "files", "models", "prompts", "digest", "corrections",
                         "knowledge", "memory", "evals", "factory", "cost", "health", "jobs"],
            "commands": sorted(COMMANDS.keys()),
            "machine": _machine()}


@app.get("/api/health")
def health():
    return {"ok": True, "time": dt.datetime.now().isoformat(timespec="seconds"), "version": 2}


@app.get("/api/state")
def state():
    if br is None:
        return JSONResponse({"error": "build_report not importable"}, status_code=500)
    s = br.collect()
    prev = br.safe(lambda: json.loads((H / "report/state-prev.json").read_text()), {})
    s["deltas"] = br.deltas(s, prev)
    s["commands"] = [{"key": k, "label": v["label"], "tier": v["tier"]} for k, v in COMMANDS.items()]
    return s


# ---------------------------------------------------------------- files

@app.get("/api/tree")
def tree(path: str = ""):
    root = read_path(path) if path else H
    if not root.is_dir():
        raise HTTPException(400, "not a directory")
    dirs, files = [], []
    for p in sorted(root.iterdir()):
        if p.name.startswith(".") or p.name in ("__pycache__", ".venv", "node_modules"):
            continue
        try:
            _resolve(str(p), READ_ROOTS)
        except HTTPException:
            if p.is_dir() and any(str(r).startswith(str(p)) for r in READ_ROOTS):
                dirs.append({"name": p.name, "path": str(p), "gated": True})
            continue
        if p.is_dir():
            dirs.append({"name": p.name, "path": str(p)})
        else:
            st = p.stat()
            files.append({"name": p.name, "path": str(p), "size": st.st_size,
                          "modified": dt.datetime.fromtimestamp(st.st_mtime).isoformat(timespec="minutes"),
                          "editable": p.suffix.lower() in TEXT_SUFFIX
                                      and p.suffix.lower() not in NEVER_WRITE_SUFFIX})
    parent = str(root.parent) if root != H and root != FAC else ""
    return {"root": str(root), "parent": parent, "dirs": dirs, "files": files}


@app.get("/api/roots")
def roots():
    out = []
    for r in [H / "canon", H / "docs", H / "drafts", H / "digests", H / "evals",
              H / "inbox", H / "factory", H / "logs", FAC]:
        if r.exists():
            out.append({"name": r.name if r != FAC else "Factory", "path": str(r)})
    return {"roots": out}


@app.get("/api/file")
def get_file(path: str):
    p = read_path(path)
    if not p.is_file():
        raise HTTPException(404, "not found")
    raw = p.read_text(errors="ignore")[:500000]
    return {"path": str(p), "name": p.name, "raw": raw,
            "html": md_html(raw) if p.suffix.lower() == ".md" else
                    "<pre>" + raw.replace("&", "&amp;").replace("<", "&lt;") + "</pre>",
            "editable": p.suffix.lower() in TEXT_SUFFIX and p.suffix.lower() not in NEVER_WRITE_SUFFIX}


@app.post("/api/file/save")
def save_file(path: str = Form(...), content: str = Form(...)):
    p = write_path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    audit(f"saved {p.name}")
    if str(p).startswith(str(H / "canon")) or str(p).startswith(str(H / "factory")):
        git_commit(f"console: edit {p.name}")
    return {"saved": str(p)}


@app.post("/api/file/new")
def new_file(path: str = Form(...), name: str = Form(...), kind: str = Form("file")):
    parent = _resolve(path, WRITE_ROOTS)
    safe = Path(name).name
    if not safe:
        raise HTTPException(400, "invalid name")
    target = parent / safe
    if target.exists():
        raise HTTPException(409, "already exists")
    if kind == "folder":
        target.mkdir(parents=True)
    else:
        if target.suffix.lower() in NEVER_WRITE_SUFFIX:
            raise HTTPException(403, "cannot create executable files from the console")
        target.write_text("")
    audit(f"created {kind} {safe}")
    return {"created": str(target)}


@app.post("/api/file/delete")
def delete_file(path: str = Form(...)):
    p = _resolve(path, WRITE_ROOTS)
    if not approve(f"DELETE {p.name}", f"AgentHub Console · {p}"):
        raise HTTPException(403, "denied at the approval dialog")
    if p.is_dir():
        shutil.rmtree(p)
    else:
        p.unlink()
    audit(f"deleted {p}")
    return {"deleted": str(p)}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...), dest: str = Form("")):
    target_dir = _resolve(dest, WRITE_ROOTS) if dest else (H / "inbox")
    target_dir.mkdir(parents=True, exist_ok=True)
    name = Path(file.filename or "upload").name
    if Path(name).suffix.lower() not in (".md", ".txt", ".pdf", ".docx", ".csv", ".json"):
        raise HTTPException(400, "unsupported type — md, txt, pdf, docx, csv, json")
    p = target_dir / name
    p.write_bytes(await file.read())
    audit(f"uploaded {name}")
    return {"saved": str(p), "name": name}


# ---------------------------------------------------------------- knowledge

@app.get("/api/kb")
def kb_stats():
    try:
        import lancedb
        t = lancedb.connect(str(H / "kb")).open_table("kb_main")
        df = t.to_pandas()
        by = df["path"].value_counts()
        return {"chunks": int(len(df)), "files": int(df["path"].nunique()),
                "sources": [{"file": Path(k).name, "path": k, "chunks": int(v)}
                            for k, v in by.items()]}
    except Exception as e:
        return {"chunks": 0, "files": 0, "sources": [], "error": f"{type(e).__name__}: {e}"}


@app.post("/api/kb/forget")
def kb_forget(path: str = Form(...)):
    if not approve(f"FORGET {Path(path).name} from the knowledge base", f"AgentHub Console · {path}"):
        raise HTTPException(403, "denied at the approval dialog")
    try:
        import lancedb
        t = lancedb.connect(str(H / "kb")).open_table("kb_main")
        t.delete(f"path = '{path}'")
        audit(f"kb forget {path}")
        return {"forgotten": path}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/ask")
def ask(q: str = Form(...), model: str = Form("local-brain"), k: int = Form(5)):
    context, sources = "", []
    try:
        import lancedb
        e = requests.post(f"{ROUTER}/embeddings",
                          json={"model": "local-embed", "input": [f"search_query: {q}"]}, timeout=60)
        e.raise_for_status()
        vec = e.json()["data"][0]["embedding"]
        tbl = lancedb.connect(str(H / "kb")).open_table("kb_main")
        # One retrieval path for the ask endpoint and every eval, so a change is
        # measured everywhere at once. Hybrid: dense for meaning, BM25 for
        # identifiers, fused on rank. Lane still governs sensitivity.
        sys.path.insert(0, str(H / 'kbtool'))
        import retrieve as _r
        lane = 'cloud' if model.startswith('cloud-') else 'local'
        hits = _r.search(q, k=max(1, min(k, 12)), lane=lane)
        for _h in hits:
            sources.append({'file': _h['file'], 'path': _h['path'],
                            'distance': round(1 - _h['rrf'] * 60, 3),
                            'found_by': _h['found_by']})
            context += '\n--- ' + _h['file'] + '\n' + _h['text'][:1500] + '\n'
    except Exception as ex:
        sources.append({"file": f"retrieval unavailable: {type(ex).__name__}", "distance": 0})

    system = ("You answer from Kos Bajpai's own knowledge base. Quote exact figures, prices, names, identifiers and settings verbatim from the context - never paraphrase a number or a value. Say plainly when the context does not cover the question. Never invent a source. Be concise.")
    body = {"model": model, "max_tokens": 3000, "temperature": 0, "messages": [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {q}"}]}
    try:
        r = requests.post(f"{ROUTER}/chat/completions", json=body, timeout=300)
        if r.status_code >= 400:
            return {"answer": f"router {r.status_code}: {r.text[:300]}", "sources": sources}
        m = r.json()["choices"][0]["message"]
        answer = (m.get("content") or "").strip() or (m.get("reasoning_content") or "").strip()
        audit(f"ask via {model}")
        if sessions:
            sessions.log("ask", q, answer, model, sources)
        return {"answer": answer or "(empty response)", "sources": sources, "model": model}
    except Exception as ex:
        return {"answer": f"error: {ex}", "sources": sources}


@app.post("/api/draft")
def draft(title: str = Form(...), body: str = Form(...)):
    (H / "drafts").mkdir(exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    safe = "".join(c if c.isalnum() or c in "-_ " else "" for c in title)[:60].strip().replace(" ", "-")
    p = H / "drafts" / f"{stamp}-{safe or 'draft'}.md"
    p.write_text(f"# {title}\n\n_saved from the console {dt.datetime.now().isoformat(timespec='minutes')}_\n\n{body}\n")
    return {"saved": str(p), "name": p.name}


@app.post("/api/capture")
def capture(text: str = Form(...)):
    (H / "inbox").mkdir(exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    p = H / "inbox" / f"capture-{stamp}.md"
    p.write_text(f"# Capture {dt.datetime.now().isoformat(timespec='minutes')}\n\n{text}\n")
    return {"saved": str(p), "name": p.name}


CLASSIFY_SCHEMA = {"type": "json_schema", "json_schema": {"name": "classify", "strict": True, "schema": {
    "type": "object",
    "properties": {
        "intent": {"type": "string", "enum": ["capture", "ask", "build", "search"]},
        "confidence": {"type": "number"},
        "alternatives": {"type": "array", "items": {"type": "string", "enum": ["capture", "ask", "build", "search"]}}},
    "required": ["intent", "confidence", "alternatives"]}}}

CLASSIFY_SYSTEM = (
    "Classify the input into exactly one of three intents.\n"
    "capture — records a thought, a decision, a fact, an observation or an idea for later. "
    "Anything that states something rather than requesting something. Includes ideas about "
    "changes to make, because recording is safe and acting is not.\n"
    "ask — a question about material that already exists. Usually contains what, why, how, "
    "when, which, or a question mark.\n"
    "search — a bare term, name or phrase with no verb and no question. Two or three words "
    "naming a thing, not asking about it.\n"
    "If the input could be a question or a search, choose ask. If it could be a thought or "
    "an instruction, choose capture. Both defaults read or record; neither acts.")


@app.post("/api/classify")
def classify(text: str = Form(...)):
    """Route omnibox input to one of four intents.

    The 4B is a thinking model: schema-constrained output arrives in reasoning_content, not
    content, so reading content alone yields an empty string and a JSONDecodeError. Every
    other caller in this file already handles that; this one did not.
    """
    body = {"model": "local-triage", "temperature": 0, "max_tokens": 900,
            "response_format": CLASSIFY_SCHEMA,
            "messages": [{"role": "system", "content": CLASSIFY_SYSTEM},
                         {"role": "user", "content": text}]}
    try:
        r = requests.post(f"{ROUTER}/chat/completions", json=body, timeout=90)
        if r.status_code >= 400:
            raise HTTPException(502, f"router {r.status_code}: {r.text[:200]}")
        m = r.json()["choices"][0]["message"]
        raw = ((m.get("content") or "").strip() or (m.get("reasoning_content") or "").strip())
        found = re.search(r"\{.*\}", raw, re.S)
        data = json.loads(found.group(0)) if found else {}
    except HTTPException:
        raise
    except Exception as ex:
        # Ambiguity resolves to ask, which reads and never writes. A classifier that fails
        # closed toward the safe intent is better than one that errors and blocks the input.
        return {"intent": "ask", "confidence": 0.0, "alternatives": [],
                "note": f"classification unavailable ({type(ex).__name__})"}
    # Build is never auto-selected. Capture and build are not separable from the text —
    # "the cost page should show a weekly average" is both a thought to record and a change
    # to make, and only the operator knows which. Build is the sole intent that writes, so it
    # is opt-in via the chip or a keystroke. Measured 3 Aug: auto-classification produced
    # three false builds in twenty, and a false build starts work you did not ask for.
    intent = data.get("intent", "ask")
    if intent not in ("capture", "ask", "search"):
        intent = "capture" if intent == "build" else "ask"
    return {"intent": intent,
            "confidence": data.get("confidence", 0),
            "alternatives": data.get("alternatives", [])}

# ---------------------------------------------------------------- models

@app.get("/api/models")
def models():
    resident, available, bench = [], [], []
    out = sh("lms ps", timeout=15)
    for line in out.splitlines():
        line = line.strip()
        if not line or line.startswith("IDENTIFIER"):
            continue
        parts = line.split()
        resident.append({"id": parts[0], "size": parts[3] + " " + parts[4] if len(parts) > 4 else ""})
    try:
        r = requests.get(f"{LMS}/models", timeout=6)
        _j = r.json()
        _m = _j["choices"][0]["message"]
        raw = (_m.get("content") or "") or (_m.get("reasoning_content") or "")
        _o = json.loads(re.search(r"\{.*\}", raw, re.S).group(0))
    except Exception:
        pass
    try:
        for line in (H / "models.lock.yaml").read_text().splitlines():
            m = re.search(r"role:\s*([\w-]+).*?id:\s*([^,]+),", line)
            if m:
                g = re.search(r"gen_tps:\s*([\d.]+)", line)
                gi = re.search(r"loaded_gib:\s*([\d.]+)", line)
                bench.append({"role": m.group(1), "id": m.group(2).strip(),
                              "tps": g.group(1) if g else "—", "gib": gi.group(1) if gi else "—"})
    except Exception:
        pass
    aliases = []
    try:
        for line in (H / "router.yaml").read_text().splitlines():
            m = re.search(r"model_name:\s*(\S+)", line)
            if m:
                aliases.append(m.group(1))
    except Exception:
        pass
    return {"resident": resident, "available": available, "bench": bench, "aliases": aliases}


@app.post("/api/models/action")
def models_action(action: str = Form(...), model: str = Form("")):
    if action == "mode":
        if model not in ("standard", "coding", "tools", "light"):
            raise HTTPException(400, "unknown mode")
        argv = [str(H / "scripts/mode"), model]
    elif action == "load":
        argv = ["/Users/" + os.environ.get("USER", "") + "/.lmstudio/bin/lms", "load", model]
    elif action == "unload":
        argv = ["/Users/" + os.environ.get("USER", "") + "/.lmstudio/bin/lms", "unload", model]
    else:
        raise HTTPException(400, "unknown action")
    jid = uuid.uuid4().hex[:8]
    JOBS[jid] = {"key": f"{action} {model}", "out": "", "running": True, "code": None}
    threading.Thread(target=run_job, args=(jid, argv), daemon=True).start()
    audit(f"models {action} {model}")
    return {"job": jid, "label": f"{action} {model}"}


# ---------------------------------------------------------------- prompts

@app.get("/api/prompts")
def prompts():
    out = []
    for p in sorted((H / "canon").glob("*.md")):
        out.append({"name": p.name, "path": str(p), "kind": "canon"})
    pl = H / "graphtool" / "pipeline.py"
    if pl.exists():
        src = pl.read_text()
        try:
            i = src.index('SYSTEM = """') + len('SYSTEM = """')
            j = src.index('"""', i)
            out.append({"name": "triage system prompt", "path": "special:triage",
                        "kind": "prompt", "body": src[i:j]})
        except ValueError:
            pass
    return {"prompts": out}


@app.post("/api/prompts/save")
def prompts_save(path: str = Form(...), content: str = Form(...)):
    if path == "special:triage":
        pl = H / "graphtool" / "pipeline.py"
        src = pl.read_text()
        i = src.index('SYSTEM = """') + len('SYSTEM = """')
        j = src.index('"""', i)
        if '"""' in content:
            raise HTTPException(400, "the prompt cannot contain a triple quote")
        pl.write_text(src[:i] + content + src[j:])
        git_commit("console: edit triage system prompt")
        audit("edited triage prompt")
        return {"saved": "triage system prompt",
                "note": "re-run Score triage — a prompt change without a re-score is unverified"}
    return save_file(path=path, content=content)


# ---------------------------------------------------------------- skills

@app.post("/api/skills/save")
def skills_save(path: str = Form(...), content: str = Form(...)):
    p = _resolve(path, SKILLS_ROOTS)
    if p.suffix.lower() in NEVER_WRITE_SUFFIX:
        raise HTTPException(403, "executable and system files are read-only from the console")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    audit(f"saved skill {p.name}")
    git_commit(f"console: edit {p.name}")
    return {"saved": str(p)}


# ---------------------------------------------------------------- digest and corrections

@app.get("/api/digest")
def digest(date: str = ""):
    files = sorted((H / "digests").glob("*.md"))
    if not files:
        return {"date": None, "items": []}
    p = (H / "digests" / f"{date}.md") if date else files[-1]
    if not p.exists():
        p = files[-1]
    items = []
    pat = re.compile(r"^- (\[FLAG\] )?`([^`]+)` \[([^/\]]+)/([^/\]]+)/([^\]]+)\] ?(.*)$")
    for line in p.read_text(errors="ignore").splitlines():
        m = pat.match(line.strip())
        if m:
            f, src, cls, ent, sen, one = m.groups()
            items.append({"flag": bool(f), "src": src, "cls": cls.strip(), "ent": ent.strip(),
                          "sen": sen.strip(), "one": one.strip()})
    return {"date": p.stem, "items": items,
            "dates": [x.stem for x in files[-14:]][::-1]}


@app.post("/api/eval/correct")
def eval_correct(text: str = Form(...), cls: str = Form(...), entity: str = Form(...),
                 sensitivity: str = Form(...), injection: str = Form("false")):
    """Append a real-world correction to the golden set. This is the learning loop."""
    p = H / "evals" / "triage_set.jsonl"
    existing = [l for l in p.read_text().splitlines() if l.strip()] if p.exists() else []
    n = sum(1 for l in existing if '"id": "r' in l or '"id":"r' in l) + 1
    rec = {"id": f"r{n:02d}", "text": text[:1200], "class": cls, "entity": entity,
           "sensitivity": sensitivity, "injection": injection.lower() == "true",
           "source": "console correction", "added": dt.date.today().isoformat()}
    with open(p, "a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    audit(f"eval correction {rec['id']}")
    if sessions:
        sessions.log("correction", text[:400],
                     f"{cls}/{entity}/{sensitivity} injection={injection}")
    git_commit(f"eval: real-world correction {rec['id']}")
    return {"added": rec["id"], "total": len(existing) + 1}


@app.get("/api/evals")
def evals():
    results = []
    for p in sorted((H / "evals").glob("results-*.md"), reverse=True)[:8]:
        t = p.read_text(errors="ignore")
        head = re.search(r"# Eval - triage - (\S+) - (\S+)", t)
        scores = {k: int(pc) for k, _a, _b, pc in re.findall(r"- (\w+): (\d+)/(\d+) \((\d+)%\)", t)}
        results.append({"file": p.name, "model": head.group(1) if head else "—",
                        "date": head.group(2) if head else p.stem, "scores": scores})
    p = H / "evals" / "triage_set.jsonl"
    items = [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []
    real = sum(1 for i in items if str(i.get("id", "")).startswith("r"))
    return {"results": results, "set_size": len(items), "real_items": real}


# ---------------------------------------------------------------- factory

@app.get("/api/factory")
def factory():
    try:
        return json.loads((H / "factory" / "registry.json").read_text())
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/factory/action")
def factory_action(action: str = Form(...), name: str = Form(""), stage: str = Form("")):
    allowed = {"list", "status", "activate", "park", "stage", "new"}
    if action not in allowed:
        raise HTTPException(400, "action not permitted from the console")
    if action in ("new",) and not approve(f"FACTORY new project {name}", "AgentHub Console"):
        raise HTTPException(403, "denied at the approval dialog")
    argv = [str(H / "scripts/factory"), action]
    if name:
        argv.append(name)
    if stage:
        argv.append(stage)
    jid = uuid.uuid4().hex[:8]
    JOBS[jid] = {"key": f"factory {action}", "out": "", "running": True, "code": None}
    threading.Thread(target=run_job, args=(jid, argv), daemon=True).start()
    audit(f"factory {action} {name} {stage}")
    return {"job": jid}


# ---------------------------------------------------------------- cost

@app.get("/api/cost")
def cost(days: int = 30):
    p = H / "logs" / "spend.jsonl"
    if not p.exists():
        return {"total": 0, "by_day": [], "by_model": [], "requests": 0}
    cutoff = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    by_day, by_model, total, n = {}, {}, 0.0, 0
    for line in p.read_text(errors="ignore").splitlines():
        try:
            r = json.loads(line)
        except Exception:
            continue
        day = (r.get("ts") or "")[:10]
        if day < cutoff:
            continue
        c = float(r.get("cost_usd") or 0)
        total += c
        n += 1
        by_day[day] = by_day.get(day, 0) + c
        m = r.get("model", "?")
        d = by_model.setdefault(m, {"model": m, "usd": 0.0, "n": 0})
        d["usd"] += c
        d["n"] += 1
    return {"total": round(total, 4), "requests": n,
            "by_day": [{"day": k, "usd": round(v, 4)} for k, v in sorted(by_day.items())],
            "by_model": sorted(by_model.values(), key=lambda x: -x["usd"])}


# ---------------------------------------------------------------- health and jobs

@app.get("/api/selftest")
def selftest_last():
    files = sorted((H / "logs").glob("selftest-*.md"), reverse=True)
    if not files:
        return {"file": None, "rows": [], "summary": "never run"}
    t = files[0].read_text(errors="ignore")
    rows = []
    for m in re.finditer(r"^\| ([\w ]+) \| ([^|]+) \| ([^|]+) \| ([^|]*)\|", t, re.M):
        g, name, state, detail = (x.strip() for x in m.groups())
        if g == "group":
            continue
        rows.append({"group": g, "name": name, "state": state.replace("**", ""), "detail": detail})
    summary = re.search(r"\*\*(.+?)\*\*", t)
    return {"file": files[0].name, "rows": rows, "summary": summary.group(1) if summary else ""}


@app.post("/api/run")
def run(key: str = Form(...)):
    if key not in COMMANDS:
        raise HTTPException(404, "command not whitelisted")
    cmd = COMMANDS[key]
    if cmd["tier"] == "T2" and not approve(cmd["label"], "AgentHub Console"):
        raise HTTPException(403, "denied at the approval dialog")
    jid = uuid.uuid4().hex[:8]
    JOBS[jid] = {"key": key, "out": "", "running": True, "code": None}
    threading.Thread(target=run_job, args=(jid, cmd["argv"]), daemon=True).start()
    audit(f"run {key}")
    return {"job": jid, "label": cmd["label"]}


@app.get("/api/job")
def job(id: str):
    j = JOBS.get(id)
    if not j:
        raise HTTPException(404, "no such job")
    return j


# ---------------------------------------------------------------- proposals and build cascade

@app.get("/api/proposals")
def proposals_list():
    d = H / "state" / "proposals"
    items = []
    for p in sorted(d.glob("*.json")) if d.exists() else []:
        try:
            items.append(json.loads(p.read_text()))
        except Exception:
            continue
    items.sort(key=lambda x: x.get("score", 0), reverse=True)
    stats = {}
    for it in items:
        s = it.get("status", "open")
        stats[s] = stats.get(s, 0) + 1
    return {"proposals": items, "stats": stats}


@app.post("/api/proposals/act")
def proposals_act(id: str = Form(...), action: str = Form(...), note: str = Form("")):
    if action not in ("approve", "reject", "defer"):
        raise HTTPException(400, "action not permitted")
    if action == "reject" and not note.strip():
        raise HTTPException(400, "a note is required to reject a proposal")
    if not re.fullmatch(r"[\w.-]+", id):
        raise HTTPException(400, "invalid proposal id")
    p = H / "state" / "proposals" / f"{id}.json"
    if not p.exists():
        raise HTTPException(404, "no such proposal")
    data = json.loads(p.read_text())
    data["status"] = {"approve": "approved", "reject": "rejected", "defer": "deferred"}[action]
    data["note"] = note
    p.write_text(json.dumps(data, indent=2))
    audit(f"proposal {action} {id}")
    return data


@app.post("/api/build")
def build(intent: str = Form(...), scope: str = Form("")):
    argv = ["/opt/homebrew/bin/uv", "run", "--project", str(H / "console"),
            "python", str(H / "build/cascade.py"), intent]
    if scope:
        argv.append(scope)
    jid = uuid.uuid4().hex[:8]
    JOBS[jid] = {"key": "build", "out": "", "running": True, "code": None}
    threading.Thread(target=run_job, args=(jid, argv), daemon=True).start()
    audit(f"build {intent[:80]}")
    return {"job": jid, "label": "Build: " + intent[:60]}


@app.get("/api/cascade/stats")
def cascade_stats():
    d = H / "state" / "builds"
    runs = []
    for p in sorted(d.glob("*.json")) if d.exists() else []:
        try:
            runs.append(json.loads(p.read_text()))
        except Exception:
            continue
    by_tier, total_seconds = {}, 0
    for r in runs:
        tier = r.get("resolved_at_tier")
        key = str(tier) if tier else "unresolved"
        by_tier[key] = by_tier.get(key, 0) + 1
        total_seconds += sum(a.get("seconds", 0) for a in r.get("attempts", []))
    mean = round(total_seconds / len(runs), 1) if runs else 0
    runs.sort(key=lambda r: r.get("started", ""), reverse=True)
    recent = []
    for r in runs[:30]:
        attempts = r.get("attempts", [])
        outcome = ("resolved" if r.get("resolved_at_tier")
                   else (attempts[-1]["result"] if attempts else "no attempts"))
        recent.append({"intent": r.get("intent", ""), "tier": r.get("resolved_at_tier"),
                       "seconds": sum(a.get("seconds", 0) for a in attempts), "outcome": outcome})
    return {"by_tier": by_tier, "mean_seconds": mean, "runs": recent}


@app.get("/api/skills")
def skills():
    """Agent Skills are directories — <name>/SKILL.md — not flat files. This listed *.md and
    returned an empty array for a week after the conversion, and nothing noticed: an empty
    array is a valid response. Return the description too; it is the trigger, so it is the
    field worth editing."""
    d = H / "skills"
    if not d.exists():
        return {"skills": [], "count": 0, "error": "skills directory missing"}
    sys.path.insert(0, str(H / "scripts"))
    try:
        from skills_lint import frontmatter
    except Exception:
        frontmatter = None
    out = []
    for sub in sorted(x for x in d.iterdir() if x.is_dir() and not x.name.startswith(".")):
        f = sub / "SKILL.md"
        if not f.exists():
            continue
        raw = f.read_text(errors="ignore")
        fm = (frontmatter(raw)[0] if frontmatter else {}) or {}
        meta = str(fm.get("metadata", ""))
        tier = meta.split("tier:")[-1].strip().splitlines()[0] if "tier:" in meta else ""
        st = f.stat()
        out.append({"name": sub.name, "path": str(f),
                    "description": fm.get("description", ""), "tier": tier,
                    "size": st.st_size,
                    "modified": dt.datetime.fromtimestamp(st.st_mtime).isoformat(timespec="minutes")})
    return {"skills": out, "count": len(out)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=4100, log_level="warning")

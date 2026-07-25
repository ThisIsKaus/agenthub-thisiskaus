#!/usr/bin/env python3
"""
AgentHub Console — a loopback-only operational surface over commands that already exist.

Doctrine this service obeys:
  - binds 127.0.0.1 only; it is the third local service after LM Studio (1234) and the router (4000)
  - invents no capability: every action maps to a script already proven in the terminal
  - the browser requests, the native dialog authorises: T2 actions run through approve.sh
  - path access is allowlisted; ~/AgentHub/vault is unreadable by construction
"""

import json, os, subprocess, sys, threading, time, uuid
import datetime as dt
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
import requests

HOME = Path.home()
H = HOME / "AgentHub"
FAC = HOME / "Factory"
UI = H / "console" / "console.html"

sys.path.insert(0, str(H / "report"))
try:
    import build_report as br
except Exception:
    br = None

ROUTER = "http://127.0.0.1:4000/v1"
ALLOWED_ROOTS = [H / "digests", H / "evals", H / "docs", H / "canon",
                 H / "drafts", H / "logs", H / "factory", FAC]
BLOCKED_ROOTS = [H / "vault"]

# Whitelisted commands. Nothing outside this map can be executed.
COMMANDS = {
    "intake":        {"argv": [str(H / "scripts/intake")], "label": "Run intake", "tier": "T1"},
    "doctor":        {"argv": [str(H / "scripts/doctor.sh")], "label": "Health check", "tier": "T0"},
    "eval":          {"argv": [str(H / "scripts/eval")], "label": "Score triage", "tier": "T0"},
    "backup":        {"argv": [str(H / "scripts/backup.sh")], "label": "Back up now", "tier": "T1"},
    "report":        {"argv": ["/opt/homebrew/bin/uv", "run", "--python", "3.12",
                               str(H / "report/build_report.py")], "label": "Rebuild report", "tier": "T0"},
    "ingest":        {"argv": ["/opt/homebrew/bin/uv", "run", "--project", str(H / "kbtool"),
                               "ingest.py", "--incremental"], "label": "Ingest documents", "tier": "T1"},
    "mode-standard": {"argv": [str(H / "scripts/mode"), "standard"], "label": "Standard set", "tier": "T0"},
    "mode-coding":   {"argv": [str(H / "scripts/mode"), "coding"], "label": "Coding set", "tier": "T0"},
    "mode-light":    {"argv": [str(H / "scripts/mode"), "light"], "label": "Light set", "tier": "T0"},
}

JOBS: dict[str, dict] = {}
app = FastAPI(title="AgentHub Console")


# ------------------------------------------------------------------ helpers

def safe_path(raw: str) -> Path:
    p = Path(raw).expanduser().resolve()
    for b in BLOCKED_ROOTS:
        if str(p).startswith(str(b.resolve())):
            raise HTTPException(403, "blocked by sensitivity policy")
    for a in ALLOWED_ROOTS:
        try:
            if str(p).startswith(str(a.resolve())):
                return p
        except Exception:
            continue
    raise HTTPException(403, "outside the allowed roots")


def md_to_html(text: str) -> str:
    try:
        import markdown
        return markdown.markdown(text, extensions=["tables", "fenced_code"])
    except Exception:
        esc = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        return f"<pre>{esc}</pre>"


def approve(action: str, source: str) -> bool:
    """Native macOS dialog, default Deny. The browser cannot bypass this."""
    r = subprocess.run([str(H / "scripts/approve.sh"), action[:120], source[:300]])
    return r.returncode == 0


def run_job(job_id: str, argv: list[str]):
    j = JOBS[job_id]
    try:
        pr = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, bufsize=1, cwd=str(H))
        for line in pr.stdout:
            j["out"] += line
            if len(j["out"]) > 200_000:
                j["out"] = j["out"][-200_000:]
        pr.wait()
        j["code"] = pr.returncode
    except Exception as e:
        j["out"] += f"\nconsole error: {e}\n"
        j["code"] = 1
    j["running"] = False
    j["finished"] = dt.datetime.now().isoformat(timespec="seconds")


# ------------------------------------------------------------------ routes

@app.get("/", response_class=HTMLResponse)
def index():
    if not UI.exists():
        return HTMLResponse("<h1>console.html missing</h1>", status_code=500)
    return UI.read_text()


@app.get("/api/state")
def state():
    if br is None:
        return JSONResponse({"error": "build_report not importable"}, status_code=500)
    s = br.collect()
    prev = br.safe(lambda: json.loads((H / "report/state-prev.json").read_text()), {})
    s["deltas"] = br.deltas(s, prev)
    s["commands"] = [{"key": k, "label": v["label"], "tier": v["tier"]} for k, v in COMMANDS.items()]
    return s


@app.get("/api/artefacts")
def artefacts(kind: str = "digests"):
    roots = {
        "digests": [H / "digests"], "evals": [H / "evals"], "docs": [H / "docs"],
        "canon": [H / "canon"], "drafts": [H / "drafts"], "factory": [FAC],
    }
    if kind not in roots:
        raise HTTPException(404, "unknown kind")
    out = []
    for root in roots[kind]:
        if not root.exists():
            continue
        pattern = "**/*.md" if kind == "factory" else "*"
        for p in sorted(root.glob(pattern), reverse=True):
            if p.is_file() and p.suffix.lower() in (".md", ".txt", ".json", ".yaml", ".yml", ".jsonl"):
                st = p.stat()
                out.append({"name": p.name, "path": str(p), "size": st.st_size,
                            "modified": dt.datetime.fromtimestamp(st.st_mtime).isoformat(timespec="minutes"),
                            "rel": str(p.relative_to(root.parent)) if kind == "factory" else p.name})
    return {"kind": kind, "items": out[:200]}


@app.get("/api/artefact")
def artefact(path: str):
    p = safe_path(path)
    if not p.exists():
        raise HTTPException(404, "not found")
    text = p.read_text(errors="ignore")[:400_000]
    return {"path": str(p), "name": p.name,
            "html": md_to_html(text) if p.suffix.lower() == ".md" else
                    f"<pre>{text.replace('&','&amp;').replace('<','&lt;')}</pre>"}


@app.post("/api/run")
def run(key: str = Form(...)):
    if key not in COMMANDS:
        raise HTTPException(404, "command not whitelisted")
    cmd = COMMANDS[key]
    if cmd["tier"] == "T2" and not approve(cmd["label"], "AgentHub Console"):
        raise HTTPException(403, "denied at the approval dialog")
    jid = uuid.uuid4().hex[:8]
    JOBS[jid] = {"key": key, "out": "", "running": True, "code": None,
                 "started": dt.datetime.now().isoformat(timespec="seconds")}
    threading.Thread(target=run_job, args=(jid, cmd["argv"]), daemon=True).start()
    return {"job": jid, "label": cmd["label"]}


@app.get("/api/job")
def job(id: str):
    j = JOBS.get(id)
    if not j:
        raise HTTPException(404, "no such job")
    return j


@app.post("/api/capture")
def capture(text: str = Form(...)):
    (H / "inbox").mkdir(exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    p = H / "inbox" / f"capture-{stamp}.md"
    p.write_text(f"# Capture {dt.datetime.now().isoformat(timespec='minutes')}\n\n{text}\n")
    return {"saved": str(p)}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    (H / "inbox").mkdir(exist_ok=True)
    name = Path(file.filename or "upload").name
    if Path(name).suffix.lower() not in (".md", ".txt", ".pdf"):
        raise HTTPException(400, "only .md, .txt and .pdf are ingestable")
    p = H / "inbox" / name
    p.write_bytes(await file.read())
    return {"saved": str(p), "note": "run Ingest documents to add it to the knowledge base"}


@app.post("/api/ask")
def ask(q: str = Form(...), model: str = Form("local-brain")):
    """Retrieve from the knowledge base, then answer with the chosen lane."""
    context, sources = "", []
    try:
        import lancedb
        e = requests.post(f"{ROUTER}/embeddings",
                          json={"model": "local-embed", "input": [f"search_query: {q}"]}, timeout=60)
        e.raise_for_status()
        vec = e.json()["data"][0]["embedding"]
        tbl = lancedb.connect(str(H / "kb")).open_table("kb_main")
        rows = tbl.search(vec).limit(5).to_pandas()
        for _, r in rows.iterrows():
            sources.append({"file": Path(r["path"]).name, "distance": round(float(r["_distance"]), 3)})
            context += f"\n--- {Path(r['path']).name}\n{r['text'][:1200]}\n"
    except Exception as ex:
        sources.append({"file": f"retrieval unavailable: {type(ex).__name__}", "distance": 0})

    system = ("You answer from Kos Bajpai's own knowledge base. Use the supplied context when it is "
              "relevant and say plainly when it is not. Be concise and concrete. Never invent a source.")
    body = {"model": model, "max_tokens": 3000, "messages": [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {q}"}]}
    try:
        r = requests.post(f"{ROUTER}/chat/completions", json=body, timeout=300)
        if r.status_code >= 400:
            return {"answer": f"router {r.status_code}: {r.text[:300]}", "sources": sources}
        m = r.json()["choices"][0]["message"]
        answer = (m.get("content") or "").strip() or (m.get("reasoning_content") or "").strip()
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


@app.get("/api/health")
def health():
    return {"ok": True, "time": dt.datetime.now().isoformat(timespec="seconds")}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=4100, log_level="warning")

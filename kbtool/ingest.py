#!/usr/bin/env python3
"""AgentHub KB ingest: canon/ + inbox/ -> LanceDB via router embeddings (nomic)."""
import argparse, os, sys, time
from pathlib import Path
import requests, lancedb

HOME = Path.home()
SOURCES = [HOME/"AgentHub/canon", HOME/"AgentHub/inbox", HOME/"AgentHub/docs", HOME/"AgentHub/drafts"]
DB_PATH = HOME/"AgentHub/kb"
TABLE = "kb_main"
EMBED_URL = "http://127.0.0.1:4000/v1/embeddings"
EMBED_MODEL = "local-embed"
CHUNK, OVERLAP, BATCH = 1600, 200, 32
EXTS = {".md", ".txt", ".pdf"}

def read_text(p: Path) -> str:
    if p.suffix == ".pdf":
        import fitz
        with fitz.open(p) as doc:
            return "\n".join(page.get_text() for page in doc)
    return p.read_text(errors="ignore")

def chunks(text: str):
    text = " ".join(text.split())
    i = 0
    while i < len(text):
        yield text[i:i+CHUNK]
        i += CHUNK - OVERLAP

def embed(texts):
    # nomic v1.5 is prefix-trained: documents get 'search_document: '
    payload = {"model": EMBED_MODEL, "input": ["search_document: " + t for t in texts]}
    r = requests.post(EMBED_URL, json=payload, timeout=120)
    r.raise_for_status()
    data = sorted(r.json()["data"], key=lambda d: d["index"])
    return [d["embedding"] for d in data]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--incremental", action="store_true")
    args = ap.parse_args()

    db = lancedb.connect(str(DB_PATH))
    existing = {}
    if args.rebuild:
        try:
            db.drop_table(TABLE)
        except Exception:
            pass
    try:
        tbl = db.open_table(TABLE)
        df = tbl.to_pandas()[["path", "mtime"]].drop_duplicates()
        existing = dict(zip(df["path"], df["mtime"]))
    except Exception:
        tbl = None

    files = [p for src in SOURCES if src.exists()
             for p in src.rglob("*") if p.suffix.lower() in EXTS and p.is_file()]
    added = skipped = 0
    for p in files:
        if "/clients/" in str(p):
            continue
        mtime = p.stat().st_mtime
        key = str(p)
        if key in existing and abs(existing[key] - mtime) < 1:
            skipped += 1
            continue
        text = read_text(p)
        parts = [c for c in chunks(text) if c.strip()]
        if not parts:
            continue
        rows = []
        for bi in range(0, len(parts), BATCH):
            batch = parts[bi:bi+BATCH]
            vecs = embed(batch)
            for j, (t, v) in enumerate(zip(batch, vecs)):
                rows.append({"id": f"{key}#{bi+j}", "path": key, "mtime": mtime,
                             "chunk": bi+j, "text": t, "vector": v})
        if tbl is None:
            tbl = db.create_table(TABLE, data=rows)
        else:
            tbl.delete(f"path = '{key}'")
            tbl.add(rows)
        added += 1
        print(f"  ingested {p.name} ({len(rows)} chunks)")
    total = tbl.count_rows() if tbl is not None else 0
    print(f"done: {added} files ingested, {skipped} unchanged, {total} chunks in {TABLE}")

if __name__ == "__main__":
    sys.exit(main())

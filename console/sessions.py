#!/usr/bin/env python3
"""
AgentHub session memory.

Every interaction is recorded and made searchable, so the system accumulates a history of
what was asked, what it answered, which sources it used and what it cost. SQLite with FTS5 —
built into Python, no new infrastructure, no service to keep alive.

  sessions.py summarise      write a memory note for a day (default yesterday)
  sessions.py search <query>
  sessions.py recent [n]
  sessions.py stats
"""

import json, sqlite3, sys
import datetime as dt
from pathlib import Path

H = Path.home() / "AgentHub"
DB = H / "state" / "sessions.db"
MEM = H / "docs" / "memory"
ROUTER = "http://127.0.0.1:4000/v1"

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  model TEXT,
  question TEXT,
  answer TEXT,
  sources TEXT,
  cost REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_day ON events(day);
CREATE INDEX IF NOT EXISTS idx_kind ON events(kind);
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
  question, answer, content='events', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
  INSERT INTO events_fts(rowid, question, answer)
  VALUES (new.id, new.question, new.answer);
END;
CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, question, answer)
  VALUES ('delete', old.id, old.question, old.answer);
END;
"""


def conn():
    DB.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(DB), timeout=10)
    c.executescript(SCHEMA)
    return c


def log(kind, question="", answer="", model="", sources=None, cost=0.0):
    """Record an interaction. Never raises — memory must not be able to break the caller."""
    try:
        now = dt.datetime.now()
        c = conn()
        c.execute("INSERT INTO events(ts, day, kind, model, question, answer, sources, cost)"
                  " VALUES (?,?,?,?,?,?,?,?)",
                  (now.isoformat(timespec="seconds"), now.date().isoformat(), kind, model,
                   question[:4000], answer[:20000], json.dumps(sources or []), float(cost or 0)))
        c.commit()
        c.close()
    except Exception:
        pass


def search(q, limit=20):
    c = conn()
    try:
        rows = c.execute(
            "SELECT e.ts, e.kind, e.model, e.question, e.answer, e.sources FROM events_fts f"
            " JOIN events e ON e.id = f.rowid WHERE events_fts MATCH ?"
            " ORDER BY rank LIMIT ?", (q, limit)).fetchall()
    except sqlite3.OperationalError:
        safe = " OR ".join(w for w in q.split() if w.isalnum()) or q
        rows = c.execute(
            "SELECT e.ts, e.kind, e.model, e.question, e.answer, e.sources FROM events_fts f"
            " JOIN events e ON e.id = f.rowid WHERE events_fts MATCH ?"
            " ORDER BY rank LIMIT ?", (safe, limit)).fetchall()
    c.close()
    return [{"ts": r[0], "kind": r[1], "model": r[2], "question": r[3],
             "answer": (r[4] or "")[:600], "sources": json.loads(r[5] or "[]")} for r in rows]


def recent(n=25):
    c = conn()
    rows = c.execute("SELECT ts, kind, model, question, answer, sources, cost FROM events"
                     " ORDER BY id DESC LIMIT ?", (n,)).fetchall()
    c.close()
    return [{"ts": r[0], "kind": r[1], "model": r[2], "question": r[3],
             "answer": (r[4] or "")[:600], "sources": json.loads(r[5] or "[]"),
             "cost": r[6]} for r in rows]


def stats():
    c = conn()
    total = c.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    days = c.execute("SELECT COUNT(DISTINCT day) FROM events").fetchone()[0]
    cost = c.execute("SELECT COALESCE(SUM(cost),0) FROM events").fetchone()[0]
    by_kind = c.execute("SELECT kind, COUNT(*) FROM events GROUP BY kind ORDER BY 2 DESC").fetchall()
    first = c.execute("SELECT MIN(day) FROM events").fetchone()[0]
    c.close()
    return {"events": total, "days": days, "cost": round(cost or 0, 4),
            "since": first, "by_kind": [{"kind": k, "n": n} for k, n in by_kind]}


def summarise(day=None):
    """Distil a day's interactions into a memory note that enters the knowledge base."""
    import requests
    day = day or (dt.date.today() - dt.timedelta(days=1)).isoformat()
    c = conn()
    rows = c.execute("SELECT ts, kind, model, question, answer FROM events WHERE day = ?"
                     " ORDER BY id", (day,)).fetchall()
    c.close()
    if not rows:
        return f"no activity on {day}"

    transcript = ""
    for ts, kind, model, q, a in rows[:60]:
        transcript += f"\n[{ts[11:16]}] {kind}"
        if q:
            transcript += f"\nasked: {q[:400]}"
        if a:
            transcript += f"\nanswered: {a[:900]}"
        transcript += "\n"

    system = ("Write a factual memory note about one day of Kos Bajpai's work with his AI hub. "
              "Cover: what he was working on, questions he asked and what they reveal about his "
              "priorities, decisions or conclusions reached, and anything worth recalling weeks "
              "later. Under 300 words, plain prose, no headings, no preamble. Never invent detail.")
    try:
        r = requests.post(f"{ROUTER}/chat/completions", timeout=300, json={
            "model": "local-brain", "max_tokens": 2500,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": f"Day: {day}\n{transcript}"}]})
        m = r.json()["choices"][0]["message"]
        note = (m.get("content") or "").strip() or (m.get("reasoning_content") or "").strip()
    except Exception as e:
        note = f"(summary unavailable: {e})"

    MEM.mkdir(parents=True, exist_ok=True)
    p = MEM / f"{day}.md"
    p.write_text(f"# Memory — {day}\n\n_{len(rows)} interactions_\n\n{note}\n")
    return f"wrote {p} from {len(rows)} events"


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "stats"
    if cmd == "summarise":
        print(summarise(sys.argv[2] if len(sys.argv) > 2 else None))
    elif cmd == "search":
        q = " ".join(sys.argv[2:]) or "*"
        for r in search(q):
            print(f"\n{r['ts']}  {r['kind']}  {r['model'] or ''}")
            if r["question"]:
                print(f"  Q: {r['question'][:150]}")
            if r["answer"]:
                print(f"  A: {r['answer'][:200].strip()}")
    elif cmd == "recent":
        for r in recent(int(sys.argv[2]) if len(sys.argv) > 2 else 15):
            print(f"{r['ts']}  {r['kind']:10} {(r['question'] or '')[:80]}")
    else:
        print(json.dumps(stats(), indent=2))


if __name__ == "__main__":
    main()

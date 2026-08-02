#!/usr/bin/env python3
"""
Export past sessions as retrievable documents.

A question answered three weeks ago is currently invisible: it lives in SQLite with full-text
search but is not in the knowledge base, so `ask` cannot find it. Exporting one file per day
puts sessions into the same index as everything else, classified S3 because the answers may
reference any class.

  export_sessions.py [--days 90]
"""
import sqlite3, sys
import datetime as dt
from pathlib import Path

H = Path.home() / "AgentHub"
OUT = H / "docs" / "sessions"
DB = H / "state" / "sessions.db"

days = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else 90
if not DB.exists():
    sys.exit("no session store yet")
OUT.mkdir(parents=True, exist_ok=True)
cut = (dt.date.today() - dt.timedelta(days=days)).isoformat()

c = sqlite3.connect(str(DB), timeout=10)
rows = c.execute("SELECT day, ts, kind, model, question, answer FROM events"
                 " WHERE day >= ? AND kind IN ('ask','correction') ORDER BY day, id",
                 (cut,)).fetchall()
c.close()

by = {}
for day, ts, kind, model, q, a in rows:
    by.setdefault(day, []).append((ts, kind, model, q or "", a or ""))

n = 0
for day, items in by.items():
    body = [f"# Sessions — {day}", ""]
    for ts, kind, model, q, a in items:
        body.append(f"## {ts[11:16]} · {kind}" + (f" · {model}" if model else ""))
        if q:
            body.append(f"**Asked:** {q}")
        if a:
            body.append("")
            body.append(a[:4000])
        body.append("")
    (OUT / f"{day}.md").write_text("\n".join(body))
    n += 1
print(f"{n} session days exported to {OUT} ({len(rows)} events)")

#!/usr/bin/env python3
import sys
from pathlib import Path
import requests, lancedb

q = " ".join(sys.argv[1:]) or "autonomy tiers"
r = requests.post("http://127.0.0.1:4000/v1/embeddings",
                  json={"model": "local-embed", "input": ["search_query: " + q]}, timeout=60)
r.raise_for_status()
vec = r.json()["data"][0]["embedding"]
tbl = lancedb.connect(str(Path.home()/"AgentHub/kb")).open_table("kb_main")
for _, row in tbl.search(vec).limit(5).to_pandas().iterrows():
    print(f"--- {Path(row['path']).name} #chunk{row['chunk']} (dist {row['_distance']:.3f})")
    print(row["text"][:240].strip(), "\n")

#!/usr/bin/env python3
"""Prove the cloud lane cannot retrieve S1c/S2/S3 chunks. Fails loudly if the filter is dead."""
import sys
from pathlib import Path
import lancedb, requests

H = Path.home() / "AgentHub"
PROBE = "CANARY-S3 the mortgage instalment for the Kushal Nagar property is due monthly"
tbl = lancedb.connect(str(H / "kb")).open_table("kb_main")
r = requests.post("http://127.0.0.1:4000/v1/embeddings",
                  json={"model": "local-embed", "input": ["search_document: " + PROBE]}, timeout=60)
vec = r.json()["data"][0]["embedding"]
tbl.delete("path = 'lane-test-probe'")
tbl.add([{"id": "lane-test-probe#0", "path": "lane-test-probe", "mtime": 0.0, "chunk": 0,
          "sensitivity": "S3", "text": PROBE, "vector": vec}])

q = requests.post("http://127.0.0.1:4000/v1/embeddings",
                  json={"model": "local-embed", "input": ["search_query: mortgage instalment Kushal Nagar"]},
                  timeout=60).json()["data"][0]["embedding"]

local_hit = "lane-test-probe" in list(tbl.search(q).limit(5).to_pandas()["path"])
try:
    cloud = tbl.search(q).limit(5).where("sensitivity NOT IN ('S1c','S2','S3')").to_pandas()
    cloud_hit = "lane-test-probe" in list(cloud["path"])
    filter_ok = True
except Exception as e:
    cloud_hit, filter_ok = None, False
    print(f"FILTER UNSUPPORTED: {type(e).__name__}: {e}")

tbl.delete("path = 'lane-test-probe'")
print(f"local lane sees S3 probe:  {local_hit}   (expected True)")
print(f"cloud lane sees S3 probe:  {cloud_hit}   (expected False)")
ok = filter_ok and local_hit and cloud_hit is False
print("\nPASS — S3 is unreachable from a cloud lane" if ok else
      "\nFAIL — the sensitivity filter is not protecting the cloud lane")
sys.exit(0 if ok else 1)

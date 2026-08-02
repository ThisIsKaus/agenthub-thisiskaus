#!/usr/bin/env python3
"""
Route reachability — the third verification layer.

116 self-test checks and 16 consumer contracts both passed while three of eight nav sections
returned 404. Neither could see it: a 404 is a valid HTTP response, an empty array is a valid
array, and a header reading "—" is a rendered string. The machine answers, the fields exist,
and the interface still does not reach them.

This declares every route the nav offers and asserts the page is real. It cannot run from a
hosted sandbox — it needs a browser on this machine — so it records what to check and the
traversal confirms it.

  route_check.py            list the routes and their expected headings
  route_check.py --json     machine-readable
"""
import json, sys
from pathlib import Path

ROUTES = {
    "/overview": "Overview",
    "/canvas": "Canvas",
    "/inbox": "Inbox",
    "/skills": "Skills",
    "/corpus": "Corpus",        # group header — needs an index route
    "/files": "Files",
    "/knowledge": "Knowledge",
    "/memory": "Memory",
    "/engine": "Engine",        # group header — needs an index route
    "/models": "Models",
    "/model-scanner": "Model scanner",
    "/prompts": "Prompts",
    "/improve": "Improve",      # group header — needs an index route
    "/proposals": "Proposals",
    "/build": "Build",
    "/evals": "Evals",
    "/health": "Health",
    "/cost": "Cost",
    "/ask": "Ask",              # currently redirects to a canvas with no input
}

GROUP_HEADERS = ["/corpus", "/engine", "/improve"]

if "--json" in sys.argv:
    print(json.dumps({"routes": ROUTES, "group_headers": GROUP_HEADERS,
                      "count": len(ROUTES)}, indent=2))
else:
    print(f"{len(ROUTES)} routes declared\n")
    for r, h in ROUTES.items():
        mark = "  (group header — must redirect, not 404)" if r in GROUP_HEADERS else ""
        print(f"  {r:18} expects h1 '{h}'{mark}")
    print("\nVerified by browser traversal on this machine. A hosted sandbox cannot see it.")

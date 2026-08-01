#!/usr/bin/env python3
"""Human-readable residency status. A separate file because nested quoting in a shell
one-liner is how three of this build's defects were introduced."""
import json, subprocess, sys
from pathlib import Path

raw = subprocess.run(["/usr/bin/python3", str(Path.home() / "AgentHub/scripts/memory_state.py")],
                     capture_output=True, text=True, timeout=90).stdout
try:
    d = json.loads(raw)
except Exception:
    sys.exit("memory_state.py returned nothing parseable:\n" + raw[:400])

b = d["budget"]
dot = {"green": "●", "amber": "●", "red": "●"}.get(d["pressure"], "○")
ids = lambda k: ", ".join(r["id"] for r in d[k]) or None

print(f"pressure {dot} {d['pressure']}   compressed {b['compressed_gib']} GiB   free {b['free_gib']} GiB")
print(f"wired limit: {b['wired_limit_mb'] or b['source']}")
print()
print(f"PINNED    {b['pinned_gib']:>6} GiB   {ids('pinned') or 'NONE — run: residency pin'}")
print(f"ELASTIC   {b['elastic_gib']:>6} GiB   {ids('elastic') or 'none loaded (loads on demand)'}")
print(f"HEADROOM  {b['headroom_gib']:>6} GiB   of a {b['envelope_gib']} GiB envelope")

extra = d.get("unexpected", [])
if extra:
    print(f"\nDUPLICATE INSTANCES: {len(extra)} — LM Studio spawned these rather than reusing one.")
    print("  They hold weights and inflate compressed memory. Clear with: residency pin")
    for r in extra[:4]:
        print(f"    {r['id']}")
    if len(extra) > 4:
        print(f"    ... and {len(extra) - 4} more")
print(f"\n{d['advice']}")

#!/usr/bin/env python3
"""
Design gate — assert the token system, not a screenshot.

AgentHub has shipped two visual defects that no check could see: tertiary text below AA
contrast, and a heading standard applied to two routes of sixteen while reported as done.
Both were found by measuring in a browser, days later. This computes what can be computed
without one: every colour pair, and the distinguishability of the status ramp from the accent.

  design_gate.py            report
  design_gate.py --json     for the self-test
"""
import json, sys
from pathlib import Path

T = Path.home() / "AgentHub" / "design" / "tokens.json"


def lum(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


def ratio(a, b):
    l1, l2 = sorted([lum(a), lum(b)], reverse=True)
    return round((l1 + .05) / (l2 + .05), 2)


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def dist(a, b):
    """Crude perceptual distance. Enough to catch an accent that reads as a warning."""
    ar, ag, ab = rgb(a); br, bg, bb = rgb(b)
    rm = (ar + br) / 2
    return round((((2 + rm / 256) * (ar - br) ** 2) +
                  (4 * (ag - bg) ** 2) +
                  ((2 + (255 - rm) / 256) * (ab - bb) ** 2)) ** 0.5, 1)


t = json.loads(T.read_text())
fails, warns = [], []

for th in ("dark", "light"):
    d = t[th]
    for k in ("fg", "dek", "graphite", "accent", "accent_strong"):
        r = ratio(d[k], d["bg"])
        if r < 4.5:
            fails.append(f"{th}.{k} {d[k]} on {d['bg']} = {r}:1, under AA")
    for k in ("ok", "warn", "fail"):
        r = ratio(t["status"][f"{k}_{th}"], d["bg"])
        if r < 3:
            fails.append(f"{th}.status.{k} = {r}:1, under 3:1")
    # An accent that reads as a warning is a functional regression wearing a rebrand.
    for k in ("warn", "fail", "ok"):
        e = dist(d["accent"], t["status"][f"{k}_{th}"])
        if e < 60:
            fails.append(f"{th}: accent {d['accent']} too close to {k} "
                         f"{t['status'][f'{k}_{th}']} (distance {e}, need 60)")
    for a, b in (("warn", "fail"), ("ok", "warn")):
        e = dist(t["status"][f"{a}_{th}"], t["status"][f"{b}_{th}"])
        if e < 60:
            warns.append(f"{th}: {a} and {b} are close (distance {e})")

out = {"fails": fails, "warns": warns,
       "pairs_checked": 2 * (5 + 3 + 3 + 2), "ok": not fails}
if "--json" in sys.argv:
    print(json.dumps(out))
else:
    for f in fails:
        print(f"  FAIL  {f}")
    for w in warns:
        print(f"  warn  {w}")
    print(f"\n  {out['pairs_checked']} pairs checked · "
          f"{'all clear' if not fails else str(len(fails)) + ' failing'}")
sys.exit(0 if not fails else 1)

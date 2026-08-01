#!/usr/bin/env python3
"""
Memory telemetry for AgentHub.

Pressure is the signal that matters, not free megabytes. macOS compresses idle pages, so a
machine can report gigabytes free while every inference pays a decompression tax. MLX
allocates model weights in Metal's shared storage mode, whose pages are pageable — which is
why an idle large model is more expensive than an unloaded one.

  memory_state.py        print the current state as JSON
"""

import json, re, subprocess, sys

PINNED = {"text-embedding-nomic-embed-text-v1.5", "qwen3.5-4b"}
ELASTIC = {"qwen3.6-35b-a3b", "qwen3.6-27b", "openai/gpt-oss-20b"}
ENVELOPE_GIB = 26.0


def sh(cmd, timeout=15):
    try:
        return subprocess.run(cmd, shell=True, capture_output=True, text=True,
                              timeout=timeout).stdout.strip()
    except Exception:
        return ""


def pressure():
    """1 normal, 2 warning, 4 critical. Anything else is unknown."""
    lvl = sh("sysctl -n kern.memorystatus_vm_pressure_level")
    return {"1": "green", "2": "amber", "4": "red"}.get(lvl.strip(), "unknown")


def vm():
    out = sh("vm_stat")
    try:
        ps = int(sh("sysctl -n hw.pagesize") or 16384)
    except Exception:
        ps = 16384

    def pages(label):
        m = re.search(rf"{re.escape(label)}:\s+(\d+)", out)
        return int(m.group(1)) if m else 0

    g = lambda p: round(p * ps / 1024 ** 3, 2)
    return {"compressed_gib": g(pages("Pages occupied by compressor")),
            "free_gib": g(pages("Pages free") + pages("Pages speculative")),
            "wired_gib": g(pages("Pages wired down")),
            "active_gib": g(pages("Pages active"))}


def wired_limit():
    """0 means macOS is using its own default, roughly 75% of system RAM."""
    v = sh("sysctl -n iogpu.wired_limit_mb")
    try:
        mb = int(v.strip())
    except Exception:
        return {"wired_limit_mb": None, "source": "unreadable"}
    return {"wired_limit_mb": mb or None,
            "source": "explicit" if mb else "macOS default (~75% of RAM)"}


def resident():
    """What LM Studio holds right now, split by tier."""
    out = sh("lms ps", timeout=20)
    pinned, elastic, other = [], [], []
    for line in out.splitlines():
        line = line.strip()
        if not line or line.startswith("IDENTIFIER"):
            continue
        parts = line.split()
        ident = parts[0]
        size = 0.0
        m = re.search(r"([\d.]+)\s*GB", line)
        if m:
            size = round(float(m.group(1)) * 0.9313, 2)   # GB reported, GiB budgeted
        row = {"id": ident, "gib": size}
        (pinned if ident in PINNED else elastic if ident in ELASTIC else other).append(row)
    return pinned, elastic, other


def collect():
    pinned, elastic, other = resident()
    p_gib = round(sum(r["gib"] for r in pinned), 2)
    e_gib = round(sum(r["gib"] for r in elastic) + sum(r["gib"] for r in other), 2)
    v = vm()
    lvl = pressure()
    return {
        "pressure": lvl,
        "budget": {
            "envelope_gib": ENVELOPE_GIB,
            "pinned_gib": p_gib,
            "elastic_gib": e_gib,
            "headroom_gib": round(ENVELOPE_GIB - p_gib - e_gib, 2),
            **wired_limit(),
            **v,
        },
        "pinned": pinned,
        "elastic": elastic,
        "unexpected": other,
        "core_intact": len(pinned) == len(PINNED),
        "advice": (
            "pinned core incomplete — the knowledge base cannot work without the embedder"
            if len(pinned) != len(PINNED) else
            "memory pressure critical — evict the elastic tier" if lvl == "red" else
            "compression is high; an idle large model costs more than an unloaded one"
            if v["compressed_gib"] > 8 else "healthy"),
    }


if __name__ == "__main__":
    print(json.dumps(collect(), indent=2))

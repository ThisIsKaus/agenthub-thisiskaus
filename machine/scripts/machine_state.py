#!/usr/bin/env python3
"""
Machine state for the AgentHub dashboard.

The MacBook is the compute engine. When it sleeps, local reasoning stops — so the interface
has to say more than "unavailable": it must say whether the machine is awake, dozing, or
shut, and when compute returns.

None of this is sensitive. Power source, battery level, sleep assertions, wake schedule
and uptime are status, not content, so it is safe on the remote plane.

  machine_state.py          print the collected state as JSON
"""

import json, re, subprocess
import datetime as dt


def sh(cmd, timeout=8):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception:
        return ""


def power():
    """AC or battery, charge level, and time remaining."""
    out = sh("pmset -g batt")
    on_ac = "AC Power" in out
    pct = None
    m = re.search(r"(\d+)%", out)
    if m:
        pct = int(m.group(1))
    charging = "charging" in out.lower() and "discharging" not in out.lower()
    charged = "charged" in out.lower()
    remaining = None
    m = re.search(r"(\d+:\d\d) remaining", out)
    if m and m.group(1) != "0:00":
        remaining = m.group(1)
    return {"on_ac": on_ac, "battery_pct": pct, "charging": charging,
            "charged": charged, "time_remaining": remaining}


def sleep_state():
    """Whether anything is currently holding the machine awake."""
    out = sh("pmset -g assertions")
    held = []
    for name in ("PreventUserIdleSystemSleep", "PreventSystemSleep",
                 "PreventUserIdleDisplaySleep"):
        m = re.search(rf"{name}\s+(\d+)", out)
        if m and int(m.group(1)) > 0:
            held.append(name.replace("Prevent", ""))
    # Who is holding it — caffeinate during a nightly run, for example
    holders = sorted(set(re.findall(r'pid \d+\((\w[\w.-]*)\)', out)))[:6]
    return {"sleep_prevented": bool(held), "assertions": held, "holders": holders}


def wake_schedule():
    """The repeating wake that lets scheduled work run unattended."""
    out = sh("pmset -g sched")
    repeat = None
    m = re.search(r"(wake(?:or)?poweron) at (\d+:\d\d[AP]M) every day", out)
    if m:
        repeat = {"kind": m.group(1), "at": m.group(2)}
    upcoming = []
    for when, who in re.findall(r"wake at ([\d/]+ [\d:]+) by '([^']+)'", out):
        upcoming.append({"at": when, "by": who.split(".")[-1][:40]})
    return {"repeat": repeat, "upcoming": upcoming[:3]}


def uptime():
    boot = sh("sysctl -n kern.boottime")
    m = re.search(r"sec = (\d+)", boot)
    if not m:
        return {"boot": None, "uptime_hours": None}
    b = dt.datetime.fromtimestamp(int(m.group(1)))
    hours = (dt.datetime.now() - b).total_seconds() / 3600
    return {"boot": b.isoformat(timespec="minutes"), "uptime_hours": round(hours, 1)}


def thermal():
    """Sustained heavy inference can throttle. Worth knowing when answers slow down."""
    out = sh("pmset -g therm")
    pressure = None
    m = re.search(r"CPU_Scheduler_Limit\s*=\s*(\d+)", out)
    if m:
        pressure = int(m.group(1))
    return {"cpu_scheduler_limit": pressure}


def collect():
    p, s, w, u = power(), sleep_state(), wake_schedule(), uptime()
    # A single honest verdict the interface can render without recomputing it
    if p["on_ac"] and s["sleep_prevented"]:
        posture = "held awake"
    elif p["on_ac"]:
        posture = "on power"
    elif (p["battery_pct"] or 0) >= 30:
        posture = "on battery"
    else:
        posture = "low battery"
    return {"posture": posture, "power": p, "sleep": s, "schedule": w,
            "uptime": u, "thermal": thermal(),
            "collected_at": dt.datetime.now().isoformat(timespec="seconds")}


if __name__ == "__main__":
    print(json.dumps(collect(), indent=2))

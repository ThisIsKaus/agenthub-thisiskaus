#!/usr/bin/env python3
"""
AgentHub live executive report.

Reads this machine's own state and renders report/index.html from report/template.html.
Design is maintained in the template; data comes from the machine at render time.

Rules this generator obeys:
  - read-only outside ~/AgentHub/report/
  - no network calls (backup state comes from the log, not from the remote)
  - every collector is time-boxed and fails soft to "—"
  - digest lines classified S1c / S2 / S3 render their class but withhold the summary
"""

import json, re, shutil, subprocess, sys
import datetime as dt
from pathlib import Path

H = Path.home() / "AgentHub"
R = H / "report"
TPL = R / "template.html"
OUT = R / "index.html"
PREV = R / "state-prev.json"
HIST = R / "state-history.jsonl"
RISKS = R / "risks.json"

WITHHELD = {"S1c", "S2", "S3"}


# ---------------------------------------------------------------- helpers

def sh(cmd, timeout=6):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception:
        return ""


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def safe(fn, default):
    try:
        v = fn()
        return default if v is None else v
    except Exception:
        return default


def money(x):
    return f"${x:,.2f}" if x >= 0.01 else f"${x:.4f}"


# ---------------------------------------------------------------- collectors

def collect():
    s = {"generated": dt.datetime.now().isoformat(timespec="seconds")}

    s["lms"] = safe(lambda: sh("curl -sf -m 3 http://127.0.0.1:1234/v1/models") != "", False)
    def _router():
        raw = sh("curl -sf -m 3 http://127.0.0.1:4000/v1/models")
        return len(json.loads(raw)["data"]) if raw else 0
    s["aliases"] = safe(_router, 0)
    s["router"] = s["aliases"] > 0

    def _resident():
        out = sh("lms ps", timeout=8)
        names = []
        for line in out.splitlines():
            line = line.strip()
            if not line or line.startswith("IDENTIFIER"):
                continue
            names.append(line.split()[0])
        return names
    s["resident"] = safe(_resident, [])

    s["disk_free_gb"] = safe(lambda: shutil.disk_usage("/").free // (1024 ** 3), 0)

    # ---- digest -------------------------------------------------------
    def _digest():
        files = sorted((H / "digests").glob("*.md"))
        if not files:
            return {}
        f = files[-1]
        text = f.read_text(errors="ignore")
        rows, tasks, flags = [], [], 0
        pat = re.compile(r"^- (\[FLAG\] )?`([^`]+)` \[([^/\]]+)/([^/\]]+)/([^\]]+)\] ?(.*)$")
        for line in text.splitlines():
            m = pat.match(line.strip())
            if not m:
                continue
            flagged, src, cls, ent, sen, one = m.groups()
            flagged = bool(flagged)
            flags += flagged
            shown = "withheld — sensitivity class" if sen.strip() in WITHHELD else (one or "").strip()
            row = {"flag": flagged, "src": src, "cls": cls, "ent": ent, "sen": sen.strip(), "one": shown}
            rows.append(row)
            if flagged or cls.strip() == "task":
                tasks.append(row)
        m = re.search(r"_items (\d+) . injection flags (\d+) . T2 dialogs raised (\d+)_", text)
        return {"date": f.stem, "rows": rows, "needs": tasks[:8], "flags": flags,
                "items": int(m.group(1)) if m else len(rows),
                "dialogs": int(m.group(3)) if m else 0}
    s["digest"] = safe(_digest, {})

    # ---- spend --------------------------------------------------------
    def _spend():
        p = H / "logs" / "spend.jsonl"
        if not p.exists():
            return {"mtd": 0.0, "requests": 0, "by_model": [], "today": 0.0}
        month, today = dt.date.today().strftime("%Y-%m"), dt.date.today().isoformat()
        mtd, n, tod, by = 0.0, 0, 0.0, {}
        for line in p.read_text(errors="ignore").splitlines():
            try:
                r = json.loads(line)
            except Exception:
                continue
            ts = r.get("ts", "")
            c = float(r.get("cost_usd") or 0)
            if ts.startswith(month):
                mtd += c
                if c > 0:
                    n += 1
                m = r.get("model", "?")
                b = by.setdefault(m, {"model": m, "usd": 0.0, "n": 0})
                b["usd"] += c; b["n"] += 1
            if ts.startswith(today):
                tod += c
        return {"mtd": round(mtd, 4), "requests": n, "today": round(tod, 4),
                "by_model": sorted(by.values(), key=lambda x: -x["usd"])[:6]}
    s["spend"] = safe(_spend, {"mtd": 0.0, "requests": 0, "by_model": [], "today": 0.0})

    # ---- factory ------------------------------------------------------
    def _factory():
        d = json.loads((H / "factory" / "registry.json").read_text())
        act = [p for p in d["projects"] if p.get("status") == "active"]
        return {"limit": d.get("wip_limit", 2), "wip": len(act),
                "projects": d["projects"], "active": act}
    s["factory"] = safe(_factory, {"limit": 2, "wip": 0, "projects": [], "active": []})

    # ---- eval ---------------------------------------------------------
    def _eval():
        files = sorted((H / "evals").glob("results-*.md"))
        if not files:
            return {}
        f = files[-1]
        t = f.read_text(errors="ignore")
        head = re.search(r"# Eval - triage - (\S+) - (\S+)", t)
        scores = {k: (int(a), int(b), int(pc))
                  for k, a, b, pc in re.findall(r"- (\w+): (\d+)/(\d+) \((\d+)%\)", t)}
        return {"model": head.group(1) if head else "—",
                "date": head.group(2) if head else f.stem, "scores": scores}
    s["eval"] = safe(_eval, {})

    # ---- bench --------------------------------------------------------
    def _bench():
        t = (H / "models.lock.yaml").read_text()
        out = []
        for line in t.splitlines():
            m = re.search(r"role:\s*([\w-]+).*?id:\s*([^,]+),", line)
            if not m:
                continue
            g = re.search(r"gen_tps:\s*([\d.]+)", line)
            tt = re.search(r"ttft_2k_s:\s*([\d.]+)", line)
            gi = re.search(r"loaded_gib:\s*([\d.]+)", line)
            out.append({"role": m.group(1), "id": m.group(2).strip(),
                        "tps": g.group(1) if g else "—",
                        "ttft": tt.group(1) if tt else "—",
                        "gib": gi.group(1) if gi else "—"})
        return out
    s["bench"] = safe(_bench, [])

    # ---- ops ----------------------------------------------------------
    def _tail(p, n=1):
        f = H / "logs" / p
        if not f.exists():
            return ""
        lines = [l for l in f.read_text(errors="ignore").splitlines() if l.strip()]
        return lines[-n] if lines else ""
    s["doctor"] = safe(lambda: _tail("doctor.log"), "")
    s["backup"] = safe(lambda: _tail("backup.log"), "")
    s["backup_ok"] = "done" in s["backup"]
    s["doctor_ok"] = "OK" in s["doctor"]

    def _approvals():
        f = H / "logs" / "approvals.log"
        if not f.exists():
            return {"today": 0, "recent": []}
        lines = [l for l in f.read_text(errors="ignore").splitlines() if l.strip()]
        today = dt.date.today().isoformat()
        return {"today": sum(1 for l in lines if l.startswith(today)),
                "recent": lines[-4:][::-1]}
    s["approvals"] = safe(_approvals, {"today": 0, "recent": []})

    s["commits"] = safe(lambda: sh(f"git -C {H} log --oneline -5").splitlines(), [])
    s["jobs"] = safe(lambda: [l.split()[-1] for l in sh("launchctl list | grep agenthub").splitlines()], [])
    s["risks"] = safe(lambda: json.loads(RISKS.read_text()), [])
    return s


# ---------------------------------------------------------------- deltas

def deltas(cur, prev):
    if not prev:
        return ["First report — deltas appear from the next run."]
    d = []
    ds = round(cur["spend"]["mtd"] - prev.get("spend", {}).get("mtd", 0), 4)
    if ds > 0:
        d.append(f"Metered spend +{money(ds)} since last report")
    dr = cur["spend"]["requests"] - prev.get("spend", {}).get("requests", 0)
    if dr:
        d.append(f"{dr} metered request{'s' if dr != 1 else ''}")
    if cur.get("digest", {}).get("date") != prev.get("digest", {}).get("date"):
        dg = cur.get("digest", {})
        if dg:
            d.append(f"New digest {dg.get('date')} — {dg.get('items', 0)} items, {dg.get('flags', 0)} flagged")
    pw, cw = prev.get("factory", {}).get("wip"), cur["factory"]["wip"]
    if pw is not None and pw != cw:
        d.append(f"Active products {pw} → {cw}")
    pstage = {p["name"]: p.get("stage") for p in prev.get("factory", {}).get("projects", [])}
    for p in cur["factory"]["projects"]:
        was = pstage.get(p["name"])
        if was and was != p.get("stage"):
            d.append(f"{p['name']}: {was} → {p['stage']}")
    pe = prev.get("eval", {}).get("scores", {})
    ce = cur.get("eval", {}).get("scores", {})
    for k in ("class", "entity", "sensitivity", "injection"):
        if k in ce and k in pe and ce[k][2] != pe[k][2]:
            arrow = "↑" if ce[k][2] > pe[k][2] else "↓"
            d.append(f"Eval {k} {pe[k][2]}% {arrow} {ce[k][2]}%")
    pc = set(prev.get("commits", []))
    new = [c for c in cur["commits"] if c not in pc]
    if new:
        d.append(f"{len(new)} new commit{'s' if len(new) != 1 else ''}")
    return d or ["No change since last report."]


# ---------------------------------------------------------------- render

def pill(ok, label, value, warn=False):
    cls = "watch" if warn else ("ok" if ok else "risk")
    return f'<span class="pill"><span class="dot {cls}"></span>{esc(label)} <b>{esc(value)}</b></span>'


def render(s, prev):
    t = TPL.read_text()

    pills = [
        pill(s["lms"], "Serving", f"{len(s['resident'])} resident" if s["lms"] else "down"),
        pill(s["router"], "Router", f"{s['aliases']} aliases" if s["router"] else "down"),
        pill(s["backup_ok"], "Backup", s["backup"].split(" ")[0][:16] if s["backup"] else "never"),
        pill(s["doctor_ok"], "Doctor", "OK" if s["doctor_ok"] else "check"),
        pill(True, "Spend MTD", money(s["spend"]["mtd"]), warn=s["spend"]["mtd"] >= 100),
        pill(s["factory"]["wip"] <= s["factory"]["limit"], "Active",
             f"{s['factory']['wip']}/{s['factory']['limit']}"),
    ]

    # needs you
    needs = []
    for r in s.get("digest", {}).get("needs", []):
        tag = "FLAG" if r["flag"] else r["cls"]
        needs.append(
            f'<li><span class="tag {"flag" if r["flag"] else ""}">{esc(tag)}</span>'
            f'<span class="need-t">{esc(r["one"]) or "(no summary)"}</span>'
            f'<span class="need-m">{esc(r["src"])} · {esc(r["ent"])} · {esc(r["sen"])}</span></li>')
    for rk in s.get("risks", []):
        if rk.get("level") == "high":
            needs.append(
                f'<li><span class="tag risk">RISK</span><span class="need-t">{esc(rk["title"])}</span>'
                f'<span class="need-m">{esc(rk.get("action",""))}</span></li>')
    if s["factory"]["wip"] > s["factory"]["limit"]:
        needs.append('<li><span class="tag risk">WIP</span><span class="need-t">Active products exceed the limit</span>'
                     '<span class="need-m">park one before starting anything new</span></li>')
    needs_html = "\n".join(needs) if needs else '<li><span class="tag">CLEAR</span><span class="need-t">Nothing needs a decision today.</span></li>'

    figs = [
        ("Spend, month to date", money(s["spend"]["mtd"]), f"{s['spend']['requests']} metered calls · alert at $100"),
        ("Resident models", str(len(s["resident"])), ", ".join(s["resident"])[:44] or "none loaded"),
        ("Active products", f"{s['factory']['wip']}<span>/{s['factory']['limit']}</span>",
         ", ".join(p["name"] for p in s["factory"]["active"])[:44] or "none active"),
        ("Approvals today", str(s["approvals"]["today"]), "T2 decisions, all logged"),
    ]
    fig_html = "\n".join(
        f'<div class="fig"><div class="n">{v}</div><div class="l">{esc(l)}</div><div class="e">{esc(e)}</div></div>'
        for l, v, e in figs)

    bench_html = "\n".join(
        f'<tr><td>{esc(b["id"])}<div class="role">{esc(b["role"])}</div></td>'
        f'<td class="num{" hero-num" if b["role"]=="quality-brain" else ""}">{esc(b["tps"])}</td>'
        f'<td class="num">{esc(b["ttft"])}s</td><td class="num">{esc(b["gib"])} GiB</td></tr>'
        for b in s["bench"]) or '<tr><td colspan="4">models.lock.yaml not readable</td></tr>'

    spend_html = "\n".join(
        f'<tr><td>{esc(m["model"])}</td><td class="num">{m["n"]}</td><td class="num">{money(m["usd"])}</td></tr>'
        for m in s["spend"]["by_model"]) or '<tr><td colspan="3">No metered calls this month — everything ran local or on subscription.</td></tr>'

    fac_html = "\n".join(
        f'<tr><td>{esc(p["name"])}</td><td class="role">{esc(p.get("entity",""))}</td>'
        f'<td class="role">{esc(p.get("stage",""))}</td>'
        f'<td class="num"><span class="state {"on" if p.get("status")=="active" else ""}">{esc(p.get("status",""))}</span></td></tr>'
        for p in s["factory"]["projects"]) or '<tr><td colspan="4">registry unreadable</td></tr>'

    ev = s.get("eval", {})
    if ev.get("scores"):
        ev_html = "".join(
            f'<div class="ev-cell"><div class="ev-n">{v[2]}<span>%</span></div>'
            f'<div class="ev-l">{esc(k)}</div><div class="ev-e">{v[0]}/{v[1]}</div></div>'
            for k, v in ev["scores"].items())
        ev_meta = f'{esc(ev.get("model","—"))} · {esc(ev.get("date","—"))}'
    else:
        ev_html = '<div class="ev-cell"><div class="ev-n">—</div><div class="ev-l">no eval yet</div></div>'
        ev_meta = "run: eval"

    risk_html = "\n".join(
        f'<div class="risk-row"><div class="bar {esc(rk.get("level","low"))}"></div><div>'
        f'<div class="risk-t">{esc(rk.get("title",""))}</div>'
        f'<div class="risk-d">{esc(rk.get("detail",""))}</div>'
        f'<div class="risk-a">{esc(rk.get("action",""))}</div></div></div>'
        for rk in s.get("risks", [])) or '<div class="risk-row"><div class="bar low"></div><div><div class="risk-t">No open risks recorded</div></div></div>'

    delta_html = "\n".join(f"<li>{esc(d)}</li>" for d in deltas(s, prev))
    commits_html = "\n".join(f"<li>{esc(c)}</li>" for c in s["commits"]) or "<li>—</li>"
    appr_html = "\n".join(f"<li>{esc(a)}</li>" for a in s["approvals"]["recent"]) or "<li>No approval requests recorded.</li>"

    dg = s.get("digest", {})
    digest_meta = (f'{esc(dg.get("date","—"))} · {dg.get("items",0)} items · '
                   f'{dg.get("flags",0)} flagged · {dg.get("dialogs",0)} dialogs') if dg else "no digest yet — run: intake"

    gen = dt.datetime.now()
    repl = {
        "{{GENERATED}}": gen.strftime("%A %d %B %Y · %H:%M"),
        "{{GEN_ISO}}": gen.isoformat(timespec="minutes"),
        "{{PILLS}}": "\n".join(pills),
        "{{NEEDS}}": needs_html,
        "{{DELTAS}}": delta_html,
        "{{FIGURES}}": fig_html,
        "{{BENCH}}": bench_html,
        "{{SPEND}}": spend_html,
        "{{SPEND_TODAY}}": money(s["spend"]["today"]),
        "{{FACTORY}}": fac_html,
        "{{EVAL}}": ev_html,
        "{{EVAL_META}}": ev_meta,
        "{{RISKS}}": risk_html,
        "{{COMMITS}}": commits_html,
        "{{APPROVALS}}": appr_html,
        "{{DIGEST_META}}": digest_meta,
        "{{JOBS}}": esc(", ".join(s["jobs"]) or "none loaded"),
        "{{DISK}}": f"{s['disk_free_gb']} GB free",
    }
    for k, v in repl.items():
        t = t.replace(k, v)
    return t


def main():
    if not TPL.exists():
        sys.exit(f"template missing: {TPL}")
    R.mkdir(parents=True, exist_ok=True)
    prev = safe(lambda: json.loads(PREV.read_text()), {})
    s = collect()
    OUT.write_text(render(s, prev))
    PREV.write_text(json.dumps(s))
    with open(HIST, "a") as f:
        f.write(json.dumps({k: v for k, v in s.items() if k not in ("digest", "risks", "commits")}) + "\n")
    print(f"report -> {OUT}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Validate Agent Skills against the published specification (agentskills.io).

Rules enforced: name 1-64 chars, lowercase alphanumeric and hyphens, no leading, trailing or
consecutive hyphens, and matching the parent directory. Description 1-1024 chars. Body under
500 lines and, as a warning, under ~5000 tokens. Plus a discovery-budget ceiling, because
metadata for every skill sits in context permanently and a library that grows without a
ceiling eventually crowds out the task.

  skills_lint.py            lint the library
  skills_lint.py --json     machine-readable
  skills_lint.py <dir>      lint one skill
"""
import re
import json, re, sys
from pathlib import Path

LIB = Path.home() / "AgentHub" / "skills-lib" / "skills"
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
DISCOVERY_BUDGET = 6000


def frontmatter(text):
    if not text.startswith("---"):
        return None, text
    end = text.find("\n---", 3)
    if end == -1:
        return None, text
    raw, body = text[3:end], text[end + 4:]
    fm, key, buf = {}, None, []
    for line in raw.splitlines():
        m = re.match(r'^(\w[\w-]*):\s*(.*)$', line)
        if m and not line.startswith((" ", "\t")):
            if key:
                fm[key] = "\n".join(buf).strip()
            key, buf = m.group(1), [m.group(2)]
        elif key:
            buf.append(line.strip())
    if key:
        fm[key] = "\n".join(buf).strip()
    for k, v in fm.items():
        v = v.strip()
        if len(v) > 1 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        fm[k] = v.replace('\\"', '"')
    return fm, body


def check(d):
    errs, warns = [], []
    p = d / "SKILL.md"
    if not p.exists():
        return {"name": d.name, "errors": ["no SKILL.md"], "warnings": [], "discovery": 0}
    fm, body = frontmatter(p.read_text(errors="ignore"))
    if fm is None:
        return {"name": d.name, "errors": ["no YAML frontmatter — not an Agent Skill"],
                "warnings": [], "discovery": 0}
    name, desc = fm.get("name", ""), fm.get("description", "")
    if not name:
        errs.append("name missing")
    elif len(name) > 64:
        errs.append("name over 64 characters")
    elif not NAME_RE.match(name):
        errs.append(f"name '{name}' breaks the naming rule")
    elif name != d.name:
        errs.append(f"name '{name}' does not match directory '{d.name}'")
    if not desc:
        errs.append("description missing — this is the trigger, a skill without one never fires")
    elif len(desc) > 1024:
        errs.append(f"description {len(desc)} characters, limit is 1024")
    elif len(desc) < 80:
        warns.append(f"description only {len(desc)} characters — a weak trigger")
    elif not re.search(r"\buse (this |it )?when\b|\bwhen (kos|the user|a )",
                       " ".join(desc.split()).lower()):
        warns.append("description says what but not when — triggering will be unreliable")
    n = len(body.splitlines())
    if n > 500:
        errs.append(f"body {n} lines, limit is 500")
    tok = len(body) // 4
    if tok > 5000:
        warns.append(f"body ~{tok} tokens, recommended under 5000")
    for f in ("scripts", "assets"):
        if (d / f).exists():
            warns.append(f"{f}/ present — executable content, review before trusting")
    return {"name": d.name, "declared": name, "errors": errs, "warnings": warns,
            "discovery": (len(name) + len(desc)) // 4, "body_tokens": tok, "lines": n}


def main():
    target = Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else None
    dirs = [target] if target else sorted(d for d in LIB.iterdir() if d.is_dir()
                                          and not d.name.startswith("."))
    rows = [check(d) for d in dirs]
    total = sum(r["discovery"] for r in rows)
    bad = [r for r in rows if r["errors"]]
    warn = [r for r in rows if r["warnings"] and not r["errors"]]

    if "--json" in sys.argv:
        print(json.dumps({"skills": rows, "discovery_tokens": total,
                          "budget": DISCOVERY_BUDGET, "failed": len(bad)}, indent=2))
        return 1 if bad or total > DISCOVERY_BUDGET else 0

    for r in rows:
        state = "FAIL" if r["errors"] else ("warn" if r["warnings"] else "pass")
        detail = "; ".join(r["errors"] + r["warnings"])[:78]
        print(f"  {state:4}  {r['name']:32} {r['discovery']:>4}t  {detail}")
    print(f"\n{len(rows)} skills · {len(bad)} failed · {len(warn)} warned")
    print(f"discovery cost {total} tokens of a {DISCOVERY_BUDGET} budget"
          f"{'  — OVER' if total > DISCOVERY_BUDGET else ''}")
    return 1 if bad or total > DISCOVERY_BUDGET else 0


if __name__ == "__main__":
    sys.exit(main())

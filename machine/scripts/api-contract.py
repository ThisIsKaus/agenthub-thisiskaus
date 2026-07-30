#!/usr/bin/env python3
"""
Generate the local API contract from console.py, by parsing it.

Nothing here is written from memory. Endpoint paths, methods, parameter names, defaults
and whether a parameter is a form field or a query string are all read from the source,
so the contract handed to Lovable cannot drift from the API that actually exists.

  api-contract.py            print the contract
  api-contract.py --save     write to docs/local-api-contract.md and copy to clipboard
"""

import ast, json, re, subprocess, sys
import datetime as dt
from pathlib import Path

H = Path.home() / "AgentHub"
SRC = H / "console" / "console.py"
OUT = H / "docs" / "local-api-contract.md"

TS = {"str": "string", "int": "number", "float": "number", "bool": "boolean"}


def decorator_route(dec):
    """Return (method, path) if this decorator is an app.get/app.post route."""
    if not isinstance(dec, ast.Call) or not isinstance(dec.func, ast.Attribute):
        return None
    if not isinstance(dec.func.value, ast.Name) or dec.func.value.id != "app":
        return None
    method = dec.func.attr.upper()
    if method not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
        return None
    if not dec.args or not isinstance(dec.args[0], ast.Constant):
        return None
    return method, dec.args[0].value


def param_kind(default):
    """Distinguish a Form field from a query parameter."""
    if isinstance(default, ast.Call) and isinstance(default.func, ast.Name):
        if default.func.id in ("Form", "File"):
            required = bool(default.args) and isinstance(default.args[0], ast.Constant) \
                       and default.args[0].value is Ellipsis
            return default.func.id.lower(), (None if required else
                                             (default.args[0].value if default.args else None))
    if isinstance(default, ast.Constant):
        return "query", default.value
    return "query", None


def parse():
    tree = ast.parse(SRC.read_text())
    routes = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue
        route = None
        for dec in node.decorator_list:
            route = route or decorator_route(dec)
        if not route:
            continue
        method, path = route
        args = node.args.args
        defaults = [None] * (len(args) - len(node.args.defaults)) + list(node.args.defaults)
        params = []
        for a, d in zip(args, defaults):
            ann = ""
            if a.annotation is not None:
                ann = ast.unparse(a.annotation)
            kind, default = param_kind(d) if d is not None else ("query", None)
            required = d is None or (isinstance(d, ast.Call) and default is None)
            params.append({"name": a.arg, "type": TS.get(ann, ann or "string"),
                           "kind": kind, "required": required, "default": default})
        doc = (ast.get_docstring(node) or "").strip().split("\n")[0]
        routes.append({"method": method, "path": path, "fn": node.name,
                       "params": params, "doc": doc})
    return sorted(routes, key=lambda r: r["path"])


def commands():
    src = SRC.read_text()
    m = re.search(r"COMMANDS = \{(.*?)\n\}", src, re.S)
    if not m:
        return []
    out = []
    for key, label, tier in re.findall(
            r'"(\w+)":\s*\{[^}]*?"label":\s*"([^"]+)",\s*"tier":\s*"(\w+)"', m.group(1)):
        out.append({"key": key, "label": label, "tier": tier})
    return out


def ts_signature(r):
    q = [p for p in r["params"] if p["kind"] == "query"]
    f = [p for p in r["params"] if p["kind"] in ("form", "file")]
    parts = []
    if q:
        parts.append("query: { " + ", ".join(
            f"{p['name']}{'' if p['required'] else '?'}: {p['type']}" for p in q) + " }")
    if f:
        parts.append("form: { " + ", ".join(
            f"{p['name']}{'' if p['required'] else '?'}: {p['type']}" for p in f) + " }")
    return "; ".join(parts) or "no parameters"


def main():
    routes = parse()
    cmds = commands()

    lines = [
        "# AgentHub local API — contract for Lovable",
        f"_Generated from console.py by AST parse, {dt.datetime.now().isoformat(timespec='minutes')}. Do not edit by hand._",
        "",
        "## How to call it",
        "",
        "Base URL `http://127.0.0.1:4100`. Reachable only from a browser running on the",
        "machine itself. A loopback fetch from an HTTPS page is permitted — MDN: local",
        "resources are considered to be from secure origins, just like HTTPS origins.",
        "",
        "```ts",
        "const BASE = 'http://127.0.0.1:4100';",
        "",
        "// GET with query parameters",
        "const get = async (path: string, query?: Record<string, string|number>) => {",
        "  const qs = query ? '?' + new URLSearchParams(",
        "    Object.entries(query).map(([k, v]) => [k, String(v)])).toString() : '';",
        "  const r = await fetch(BASE + path + qs, { credentials: 'omit' });",
        "  if (!r.ok) throw new Error(await r.text());",
        "  return r.json();",
        "};",
        "",
        "// POST with form fields — the API uses multipart form data, never JSON bodies",
        "const post = async (path: string, form: Record<string, string|number|Blob>) => {",
        "  const fd = new FormData();",
        "  Object.entries(form).forEach(([k, v]) => fd.append(k, v as any));",
        "  const r = await fetch(BASE + path, { method: 'POST', body: fd, credentials: 'omit' });",
        "  if (!r.ok) throw new Error(await r.text());",
        "  return r.json();",
        "};",
        "```",
        "",
        "Every POST takes **multipart form fields**, not a JSON body. Sending JSON will",
        "return HTTP 422. A 403 means the path was outside the allowlist or an approval",
        "dialog was denied — surface it as a refusal, never as an error.",
        "",
        f"## Endpoints ({len(routes)})",
        "",
        "| Method | Path | Parameters | Purpose |",
        "|---|---|---|---|",
    ]
    for r in routes:
        lines.append(f"| {r['method']} | `{r['path']}` | {ts_signature(r)} | {r['doc'] or r['fn']} |")

    lines += ["", "## Job commands", "",
              "POST `/api/run` with `key` set to one of these. It returns `{job, label}`.",
              "Poll GET `/api/job?id=` every 900ms until `running` is false.", "",
              "| key | label | tier |", "|---|---|---|"]
    for c in cmds:
        lines.append(f"| `{c['key']}` | {c['label']} | {c['tier']} |")

    lines += [
        "", "## Response shapes worth typing",
        "",
        "```ts",
        "type Capabilities = { ok: boolean; version: number; time: string; features: string[] };",
        "",
        "type Job = { key: string; out: string; running: boolean; code: number | null };",
        "",
        "type AskResult = {",
        "  answer: string;",
        "  model: string;",
        "  sources: { file: string; path: string; distance: number }[];",
        "};",
        "",
        "type TreeListing = {",
        "  root: string; parent: string;",
        "  dirs: { name: string; path: string; gated?: boolean }[];",
        "  files: { name: string; path: string; size: number; modified: string; editable: boolean }[];",
        "};",
        "",
        "type FileContent = { path: string; name: string; raw: string; html: string; editable: boolean };",
        "",
        "type KbStats = {",
        "  chunks: number; documents: number;",
        "  sources: { file: string; path: string; chunks: number }[];",
        "  error?: string;",
        "};",
        "",
        "type DigestItem = { flag: boolean; src: string; cls: string; ent: string; sen: string; one: string };",
        "type Digest = { date: string; items: DigestItem[]; dates: string[] };",
        "",
        "type Models = {",
        "  resident: { id: string; size: string }[];",
        "  available: string[];",
        "  bench: { role: string; id: string; tps: string; gib: string }[];",
        "  aliases: string[];",
        "};",
        "",
        "type Evals = {",
        "  results: { file: string; model: string; date: string; scores: Record<string, number> }[];",
        "  set_size: number; real_items: number;",
        "};",
        "",
        "type SelfTest = {",
        "  file: string | null; summary: string;",
        "  rows: { group: string; name: string; state: 'pass'|'warn'|'FAIL'; detail: string }[];",
        "};",
        "",
        "type Memory = {",
        "  stats: { events: number; days: number; cost: number; since: string;",
        "           by_kind: { kind: string; n: number }[] };",
        "  events: { ts: string; kind: string; model: string; question: string;",
        "            answer: string; sources: any[] }[];",
        "};",
        "```",
        "",
        "## Rules the interface must respect",
        "",
        "- These endpoints read material classed S1c, S2 and S3. **Never** send any response",
        "  from them to Supabase, to analytics, or to any external service. They exist to be",
        "  rendered locally and discarded.",
        "- A 403 from `/api/file/delete` or `/api/kb/forget` means the native approval dialog",
        "  was denied. That is a successful outcome of a working control — render it as",
        "  \"denied at the approval dialog\", never as a failure.",
        "- Deletion and forget block while the dialog is open, for up to five minutes. Show",
        "  \"awaiting approval on the machine…\" rather than a spinner.",
        "- Executable files (`.py`, `.sh`, `.plist`) are read-only by design. Do not offer an",
        "  edit control for them.",
    ]

    doc = "\n".join(lines) + "\n"
    if "--save" in sys.argv:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(doc)
        try:
            subprocess.run("pbcopy", input=doc, text=True, timeout=10)
            print(f"written to {OUT} and copied to clipboard "
                  f"({len(routes)} endpoints, {len(cmds)} commands, {len(doc)} chars)")
        except Exception:
            print(f"written to {OUT} ({len(routes)} endpoints, {len(cmds)} commands)")
    else:
        print(doc)


if __name__ == "__main__":
    main()

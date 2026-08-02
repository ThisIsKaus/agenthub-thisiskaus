#!/usr/bin/env python3
"""
Consumer-driven contract check.

A provider-driven contract describes what the API offers. It cannot detect that an offer
nobody can consume has gone stale — which is exactly how the skills library broke: the
structure changed, both consumers silently returned nothing, and 108 checks reported healthy
for a week.

Each consumer declares what it needs. This asserts every declaration still resolves.

  contract_check.py            run every declaration
  contract_check.py --json     machine-readable, for the self-test
"""
import json, sys, urllib.request, urllib.error
from pathlib import Path

H = Path.home() / "AgentHub"
SPEC = H / "contracts" / "consumers.json"
BASE = "http://127.0.0.1:4100"


def http(method, path, form=None):
    url = BASE + path
    if form:
        body, sep = b"", "----c"
        for k, v in form.items():
            body += (f"--{sep}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n"
                     f"{v}\r\n").encode()
        body += f"--{sep}--\r\n".encode()
        rq = urllib.request.Request(url, data=body, headers={
            "Content-Type": f"multipart/form-data; boundary={sep}"})
    else:
        rq = urllib.request.Request(url)
    with urllib.request.urlopen(rq, timeout=45) as r:
        return json.loads(r.read().decode())


def check(name, spec):
    try:
        if "http" in spec:
            method, path = spec["http"].split(" ", 1)
            d = http(method, path, spec.get("form"))
            missing = [f for f in spec.get("requires", []) if f not in d]
            if missing:
                return False, f"missing field(s): {', '.join(missing)}"
        elif "file" in spec:
            p = H / spec["file"]
            if not p.exists():
                return False, f"file absent: {spec['file']}"
            text = p.read_text(errors="ignore")
            d = None
        else:
            return False, "declaration has neither http nor file"
        if spec.get("assert"):
            if not eval(spec["assert"], {"d": d, "text": locals().get("text", ""),
                                         "isinstance": isinstance, "len": len,
                                         "list": list, "chr": chr}):
                return False, f"assertion failed: {spec['assert']}"
        return True, "ok"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:
        return False, f"{type(e).__name__}: {str(e)[:60]}"


def main():
    specs = json.loads(SPEC.read_text())
    rows = []
    for name, spec in specs.items():
        ok, detail = check(name, spec)
        rows.append({"name": name, "ok": ok, "detail": detail,
                     "consumer": spec.get("consumer", "")})
    passed = sum(1 for r in rows if r["ok"])
    n = len(rows)

    if "--json" in sys.argv:
        print(json.dumps({"passed": passed, "total": n,
                          "coverage": round(100 * passed / n) if n else 0,
                          "failures": [r for r in rows if not r["ok"]]}))
        return 0 if passed == n else 1

    for r in rows:
        print(f"  {'ok  ' if r['ok'] else 'FAIL'} {r['name']:26} {r['detail'][:52]}")
        if not r["ok"]:
            print(f"        consumer: {r['consumer']}")
    print(f"\n  {passed}/{n} consumer expectations satisfied "
          f"({round(100 * passed / n) if n else 0}% coverage)")
    return 0 if passed == n else 1


if __name__ == "__main__":
    sys.exit(main())

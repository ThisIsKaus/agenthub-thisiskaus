#!/usr/bin/env python3
"""AgentHub Microsoft Graph client — two pinned identities.
  personal      -> /consumers (MSA only)
  agenticality  -> /<AGENTICALITY_TENANT_ID> (own business tenant)
Never /common, never /organizations. Every token's tid claim is asserted:
a Microsoft-employer token cannot authenticate here.
"""
import subprocess, sys, datetime as dt
import msal, requests, keyring

SERVICE = "agenthub"
MSA_TID = "9188040d-6c67-4c5b-b112-36a304b66dad"   # well-known consumer tenant
SCOPES  = ["Calendars.Read", "Mail.Read", "Tasks.ReadWrite"]
GRAPH   = "https://graph.microsoft.com/v1.0"

def kc(name):
    r = subprocess.run(["security","find-generic-password","-a",SERVICE,"-s",name,"-w"],
                       capture_output=True, text=True)
    if r.returncode != 0: sys.exit(f"missing Keychain item: {name}")
    return r.stdout.strip()

def accounts():
    tid = kc("MS_AGENTICALITY_TENANT_ID")
    return {"personal":     {"authority":"https://login.microsoftonline.com/consumers","tid":MSA_TID},
            "agenticality": {"authority":f"https://login.microsoftonline.com/{tid}",   "tid":tid}}

def token(alias, interactive=False):
    cfg = accounts()[alias]
    cache = msal.SerializableTokenCache()
    blob = keyring.get_password(SERVICE, f"msal_cache_{alias}")
    if blob: cache.deserialize(blob)
    app = msal.PublicClientApplication(kc("MS_CLIENT_ID"), authority=cfg["authority"], token_cache=cache)
    res, accts = None, app.get_accounts()
    if accts: res = app.acquire_token_silent(SCOPES, account=accts[0])
    if not res and interactive:
        flow = app.initiate_device_flow(scopes=SCOPES)
        if "user_code" not in flow: sys.exit(f"device flow failed: {flow}")
        print(flow["message"], flush=True)
        res = app.acquire_token_by_device_flow(flow)
    if not res or "access_token" not in res:
        sys.exit(f"no token for '{alias}' — run: graph login {alias}")
    got = (res.get("id_token_claims") or {}).get("tid")
    if got and got != cfg["tid"]:
        sys.exit(f"REFUSED: token tenant {got} != pinned {cfg['tid']} for '{alias}'")
    if cache.has_state_changed:
        keyring.set_password(SERVICE, f"msal_cache_{alias}", cache.serialize())
    return res["access_token"]

def get(alias, path):
    r = requests.get(GRAPH+path, headers={"Authorization":"Bearer "+token(alias)}, timeout=30)
    r.raise_for_status(); return r.json()

def main():
    if len(sys.argv) < 3: sys.exit("usage: graph <login|whoami|calendar|tasks|mail> <personal|agenticality>")
    cmd, alias = sys.argv[1], sys.argv[2]
    if alias not in accounts(): sys.exit("alias must be personal or agenticality")
    if cmd == "login":
        token(alias, interactive=True); print(f"{alias}: signed in, tenant pinned OK")
    elif cmd == "whoami":
        d = get(alias, "/me"); print(d.get("displayName"), "|", d.get("userPrincipalName") or d.get("mail"))
    elif cmd == "calendar":
        now = dt.datetime.now(dt.timezone.utc); end = now + dt.timedelta(days=7)
        f = "%Y-%m-%dT%H:%M:%SZ"
        d = get(alias, f"/me/calendarView?startDateTime={now.strftime(f)}&endDateTime={end.strftime(f)}"
                       "&$orderby=start/dateTime&$top=15")
        for e in d.get("value", []) or ["(none in next 7 days)"]:
            print(f"{e['start']['dateTime'][:16].replace('T','  ')}  {e.get('subject','(no subject)')}"
                  if isinstance(e, dict) else e)
    elif cmd == "tasks":
        for l in get(alias, "/me/todo/lists").get("value", []):
            print("list:", l["displayName"])
    elif cmd == "mail":
        for m in get(alias, "/me/messages?$top=10&$select=subject,from,receivedDateTime").get("value", []):
            frm = (m.get("from") or {}).get("emailAddress", {}).get("address", "?")
            print(f"{m['receivedDateTime'][:16].replace('T','  ')}  {frm[:28]:28}  {m.get('subject','')[:55]}")
    else: sys.exit("unknown command")

if __name__ == "__main__":
    main()

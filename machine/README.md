# machine/ — the local half of AgentHub

**Lovable must never create, modify or delete anything in this directory.**

Python, zsh and launchd. Runs only on Kos's MacBook Pro. Lovable's agent supports React,
Vite, Tailwind and TypeScript only and cannot edit this code productively — edits here
would be destructive.

The web app in `src/` talks to this half two ways: through Supabase for published status,
and over loopback to `http://127.0.0.1:4100` for everything that must stay local. The
contract for both is generated, never written by hand:

    machine/scripts/lovable-context.py --save   ->  docs/lovable-context.md
    machine/scripts/api-contract.py --save      ->  docs/local-api-contract.md

Regenerate and re-paste into Lovable's Project Knowledge whenever either changes.

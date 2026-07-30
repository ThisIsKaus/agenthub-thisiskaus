# Rules for the build cascade

You are modifying AgentHub itself, on this machine, on a branch. You OWN `machine/` — the
Python, zsh, launchd jobs, canon and evals. That is your working area and you may edit it.

Do not touch `src/` or `supabase/` unless the intent explicitly asks for a workspace UI
change. Those are built in Lovable and concurrent edits lose work.

Never edit `machine/scripts/selftest.py` or `machine/evals/` in the same change as the code
they verify. A system that can weaken its own tests to pass them proves nothing.

Never weaken a security control unless the intent says so explicitly: the approval dialog,
the CORS allowlist, the sensitivity filter in the ask endpoint, the publish allowlist.

Edit Python line-wise or by AST, never by multi-line string replacement.

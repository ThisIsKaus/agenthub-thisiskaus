# <PROJECT> — project contract

Entity: <agenticality|nxi|client> · Sensitivity: S1p · Stage: see AgentHub registry.
Stack: <fill> · Deploy target: <fill>

## Ship path
git push -> GitHub Actions -> tagged release. This is the ONLY sanctioned deploy path.
Production credentials live in Actions secrets, never on this machine.

## Station gates (do not skip silently)
PRD (docs/prd.md, testable acceptance criteria) -> ADR (docs/adr/) -> build with tests
green -> second-model review (ChatGPT by default; local-coder for sensitive code) ->
CI green + tagged release -> operate entry -> one GTM artifact.

## Never
- Read or reference ~/AgentHub/vault.
- Touch another client's folder or carry context between clients.
- Mutate production directly. Any az/supabase/stripe write runs via: guard <command>
- Paste secrets into prompts. Per-project secrets: Keychain `agenthub.<PROJECT>.<KEY>`.

## Commands
test: <fill> · lint: <fill> · run: <fill>

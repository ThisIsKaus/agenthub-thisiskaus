# TWO PLANES — the central fact

**LOCAL — `http://127.0.0.1:4100` over loopback.** Available only when the browser runs on
the MacBook. An HTTPS page may fetch loopback because loopback is a potentially trustworthy
origin (MDN): the request never leaves the machine, the response never touches the cloud. The
API sends CORS headers naming this app's origin specifically.

**REMOTE — Supabase.** An agent on the machine polls Supabase **outbound** every 30s, claims
jobs, runs them locally, posts results back. **Nothing ever connects inward to the machine** —
no inbound port, firewall blocks all incoming. Your app writes jobs and reads published state.

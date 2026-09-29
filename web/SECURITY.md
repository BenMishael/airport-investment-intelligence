# Security

Only `NEXT_PUBLIC_SUPABASE_URL`, the Supabase anon/publishable key, and the API origin belong in browser configuration. Treat all other credentials as server-only.

Sessions intentionally use `sessionStorage`, unknown emails receive generic feedback, and generated content is rendered through React rather than injected HTML. Keep CSP and framing protections enabled. Report vulnerabilities privately to the repository owner.

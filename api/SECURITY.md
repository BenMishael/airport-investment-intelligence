# Security

Report vulnerabilities privately to the repository owner; do not open a public issue with credentials or exploit details.

## Boundaries

- Supabase Auth issues sessions; FastAPI verifies issuer, audience, expiry, signature, subject, email, and the server-side allowlist.
- The anon/publishable key may be public. The service-role, SMTP, database, and LLM credentials are server-only secrets.
- Unknown login emails receive generic UI feedback. OTPs and bearer tokens must never be logged.
- Conversation queries include `user_id`; access by identifier alone is forbidden.
- Model output is untrusted. Only typed structured responses are accepted, numeric/source claims are checked against evidence, and the UI never renders raw HTML.

Rotate a leaked key immediately, remove the affected allowlist entry, revoke Supabase sessions, and review `auth_audit_events` and request IDs.

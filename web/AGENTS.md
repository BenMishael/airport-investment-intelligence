# Codex repository guidance

- Use `src/app` and place behavior in feature modules, shared HTTP logic in `src/lib`, and contracts in `src/types`.
- All protected API calls must use `apiFetch`; never expose server-only credentials.
- Preserve email-enumeration protection and sessionStorage-based sessions.
- Render generated text through React, never raw HTML.
- Finish with lint, typecheck, tests, formatting check, and a production build.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

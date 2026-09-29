# Claude repository guidance

This is a strict TypeScript Next.js application. Keep Supabase auth isolated in `features/auth`, use the centralized authenticated API client, and preserve accessible loading/error/session states. Never expose service-role, SMTP, database, or LLM secrets. Validate with lint, typecheck, Vitest, Prettier, and a production build.

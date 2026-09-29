# Contributing

Keep authentication, API access, and feature presentation separated. Reuse `apiFetch` so every request receives a bearer token and consistent error handling. Do not render model-generated HTML or expose server credentials.

Before opening a pull request, run `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check`, and `npm run build`.

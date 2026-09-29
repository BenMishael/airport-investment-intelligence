# Codex repository guidance

- Read `README.md`, `ARCHITECTURE.md`, and relevant tests before changing behavior.
- Keep routes thin; business rules belong in `domain`/`services`, persistence in `repositories`, and external I/O in `providers`.
- Never let an LLM calculate or introduce evidence. Preserve deterministic fallbacks.
- Never commit secrets, real allowlists, local databases, tokens, or OTPs.
- For schema changes, add an Alembic migration and verify `alembic check`.
- Finish with `ruff check .`, `ruff format --check .`, `mypy app`, and `pytest`.

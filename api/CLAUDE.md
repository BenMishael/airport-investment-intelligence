# Claude repository guidance

This is a FastAPI/SQLAlchemy service. Preserve response compatibility and authentication ownership checks. Keep scoring pure and deterministic, external providers resilient, and generated explanations evidence-bound. Do not expose Supabase service-role, SMTP, database, or LLM credentials. Validate changes with Ruff, mypy, pytest, and Alembic.

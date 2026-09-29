# Contributing

Create focused branches and preserve existing response fields. Add a migration for every schema change and tests for every behavior change.

Before opening a pull request:

```bash
ruff check .
ruff format --check .
mypy app
pytest --cov=app
alembic check
```

Never commit `.env`, real allowlists, tokens, provider responses containing personal data, or generated local databases. Provider adapters must have explicit timeouts, bounded retries, cache policy, source attribution, and a tested unavailable state.

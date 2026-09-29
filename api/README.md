# Airport Investment Intelligence API

Production-style FastAPI service for evidence-led airport investment screening. Deterministic calculations are combined with public FAA, NOAA, Census, and BLS context; Groq may classify questions and explain supplied evidence, but never calculates scores.

## Quick start

Requires Python 3.11+ (3.13 recommended).

```bash
cd api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload
```

For local development without Supabase, set `AUTH_REQUIRED=false`. This bypass is rejected in `production`. Then open <http://localhost:8000/docs>.

```bash
ruff check . && ruff format --check .
mypy app
pytest
```

## Supabase and OTP setup

1. Create a Supabase project and copy its pooled Postgres URL to `DATABASE_URL`.
2. Set `SUPABASE_URL`; keep `SUPABASE_SERVICE_ROLE_KEY` available only when running administration commands.
3. In Supabase Auth, disable new-user signup, use the OTP template in `supabase/templates/magic_link.html`, set a 600-second expiry and 60-second frequency limit.
4. Configure custom SMTP with a dedicated Gmail account: host `smtp.gmail.com`, port `587`, STARTTLS, the full Gmail address, and a Google app password.
5. Apply migrations, seed the reference snapshot, put real addresses in ignored `allowlist.json`, and synchronize users:

```bash
alembic upgrade head
airport-admin seed-catalog
airport-admin sync-users --file allowlist.json
```

The command creates missing Supabase Auth users, updates `app_users`, and disables removed entries. The service-role key must never be placed in the web project.

## Operations

- `/health` is public liveness; `/ready` checks database and auth configuration.
- All data and chat routes require a Supabase bearer token plus active `app_users` membership.
- `airport-admin purge-conversations --days 30` enforces chat retention; schedule it daily.
- `airport-admin seed-catalog` idempotently synchronizes the checked-in aviation snapshot into the database.
- `airport-admin ingest-catalog` downloads OurAirports and writes `data/catalog.json` (optional `--faa` / `--bts` CSVs add enplanement and on-time KPIs). Exam overlays for BOS/LAX/SNA/ANC/SFO remain authoritative.
- Production API documentation is disabled. Set exact `CORS_ORIGINS` to the Vercel origin, never `*`.
- Run `alembic upgrade head` as a release step before starting new application instances.

See [ARCHITECTURE.md](ARCHITECTURE.md) for calculations and boundaries, [SECURITY.md](SECURITY.md) for the threat model, and `.env.example` for configuration.

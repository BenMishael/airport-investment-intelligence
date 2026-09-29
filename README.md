<p align="center">
  <img src="web/public/assets/brand/airport-intelligence-mark.svg" alt="Airport Intelligence" width="88" height="88">
</p>

<h1 align="center">Airport Investment Intelligence</h1>

<p align="center">
  Screen airport expansion opportunity with <strong>deterministic 0–100 scores</strong>, public aviation evidence, and source-bound explanations.
</p>

<p align="center">
  <a href="https://github.com/BenMishael/airport-investment-intelligence/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/BenMishael/airport-investment-intelligence/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs&logoColor=white">
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-Python-009688?logo=fastapi&logoColor=white">
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Auth%20%2B%20Postgres-3FCF8E?logo=supabase&logoColor=white">
  <img alt="Python 3.11+" src="https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white">
</p>

<p align="center">
  One repository. Two services. Supabase for auth and Postgres only.
</p>

<p align="center">
  <img src="media/photos/04-ranking-desktop.png" alt="New England expansion ranking with opportunity scores" width="880">
</p>

## Table of contents

- [About](#about)
- [Quick start](#quick-start)
- [Key features](#key-features)
- [Architecture](#architecture)
- [Scoring](#scoring)
- [Video](#video)
- [Screenshots](#screenshots)
- [Built with](#built-with)
- [Configuration](#configuration)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security](#security)
- [Contributing](#contributing)

## About

Airport Investment Intelligence is a private screening workspace for comparing airports on public demand, delay, cancellation, and route-mix evidence.

The model never invents a number. Scores come from checked-in FAA and BTS aggregates. Live NOAA, Census, and BLS context can appear beside an answer, but it cannot change the 0–100 score. Groq or Gemini may rewrite the briefing in plain language; if the rewrite invents a figure or source, the deterministic memo is shown instead.

This is a **screening signal**, not terminal-utilization proof, causation, or investment advice.

## Quick start

Requires **Python 3.11+** (3.13 recommended) and **Node 22**.

```bash
# API
cd api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload
```

```bash
# Web
cd web
npm ci
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Visiting `http://127.0.0.1:3000` redirects to localhost so the Supabase OTP origin matches.

For allowlisted OTP: configure Supabase SMTP, keep `allowlist.json` uncommitted, then:

```bash
airport-admin seed-catalog
airport-admin sync-users --file allowlist.json
```

Optional Docker parity from the repo root (needs `api/.env` and public Supabase values as compose build args):

```bash
docker compose up --build
```

App-level setup lives in [`api/README.md`](api/README.md) and [`web/README.md`](web/README.md).

## Key features

**1. Deterministic opportunity scores.**  
U.S. commercial-service airports with BTS on-time counts receive a 0–100 expansion screen. The formula is fixed in code and independent of the language model.

**2. Evidence-constrained chat.**  
Answers use four headings: Direct answer, Evidence and method, Scope and uncertainty, Conclusion. The model may rephrase wording, not numbers.

**3. Invitation-only access.**  
Supabase email OTP. Public signup is off. FastAPI accepts a valid JWT only while that subject/email pair is active in `app_users`.

**4. Saved analyses.**  
Conversations are owned by the signed-in user, retained for 30 days, and deletable from the history drawer.

**5. Live context that cannot move the score.**  
NOAA METAR, FAA NAS, Census, and BLS attach as labeled supplemental context after scoring.

**6. Honest coverage.**  
Foreign and identity-only airports can be named and receive METAR. They never receive a fabricated 0–100 score.

**7. Desktop and mobile workspace.**  
Starter questions, Groq/Gemini toggle, voice dictation where the browser supports it, and a compact ranking view on small screens.

## Architecture

```text
web/   Next.js 16  →  Vercel
         Bearer JWT
api/   FastAPI     →  Render or Railway
         ├── catalog snapshot (OurAirports identity + FAA/BTS KPIs)
         ├── deterministic 0–100 scores from checked-in evidence
         ├── FAA / NOAA / Census / BLS context (never changes the score)
         └── Groq or Gemini evidence-constrained explanations
supabase  Auth OTP + Postgres  (not an app host)
```

Supabase does not run Next.js or FastAPI. It issues sessions and stores `app_users`, conversations, and the catalog snapshot.

Observation window: **FAA CY2025 / BTS CY2024**.

Request flow and tradeoffs are documented in [`api/ARCHITECTURE.md`](api/ARCHITECTURE.md).

## Scoring

The expansion screen is computed only for `bts_scored` rows:

| Weight | Component | Signal |
| -----: | --------- | ------ |
| 35% | Passenger growth | FAA enplanement growth |
| 30% | Departure delay | Share of departures delayed ≥ 15 minutes |
| 20% | Cancellation | Cancelled departures / reported departures |
| 15% | Activity scale | Log-scaled reported departures |

KPI eligibility:

- **`bts_scored`** — U.S. commercial-service airport with 2024 BTS on-time counts plus FAA enplanements. Full 0–100 screen.
- **`enplanement_only`** — FAA boardings without delay/cancel counts. No expansion score.
- **`identity`** — name, city, country, ICAO; live METAR if NOAA returns one. No expansion score.

Demand pressure is delayed plus cancelled departures. It is **not** measured unmet passenger demand.

## Video

Check out the walkthrough: invitation-only sign-in, starter questions, and evidence-led rankings.

https://github.com/BenMishael/airport-investment-intelligence/raw/main/media/demo.mp4

## Screenshots

<table>
  <tr>
    <th>Desktop</th>
    <th>Mobile</th>
  </tr>
  <tr>
    <td><img src="media/photos/01-signin-desktop.png" alt="Desktop invitation-only sign-in"></td>
    <td><img src="media/photos/02-signin-mobile.png" alt="Mobile invitation-only sign-in" width="280"></td>
  </tr>
  <tr>
    <td><img src="media/photos/03-workspace-empty-desktop.png" alt="Desktop workspace with starter questions"></td>
    <td><img src="media/photos/07-workspace-empty-mobile.png" alt="Mobile workspace with starter questions" width="280"></td>
  </tr>
  <tr>
    <td><img src="media/photos/04-ranking-desktop.png" alt="Desktop New England ranking"></td>
    <td><img src="media/photos/05-ranking-mobile.png" alt="Mobile opportunity ranking" width="280"></td>
  </tr>
</table>

<p align="center">
  <img src="media/photos/06-history-drawer-mobile.png" alt="Mobile saved-analyses drawer" width="280">
  <br>
  <em>Saved analyses, owner-scoped and deletable</em>
</p>

## Built with

| Layer | Stack |
| ----- | ----- |
| Web | Next.js 16, React 19, TypeScript, Motion, Phosphor, react-markdown |
| Auth / data | Supabase Auth (email OTP) and Postgres |
| API | FastAPI, SQLAlchemy, Alembic, Pydantic Settings, uvicorn |
| Scoring | Pure Python in `api/app/domain/scoring.py` |
| Explanations | Groq (default) or Gemini; JSON-constrained; rejected if they invent evidence |
| Public context | FAA, BTS, NOAA METAR, Census, BLS |
| CI | Path-filtered GitHub Actions, gitleaks, ruff, mypy, pytest, ESLint, Vitest, Playwright |

## Configuration

**API** (`api/.env` from [`api/.env.example`](api/.env.example)):

```env
ENVIRONMENT=development
DATABASE_URL=your-supabase-session-pooler-url
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
AUTH_REQUIRED=true
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_JWT_AUDIENCE=authenticated
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
LLM_PROVIDER=groq
GROQ_API_KEY=your-groq-key
```

Optional: `GEMINI_API_KEY`, `CENSUS_API_KEY`, `BLS_API_KEY`.

**Web** (`web/.env.local` from [`web/.env.example`](web/.env.example)):

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-anon-key
NEXT_PUBLIC_DEFAULT_LLM_PROVIDER=groq
```

Never put a service-role, database, SMTP, or LLM key in a `NEXT_PUBLIC_*` variable.

## Testing

```bash
# API
cd api
ruff check . && ruff format --check .
mypy app
pytest --cov=app
alembic check
```

```bash
# Web
cd web
npm run lint
npm run typecheck
npm test
npm run format:check
npm run build
npm run test:e2e
```

Path-filtered CI is in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). `ENVIRONMENT=test` loads the 11-airport fixture and stubs live providers so pytest stays offline.

## Deployment

Runtime stays two services even though the git tree is one repo.

1. **Supabase** — Disable public signup. Custom SMTP. Site URL and Redirect URLs = the Vercel origin. Keep `allowlist.json` uncommitted. Apply `alembic upgrade head`, `airport-admin seed-catalog`, and `airport-admin sync-users`.
2. **API (Render or Railway)** — Docker context `api/`. [`render.yaml`](render.yaml) is a starting blueprint. Production requires `ENVIRONMENT=production`, `AUTH_REQUIRED=true`, pooled `DATABASE_URL`, exact `CORS_ORIGINS=https://<vercel-host>` (no localhost), `SUPABASE_URL`, and LLM keys.
3. **Web (Vercel)** — Root Directory `web`. Set `NEXT_PUBLIC_API_BASE_URL` to the public API URL, plus `NEXT_PUBLIC_SUPABASE_URL` and the anon/publishable key only.
4. Confirm `/health`, `/ready`, OTP sign-in, authenticated ranking, history ownership/deletion, and sign-out.

The API image copies `data/catalog.json`. Without that file the runtime falls back to the 11-airport exam fixture.

## Security

- Authentication is allowlisted email OTP. The browser holds only the Supabase publishable key.
- FastAPI verifies the JWT, then checks `app_users`. Conversation queries always include the internal user ID.
- Interactive API docs are disabled in production. CORS is exact origins, never `*`.
- Groq receives the question, short conversation context, and retrieved evidence. Prompts and credentials are not stored.

No committed file should contain a real interviewer address or credential.

## Contributing

Each app keeps its own contribution checklist:

- API: [`api/CONTRIBUTING.md`](api/CONTRIBUTING.md)
- Web: [`web/CONTRIBUTING.md`](web/CONTRIBUTING.md)

Preserve existing response fields. Add a migration for every schema change and tests for every behavior change. Do not let the language model calculate or introduce evidence.

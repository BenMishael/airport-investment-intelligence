# Architecture and methodology

## Request flow

```text
Next.js → Supabase email OTP → Supabase JWT
   └── Bearer JWT → FastAPI signature/claim verification → app_users allowlist
          ├── catalog snapshot (OurAirports identity + FAA/BTS KPIs + exam overlay)
          ├── deterministic scoring when kpi_tier is bts_scored
          ├── persisted user-owned conversations → PostgreSQL
          ├── bounded public-data providers → FAA / NOAA / Census / BLS
          └── typed LLM provider → Groq intent + evidence-only briefing rewrite
```

Routes perform transport validation only. `services` orchestrate use cases, `repositories` own queries, `providers` isolate external I/O, `db` defines persistence, and scoring remains pure. SQLite supports local/unit work; deployed environments use Supabase Postgres and Alembic.

## Scoring methodology

The 11 exam airports keep checked-in 2024 BTS/FAA aggregates so BOS, LAX, SNA, ANC, and SFO answers cannot drift. A processed snapshot adds U.S. commercial-service identity and international IATA identity from OurAirports.

KPI eligibility:

- `bts_scored` — U.S. commercial-service airport with 2024 BTS on-time counts plus FAA enplanements/growth. Full 0–100 expansion screen.
- `enplanement_only` — FAA boardings without delay/cancel counts. Enplanements may be shown; no expansion score.
- `identity` — international IATA (and U.S. rows without BTS KPIs). Name, city, country, ICAO; live METAR if NOAA returns one. No expansion score.

Calculations used only for `bts_scored` rows:

- Departure delay rate: departures delayed at least 15 minutes / reported departures.
- Cancellation rate: cancelled departures / reported departures.
- Long haul: nonstop segment of at least 1,500 statute miles, with matched T-100 numerator and denominator.
- Demand pressure: delayed plus cancelled departures. It is not measured unmet passenger demand.

The 0–100 expansion screen weights passenger growth 35%, departure-delay pressure 30%, cancellation pressure 20%, and log-scaled flight activity 15%. It is a screening signal—not terminal utilization, causation, investment return, or advice.

Chat answers are four-heading briefings: Direct answer, Evidence and method, Scope and uncertainty, and Conclusion. The deterministic builder always produces that memo; the model may rewrite wording, not numbers.

## Key tradeoffs

- **Scored vs identity inventory.** A full IATA directory is possible from OurAirports at no cost. Comparable delay and enplanement scores are not: BTS on-time performance is U.S. reporting-carrier coverage. Foreign airports are listed and can receive METAR, but they are never given a fabricated 0–100 score.
- **Snapshot vs live APIs.** Annual BTS/FAA aggregates are reproducible across deploys. NOAA METAR, FAA NAS, Census, and BLS are request-time context, cached, and omitted from the score.
- **East Coast vs New England.** With a commercial-service catalog, “East Coast” means Atlantic-seaboard scored airports (Maine through Florida). New England remains its own region so the exam ranking is unchanged.
- **Demand proxy vs unmet demand.** Delayed plus cancelled departures is observable. True unmet demand needs bookings, fares, and capacity data that public files do not contain.
- **Explanation can be rejected.** If the model invents a number or source, the deterministic briefing is shown instead.

## Where AI is used

Groq (or explicit Gemini) classifies intent and may rewrite the deterministic briefing. It never calculates scores, delay rates, or rankings. Airport codes are validated against the catalog. Numeric and source claims are checked against evidence plus the briefing. At most two model calls occur per chat action. Live public context is attached after scores are computed and is labeled as supplemental.

## Data and resilience

`airport-admin ingest-catalog` builds `data/catalog.json` from OurAirports (and optional FAA/BTS CSVs). Runtime loads that snapshot and overlays the exam KPIs. `ENVIRONMENT=test` loads only the 11-airport fixture and stubs live providers, so pytest stays offline.

Each provider has a short timeout, one retry, a TTL, provenance, and an explicit unavailable result. `/airports/{code}/context` and chat `live_context` skip FAA NAS/facilities and Census/BLS for non-U.S. airports. NOAA METAR is worldwide when an ICAO exists.

## Trust boundaries

Supabase creates only pre-approved users. FastAPI accepts a valid Supabase token only while its subject/email pair is active in `app_users`; every conversation query also includes the internal user ID. The browser receives only the Supabase publishable key.

Groq receives the question, short conversation context, and retrieved evidence. JSON schemas constrain output. Prompts and credentials are not stored; `llm_runs` retains only operational metadata.

## Production operations

Apply migrations before deployment, schedule 30-day conversation cleanup daily, monitor readiness/provider latency/fallback rate, and wake free-tier Supabase before an interview. The API disables interactive documentation in production and accepts CORS only from configured origins.

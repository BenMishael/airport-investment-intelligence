from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import httpx

from app.catalog import CATALOG_SNAPSHOT, DATA_DIR, EXAM_AIRPORTS
from app.core.config import get_settings
from app.db.session import get_session_factory, initialize_local_database
from app.ingestion.bts_ontime import aggregate_year, write_bts_csv
from app.ingestion.catalog import seed_reference_data
from app.ingestion.faa_boardings import download_faa_enplanements
from app.ingestion.snapshot import build_catalog_snapshot, download_ourairports
from app.repositories.conversations import ConversationRepository
from app.repositories.users import UserRepository


def _read_allowlist(path: Path) -> list[str]:
    raw = path.read_text(encoding="utf-8")
    values = json.loads(raw) if path.suffix == ".json" else raw.splitlines()
    if not isinstance(values, list):
        raise ValueError("The allowlist must be a JSON array or one email per line")
    emails = sorted(
        {
            str(value).strip().lower()
            for value in values
            if str(value).strip() and not str(value).lstrip().startswith("#")
        }
    )
    if not emails or any("@" not in email or len(email) > 320 for email in emails):
        raise ValueError("The allowlist is empty or contains an invalid email")
    return emails


def _supabase_users(base_url: str, key: str) -> dict[str, dict[str, Any]]:
    headers = {"Authorization": f"Bearer {key}", "apikey": key}
    users: dict[str, dict[str, Any]] = {}
    page = 1
    while True:
        response = httpx.get(
            f"{base_url}/auth/v1/admin/users", headers=headers, params={"page": page, "per_page": 1000}, timeout=15
        )
        response.raise_for_status()
        batch = response.json().get("users", [])
        for item in batch:
            users[str(item.get("email", "")).lower()] = item
        if len(batch) < 1000:
            return users
        page += 1


def sync_users(path: Path) -> None:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    emails = _read_allowlist(path)
    key, base_url = settings.supabase_service_role_key, settings.supabase_url.rstrip("/")
    headers = {"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "application/json"}
    remote = _supabase_users(base_url, key)
    subjects: set[str] = set()
    initialize_local_database()
    with get_session_factory()() as session:
        repository = UserRepository(session)
        created = 0
        for email in emails:
            user = remote.get(email)
            if user is None:
                response = httpx.post(
                    f"{base_url}/auth/v1/admin/users",
                    headers=headers,
                    json={"email": email, "email_confirm": True},
                    timeout=15,
                )
                response.raise_for_status()
                payload = response.json()
                user = payload.get("user", payload)
                created += 1
            subject = str(user["id"])
            subjects.add(subject)
            repository.upsert(subject, email, allowed=True)
        disabled = repository.disable_except(subjects)
        session.commit()
    print(f"Allowlist synchronized: {len(emails)} active, {created} created, {disabled} disabled.")


def purge_conversations(days: int) -> None:
    initialize_local_database()
    with get_session_factory()() as session:
        deleted = ConversationRepository(session).purge_older_than(days)
    print(f"Deleted {deleted} conversations older than {days} days.")


def seed_catalog() -> None:
    initialize_local_database()
    with get_session_factory()() as session:
        counts = seed_reference_data(session)
    print(
        f"Catalog synchronized: {counts['airports']} airports, {counts['sources']} sources, {counts['metrics']} metrics."
    )


def ingest_catalog(ourairports: Path | None, faa: Path | None, bts: Path | None, output: Path) -> None:
    source = ourairports
    if source is None:
        source = DATA_DIR / "ourairports.csv"
        print(f"Downloading OurAirports CSV to {source}")
        download_ourairports(source)
    counts = build_catalog_snapshot(source, faa_csv=faa, bts_csv=bts, output=output)
    print(
        "Wrote catalog snapshot: "
        f"{counts['airports']} airports "
        f"({counts.get('bts_scored', 0)} scored, {counts.get('enplanement_only', 0)} enplanement-only, "
        f"{counts.get('identity', 0)} identity) to {output}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(prog="airport-admin")
    commands = parser.add_subparsers(dest="command", required=True)
    sync = commands.add_parser("sync-users", help="Synchronize the private Supabase email allowlist")
    sync.add_argument("--file", type=Path, required=True)
    purge = commands.add_parser("purge-conversations", help="Apply chat-history retention")
    purge.add_argument("--days", type=int, default=get_settings().conversation_retention_days)
    commands.add_parser("seed-catalog", help="Idempotently synchronize checked-in aviation reference data")
    ingest = commands.add_parser("ingest-catalog", help="Build the processed airport snapshot from free public files")
    ingest.add_argument("--ourairports", type=Path, default=None, help="Local OurAirports CSV; downloaded if omitted")
    ingest.add_argument(
        "--faa", type=Path, default=None, help="Optional FAA enplanement CSV (iata,enplanements,enplanement_growth_pct)"
    )
    ingest.add_argument("--bts", type=Path, default=None, help="Optional BTS airport-level on-time CSV")
    ingest.add_argument("--output", type=Path, default=CATALOG_SNAPSHOT)
    faa_cmd = commands.add_parser("ingest-faa-cy2025", help="Download FAA CY2025 enplanements to a CSV")
    faa_cmd.add_argument("--output", type=Path, default=DATA_DIR / "faa_cy2025.csv")
    bts_cmd = commands.add_parser("ingest-bts-year", help="Download BTS monthly on-time zips and aggregate")
    bts_cmd.add_argument("--year", type=int, default=2025)
    bts_cmd.add_argument("--zip-dir", type=Path, default=DATA_DIR / "bts_zips")
    bts_cmd.add_argument("--output", type=Path, default=DATA_DIR / "bts_ontime.csv")
    bts_cmd.add_argument("--codes", type=str, default=",".join(EXAM_AIRPORTS), help="Comma-separated IATA filter")
    args = parser.parse_args()
    if args.command == "sync-users":
        sync_users(args.file)
    elif args.command == "purge-conversations":
        purge_conversations(args.days)
    elif args.command == "seed-catalog":
        seed_catalog()
    elif args.command == "ingest-catalog":
        ingest_catalog(args.ourairports, args.faa, args.bts, args.output)
    elif args.command == "ingest-faa-cy2025":
        path = download_faa_enplanements(args.output)
        print(f"Wrote FAA enplanements to {path}")
    elif args.command == "ingest-bts-year":
        wanted = {item.strip().upper() for item in args.codes.split(",") if item.strip()}
        rows = aggregate_year(args.year, args.zip_dir, wanted)
        path = write_bts_csv(rows, args.output)
        print(f"Wrote {len(rows)} airport on-time rows to {path}")


if __name__ == "__main__":
    main()

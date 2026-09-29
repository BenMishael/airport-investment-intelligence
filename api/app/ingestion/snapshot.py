"""Build a checked-in airport identity snapshot from free public files."""

from __future__ import annotations

import csv
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import httpx

from app.catalog import CATALOG_SNAPSHOT, EXAM_AIRPORTS, EXAM_ALIASES, exam_airports
from app.ingestion.iso_countries import country_name
from app.regions import TYPE_RANK, us_region_for_state

OURAIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
SKIP_TYPES = {"closed", "heliport", "balloonport"}
BTS_FIELDS = (
    "enplanements",
    "departures",
    "delayed_departures",
    "cancelled_departures",
    "avg_departure_delay_minutes",
    "avg_taxi_out_minutes",
    "enplanement_growth_pct",
    "covered_route_departures",
    "long_haul_departures",
)


def _iata(value: str | None) -> str | None:
    code = str(value or "").strip().upper()
    return code if len(code) == 3 and code.isalpha() else None


def _icao(value: str | None) -> str | None:
    code = str(value or "").strip().upper()
    return code if 3 <= len(code) <= 4 and code.isalnum() else None


def _float(value: Any) -> float | None:
    try:
        if value is None or str(value).strip() == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _us_state(iso_country: str, iso_region: str) -> str | None:
    if iso_country != "US":
        return None
    if iso_region.startswith("US-") and len(iso_region) >= 4:
        return iso_region.split("-", 1)[1][:2].upper()
    return None


def _better_row(current: dict[str, Any], candidate: dict[str, Any]) -> bool:
    current_rank = TYPE_RANK.get(str(current.get("airport_type") or ""), 9)
    candidate_rank = TYPE_RANK.get(str(candidate.get("airport_type") or ""), 9)
    if candidate_rank != current_rank:
        return candidate_rank < current_rank
    return bool(candidate.get("scheduled_service")) and not current.get("scheduled_service")


def parse_ourairports(rows: Iterable[dict[str, str]]) -> dict[str, dict[str, Any]]:
    airports: dict[str, dict[str, Any]] = {}
    for raw in rows:
        iata = _iata(raw.get("iata_code"))
        kind = str(raw.get("type") or "").strip().lower()
        if not iata or kind in SKIP_TYPES:
            continue
        iso = str(raw.get("iso_country") or "").strip().upper()
        scheduled = str(raw.get("scheduled_service") or "").strip().lower() == "yes"
        if iso == "US" and not scheduled:
            continue
        if iso != "US" and not scheduled and kind not in {"large_airport", "medium_airport"}:
            continue
        state = _us_state(iso, str(raw.get("iso_region") or "").strip().upper())
        country = country_name(iso) if iso else "Unknown"
        row = {
            "name": str(raw.get("name") or iata).strip(),
            "city": str(raw.get("municipality") or "").strip(),
            "state": state,
            "region": us_region_for_state(state) if iso == "US" else country,
            "country": country,
            "country_iso": iso or None,
            "icao": _icao(raw.get("icao_code") or raw.get("gps_code") or raw.get("ident")),
            "continent": str(raw.get("continent") or "").strip().upper() or None,
            "airport_type": kind or None,
            "scheduled_service": scheduled,
            "kpi_tier": "identity",
            "latitude": _float(raw.get("latitude_deg")),
            "longitude": _float(raw.get("longitude_deg")),
        }
        existing = airports.get(iata)
        if existing is None or _better_row(existing, row):
            airports[iata] = row
    return airports


def parse_ourairports_csv(path: Path) -> dict[str, dict[str, Any]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return parse_ourairports(csv.DictReader(handle))


def merge_faa_enplanements(airports: dict[str, dict[str, Any]], path: Path) -> int:
    updated = 0
    with path.open(newline="", encoding="utf-8") as handle:
        for raw in csv.DictReader(handle):
            code = _iata(raw.get("iata") or raw.get("iata_code") or raw.get("code"))
            if not code or code not in airports:
                continue
            enplanements = _float(raw.get("enplanements"))
            growth = _float(raw.get("enplanement_growth_pct") or raw.get("growth_pct"))
            if enplanements is None:
                continue
            row = airports[code]
            row["enplanements"] = int(enplanements)
            if growth is not None:
                row["enplanement_growth_pct"] = growth
            if row.get("kpi_tier") != "bts_scored":
                row["kpi_tier"] = "enplanement_only"
            updated += 1
    return updated


def merge_bts_metrics(airports: dict[str, dict[str, Any]], path: Path) -> int:
    updated = 0
    with path.open(newline="", encoding="utf-8") as handle:
        for raw in csv.DictReader(handle):
            code = _iata(raw.get("iata") or raw.get("iata_code") or raw.get("code"))
            if not code:
                continue
            row = airports.setdefault(code, {"name": code, "kpi_tier": "identity", "country_iso": "US"})
            for field in BTS_FIELDS:
                value = raw.get(field)
                if value is None or str(value).strip() == "":
                    continue
                number = _float(value)
                if number is None:
                    continue
                row[field] = (
                    int(number)
                    if field not in {"avg_departure_delay_minutes", "avg_taxi_out_minutes", "enplanement_growth_pct"}
                    else number
                )
            required = (
                "departures",
                "delayed_departures",
                "cancelled_departures",
                "enplanements",
                "enplanement_growth_pct",
            )
            if all(row.get(field) is not None for field in required):
                row["kpi_tier"] = "bts_scored"
                row.setdefault("country_iso", "US")
                row.setdefault("country", "United States")
            updated += 1
    return updated


def overlay_exam_airports(airports: dict[str, dict[str, Any]]) -> None:
    for code, row in exam_airports().items():
        airports[code] = {**airports.get(code, {}), **row}


def build_aliases(airports: dict[str, dict[str, Any]]) -> dict[str, str]:
    aliases = dict(EXAM_ALIASES)
    used = {alias.lower() for alias in aliases}
    used.update(code.lower() for code in airports)
    city_to_codes: dict[str, set[str]] = {}
    for code, airport in airports.items():
        city = str(airport.get("city") or "").strip().lower()
        if city:
            city_to_codes.setdefault(city, set()).add(code)
    for city, codes in city_to_codes.items():
        if len(codes) == 1 and city not in used:
            aliases[city] = next(iter(codes))
            used.add(city)
    return aliases


def snapshot_payload(airports: dict[str, dict[str, Any]], aliases: dict[str, str]) -> dict[str, Any]:
    return {"airports": airports, "aliases": aliases, "count": len(airports)}


def write_snapshot(airports: dict[str, dict[str, Any]], aliases: dict[str, str], path: Path = CATALOG_SNAPSHOT) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snapshot_payload(airports, aliases), separators=(",", ":")), encoding="utf-8")
    return path


def download_ourairports(destination: Path, url: str = OURAIRPORTS_URL) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with httpx.stream("GET", url, timeout=60.0, follow_redirects=True) as response:
        response.raise_for_status()
        with destination.open("wb") as handle:
            for chunk in response.iter_bytes():
                handle.write(chunk)
    return destination


def build_catalog_snapshot(
    ourairports_csv: Path,
    *,
    faa_csv: Path | None = None,
    bts_csv: Path | None = None,
    output: Path = CATALOG_SNAPSHOT,
) -> dict[str, int]:
    airports = parse_ourairports_csv(ourairports_csv)
    faa_count = merge_faa_enplanements(airports, faa_csv) if faa_csv and faa_csv.is_file() else 0
    bts_count = merge_bts_metrics(airports, bts_csv) if bts_csv and bts_csv.is_file() else 0
    overlay_exam_airports(airports)
    aliases = build_aliases(airports)
    write_snapshot(airports, aliases, output)
    tiers = {"bts_scored": 0, "enplanement_only": 0, "identity": 0}
    for row in airports.values():
        tier = str(row.get("kpi_tier") or "identity")
        tiers[tier] = tiers.get(tier, 0) + 1
    return {
        "airports": len(airports),
        "faa_enplanements": faa_count,
        "bts_metrics": bts_count,
        "exam_overlay": len(EXAM_AIRPORTS),
        **tiers,
    }

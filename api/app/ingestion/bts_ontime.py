"""Aggregate BTS monthly On-Time PREZIP files into airport-level delay metrics."""

from __future__ import annotations

import csv
import io
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any

import httpx

PREZIP = (
    "https://transtats.bts.gov/PREZIP/On_Time_Reporting_Carrier_On_Time_Performance_1987_present_{year}_{month}.zip"
)
ALIASES = {
    "origin": ("ORIGIN", "Origin"),
    "cancelled": ("CANCELLED", "Cancelled"),
    "dep_del15": ("DEP_DEL15", "DepDel15"),
    "dep_delay": ("DEP_DELAY", "DepDelay"),
    "taxi_out": ("TAXI_OUT", "TaxiOut"),
}


def _index(header: list[str], names: tuple[str, ...]) -> int | None:
    lookup = {name.strip().strip('"').upper(): i for i, name in enumerate(header)}
    for name in names:
        if name.upper() in lookup:
            return lookup[name.upper()]
    return None


def _number(value: str | None) -> float | None:
    try:
        if value is None or str(value).strip() == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def aggregate_ontime_csv(handle: io.TextIOBase, wanted: set[str] | None = None) -> dict[str, dict[str, float]]:
    reader = csv.reader(handle)
    header = next(reader)
    origin_i = _index(header, ALIASES["origin"])
    cancelled_i = _index(header, ALIASES["cancelled"])
    delay15_i = _index(header, ALIASES["dep_del15"])
    delay_i = _index(header, ALIASES["dep_delay"])
    taxi_i = _index(header, ALIASES["taxi_out"])
    if origin_i is None or cancelled_i is None or delay15_i is None:
        raise ValueError("BTS on-time CSV is missing ORIGIN/CANCELLED/DEP_DEL15")
    totals: dict[str, dict[str, float]] = defaultdict(
        lambda: {
            "departures": 0,
            "delayed_departures": 0,
            "cancelled_departures": 0,
            "delay_sum": 0,
            "taxi_sum": 0,
            "taxi_n": 0,
        }
    )
    for row in reader:
        if origin_i >= len(row):
            continue
        origin = row[origin_i].strip().strip('"').upper()
        if len(origin) != 3 or (wanted is not None and origin not in wanted):
            continue
        cancelled = _number(row[cancelled_i] if cancelled_i < len(row) else None) or 0.0
        bucket = totals[origin]
        bucket["departures"] += 1
        if cancelled >= 1:
            bucket["cancelled_departures"] += 1
            continue
        delayed = _number(row[delay15_i] if delay15_i < len(row) else None) or 0.0
        if delayed >= 1:
            bucket["delayed_departures"] += 1
        delay = _number(row[delay_i] if delay_i is not None and delay_i < len(row) else None)
        if delay is not None:
            bucket["delay_sum"] += delay
        taxi = _number(row[taxi_i] if taxi_i is not None and taxi_i < len(row) else None)
        if taxi is not None:
            bucket["taxi_sum"] += taxi
            bucket["taxi_n"] += 1
    return totals


def merge_month(into: dict[str, dict[str, float]], month: dict[str, dict[str, float]]) -> None:
    for code, values in month.items():
        bucket = into.setdefault(
            code,
            {
                "departures": 0,
                "delayed_departures": 0,
                "cancelled_departures": 0,
                "delay_sum": 0,
                "taxi_sum": 0,
                "taxi_n": 0,
            },
        )
        for key, value in values.items():
            bucket[key] += value


def finalize(totals: dict[str, dict[str, float]]) -> list[dict[str, Any]]:
    rows = []
    for code, values in sorted(totals.items()):
        departures = int(values["departures"])
        if departures <= 0:
            continue
        taxi_n = values["taxi_n"] or 0
        rows.append(
            {
                "iata": code,
                "departures": departures,
                "delayed_departures": int(values["delayed_departures"]),
                "cancelled_departures": int(values["cancelled_departures"]),
                "avg_departure_delay_minutes": round(
                    values["delay_sum"] / max(departures - values["cancelled_departures"], 1), 1
                ),
                "avg_taxi_out_minutes": round(values["taxi_sum"] / taxi_n, 1) if taxi_n else "",
            }
        )
    return rows


def download_month(year: int, month: int, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file() and destination.stat().st_size > 1_000_000:
        return destination
    url = PREZIP.format(year=year, month=month)
    with httpx.stream("GET", url, timeout=180.0, follow_redirects=True) as response:
        response.raise_for_status()
        with destination.open("wb") as handle:
            for chunk in response.iter_bytes():
                handle.write(chunk)
    return destination


def aggregate_year(year: int, zip_dir: Path, wanted: set[str] | None = None) -> list[dict[str, Any]]:
    totals: dict[str, dict[str, float]] = {}
    for month in range(1, 13):
        archive = download_month(year, month, zip_dir / f"ontime_{year}_{month:02d}.zip")
        with zipfile.ZipFile(archive) as zf:
            name = next(item for item in zf.namelist() if item.lower().endswith(".csv"))
            with zf.open(name) as raw:
                wrapper = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
                merge_month(totals, aggregate_ontime_csv(wrapper, wanted))
    return finalize(totals)


def write_bts_csv(rows: list[dict[str, Any]], destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "iata",
        "departures",
        "delayed_departures",
        "cancelled_departures",
        "avg_departure_delay_minutes",
        "avg_taxi_out_minutes",
    ]
    with destination.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return destination

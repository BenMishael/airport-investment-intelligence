"""Pure functions for transparent airport KPIs and ranking."""

from __future__ import annotations

import math
from typing import Any

BTS_REQUIRED = (
    "enplanements",
    "departures",
    "delayed_departures",
    "cancelled_departures",
    "avg_departure_delay_minutes",
    "avg_taxi_out_minutes",
    "enplanement_growth_pct",
)


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def percentage(numerator: int | float, denominator: int | float) -> float | None:
    if denominator <= 0:
        return None
    return round(100 * numerator / denominator, 1)


def kpi_tier(row: dict[str, Any]) -> str:
    explicit = row.get("kpi_tier")
    if explicit:
        return str(explicit)
    if all(row.get(field) is not None for field in BTS_REQUIRED):
        return "bts_scored"
    if row.get("enplanements") is not None:
        return "enplanement_only"
    return "identity"


def is_bts_scored(row: dict[str, Any]) -> bool:
    return kpi_tier(row) == "bts_scored" and all(row.get(field) is not None for field in BTS_REQUIRED)


def airport_metrics(row: dict[str, Any]) -> dict[str, Any]:
    departures = row.get("departures")
    delayed = row.get("delayed_departures")
    cancelled = row.get("cancelled_departures")
    return {
        "enplanements": row.get("enplanements"),
        "reported_departures": departures,
        "departure_delay_rate_pct": percentage(delayed, departures) if delayed is not None and departures else None,
        "cancellation_rate_pct": percentage(cancelled, departures) if cancelled is not None and departures else None,
        "average_departure_delay_minutes": row.get("avg_departure_delay_minutes"),
        "average_taxi_out_minutes": row.get("avg_taxi_out_minutes"),
        "enplanement_growth_pct": row.get("enplanement_growth_pct"),
    }


def expansion_opportunity_score(row: dict[str, Any]) -> tuple[float | None, dict[str, float]]:
    """Return a 0-100 demand/pressure screen, not terminal utilization or ROI."""
    if not is_bts_scored(row):
        return None, {}
    metrics = airport_metrics(row)
    delay_rate = metrics["departure_delay_rate_pct"]
    cancel_rate = metrics["cancellation_rate_pct"]
    growth = metrics["enplanement_growth_pct"]
    departures = metrics["reported_departures"]
    if delay_rate is None or cancel_rate is None or growth is None or not departures:
        return None, {}
    components = {
        "passenger_growth": clamp((growth + 2) / 12 * 100),
        "departure_delay": clamp((delay_rate - 10) / 20 * 100),
        "cancellation": clamp(cancel_rate / 4 * 100),
        "activity_scale": clamp(math.log10(max(departures, 1)) / math.log10(200_000) * 100),
    }
    score = (
        0.35 * components["passenger_growth"]
        + 0.30 * components["departure_delay"]
        + 0.20 * components["cancellation"]
        + 0.15 * components["activity_scale"]
    )
    return round(score, 1), {key: round(value, 1) for key, value in components.items()}


def long_haul_share(row: dict[str, Any]) -> dict[str, Any] | None:
    if "covered_route_departures" not in row or "long_haul_departures" not in row:
        return None
    numerator, denominator = row["long_haul_departures"], row["covered_route_departures"]
    return {
        "definition": "A nonstop segment of at least 1,500 statute miles",
        "long_haul_departures": numerator,
        "covered_route_departures": denominator,
        "long_haul_share_pct": percentage(numerator, denominator),
    }


def demand_pressure_proxy(row: dict[str, Any]) -> dict[str, Any] | None:
    if not is_bts_scored(row):
        return None
    affected = row["delayed_departures"] + row["cancelled_departures"]
    return {
        "label": "schedule disruption pressure proxy",
        "affected_departures": affected,
        "reported_departures": row["departures"],
        "share_pct": percentage(affected, row["departures"]),
        "formula": "departures delayed 15+ minutes + cancelled departures",
        "caveat": "This is not measured unmet passenger demand. Estimating unmet demand requires bookings, fares, spill/recapture, and gate/terminal capacity data.",
    }

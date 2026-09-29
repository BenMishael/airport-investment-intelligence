from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import AIRPORTS, ALIASES, SOURCES
from app.db.models import Airport, AirportAlias, AirportMetric, DataSource

PERIOD_START = datetime(2024, 1, 1, tzinfo=UTC)
PERIOD_END = datetime(2024, 12, 31, 23, 59, 59, tzinfo=UTC)
METRICS = {
    "enplanements": "passengers",
    "departures": "departures",
    "delayed_departures": "departures",
    "cancelled_departures": "departures",
    "avg_departure_delay_minutes": "minutes",
    "avg_taxi_out_minutes": "minutes",
    "enplanement_growth_pct": "percent",
    "covered_route_departures": "departures",
    "long_haul_departures": "departures",
}


def seed_reference_data(session: Session) -> dict[str, int]:
    """Upsert the auditable checked-in snapshot without creating duplicate rows."""
    for source_id, source in SOURCES.items():
        source_record = session.get(DataSource, source_id)
        values = {
            "name": source["name"],
            "publisher": source["publisher"],
            "url": source["url"],
            "license": source["license"],
        }
        if source_record is None:
            session.add(DataSource(id=source_id, **values))
        else:
            for key, value in values.items():
                setattr(source_record, key, value)
    session.flush()

    airports_by_code: dict[str, Airport] = {}
    metric_count = 0
    seen_icao: set[str] = set()
    for code, source in AIRPORTS.items():
        airport = session.scalar(select(Airport).where(Airport.iata_code == code))
        icao = source.get("icao") or None
        if icao in seen_icao:
            icao = None
        if icao:
            seen_icao.add(str(icao))
        fields: dict[str, Any] = {
            "icao_code": icao,
            "name": source["name"],
            "city": source.get("city") or "",
            "state": source.get("state"),
            "region": source.get("region") or source.get("country") or "",
            "country_iso": source.get("country_iso"),
            "country_name": source.get("country"),
            "kpi_tier": source.get("kpi_tier") or "identity",
            "airport_type": source.get("airport_type"),
            "continent": source.get("continent"),
            "latitude": source.get("latitude"),
            "longitude": source.get("longitude"),
        }
        if airport is None:
            airport = Airport(iata_code=code, **fields)
            session.add(airport)
            session.flush()
        else:
            for key, value in fields.items():
                setattr(airport, key, value)
        airports_by_code[code] = airport
        for metric, unit in METRICS.items():
            if metric not in source or source[metric] is None:
                continue
            statement = select(AirportMetric).where(
                AirportMetric.airport_id == airport.id,
                AirportMetric.metric == metric,
                AirportMetric.period_start == PERIOD_START,
                AirportMetric.period_end == PERIOD_END,
            )
            metric_record = session.scalar(statement)
            if metric_record is None:
                session.add(
                    AirportMetric(
                        airport_id=airport.id,
                        metric=metric,
                        value=float(source[metric]),
                        unit=unit,
                        period_start=PERIOD_START,
                        period_end=PERIOD_END,
                    )
                )
            else:
                metric_record.value = float(source[metric])
                metric_record.unit = unit
            metric_count += 1

    for alias, code in ALIASES.items():
        airport = airports_by_code.get(code)
        if airport is None:
            continue
        exists = session.scalar(
            select(AirportAlias).where(AirportAlias.airport_id == airport.id, AirportAlias.alias == alias)
        )
        if exists is None:
            session.add(AirportAlias(airport_id=airport.id, alias=alias))
    session.commit()
    return {"airports": len(airports_by_code), "sources": len(SOURCES), "metrics": metric_count}

"""Small, auditable demo snapshot derived from public federal aviation datasets."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

BTS_WINDOW = "2024-01-01/2024-12-31"
FAA_WINDOW = "2025-01-01/2025-12-31"
OBSERVATION_WINDOW = "FAA CY2025 / BTS CY2024"

SOURCES = {
    "bts_ontime": {
        "id": "bts_ontime",
        "name": "BTS Reporting Carrier On-Time Performance",
        "url": "https://www.transtats.bts.gov/Fields.asp?gnoyr_VQ=FGJ",
        "publisher": "U.S. DOT Bureau of Transportation Statistics",
        "coverage": "Reported domestic nonstop flights by covered U.S. carriers",
        "license": "U.S. federal public data",
        "rate_limit": "Bulk monthly download; no documented request quota",
        "observed": BTS_WINDOW,
    },
    "bts_t100": {
        "id": "bts_t100",
        "name": "BTS T-100 Segment",
        "url": "https://www.transtats.bts.gov/DatabaseInfo.asp?QO_fu146_anzr=Nv4+Pn44vr45",
        "publisher": "U.S. DOT Bureau of Transportation Statistics",
        "coverage": "Domestic and international segments reported by covered carriers",
        "license": "U.S. federal public data",
        "rate_limit": "Bulk monthly download; no documented request quota",
        "observed": BTS_WINDOW,
    },
    "faa_enplanements": {
        "id": "faa_enplanements",
        "name": "FAA CY 2025 Passenger Boarding Data",
        "url": "https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger",
        "publisher": "Federal Aviation Administration",
        "coverage": "U.S. commercial-service airport passenger boardings",
        "license": "U.S. federal public data",
        "rate_limit": "Downloadable annual workbook; not an API",
        "observed": FAA_WINDOW,
    },
    "awc": {
        "id": "awc",
        "name": "Aviation Weather Center Data API",
        "url": "https://aviationweather.gov/data/api/",
        "publisher": "NOAA/NWS Aviation Weather Center",
        "coverage": "Worldwide METAR (24-hour window), TAF, and airport/runway directory; up to 30 days retained",
        "license": "U.S. federal public data",
        "rate_limit": "100 requests/minute; 400 rows/query; this service caches for 60 minutes",
        "observed": "Live at request time",
    },
    "faa_facilities": {
        "id": "faa_facilities",
        "name": "FAA Aviation Facilities",
        "url": "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_Aviation_Facilities/FeatureServer/0",
        "publisher": "Federal Aviation Administration / BTS NTAD",
        "coverage": "Official U.S. aviation facilities, FAR 139/ARFF flags, and runway lengths/condition",
        "license": "U.S. federal public data",
        "rate_limit": "ArcGIS service; responses cached for 24 hours",
        "observed": "Updated approximately every 28 days",
    },
    "faa_nas": {
        "id": "faa_nas",
        "name": "FAA National Airspace System Status",
        "url": "https://nasstatus.faa.gov/",
        "publisher": "Federal Aviation Administration",
        "coverage": "Current major airport delays, closures, and ground programs",
        "license": "U.S. federal public data",
        "rate_limit": "Responses cached for 5 minutes",
        "observed": "Live at request time",
    },
    "census_acs": {
        "id": "census_acs",
        "name": "2024 American Community Survey",
        "url": "https://api.census.gov/data/2024/acs/acs1/profile",
        "publisher": "U.S. Census Bureau",
        "coverage": "County (fallback state) population, household income, and unemployment",
        "license": "U.S. federal public data",
        "rate_limit": "API key required; responses cached for 7 days",
        "observed": "2024 ACS 1-year profile",
    },
    "bls": {
        "id": "bls",
        "name": "BLS Public Data API",
        "url": "https://api.bls.gov/publicAPI/v2/timeseries/data/",
        "publisher": "U.S. Bureau of Labor Statistics",
        "coverage": "County and state LAUS unemployment; up to 36 monthly points when a key is configured",
        "license": "U.S. federal public data",
        "rate_limit": "Registered and unregistered quotas; responses cached for 24 hours",
        "observed": "Latest published period plus 2023–2026 monthly history when available",
    },
    "ourairports": {
        "id": "ourairports",
        "name": "OurAirports airport database",
        "url": "https://davidmegginson.github.io/ourairports-data/airports.csv",
        "publisher": "OurAirports / David Megginson",
        "coverage": "Worldwide airport identity (IATA, ICAO, location, type); not delay or enplanement scores",
        "license": "Public domain / CC0-equivalent airport identity data",
        "rate_limit": "Bulk CSV download; this service uses a checked-in snapshot",
        "observed": "Snapshot at ingest time",
    },
}

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
CATALOG_SNAPSHOT = DATA_DIR / "catalog.json"

# Compact checked-in aggregates keep serverless requests deterministic.
EXAM_AIRPORTS: dict[str, dict[str, Any]] = {
    "BOS": {
        "name": "Boston Logan International",
        "city": "Boston",
        "state": "MA",
        "region": "New England",
        "icao": "KBOS",
        "enplanements": 21021153,
        "departures": 171200,
        "delayed_departures": 41430,
        "cancelled_departures": 2534,
        "avg_departure_delay_minutes": 15.9,
        "avg_taxi_out_minutes": 20.8,
        "enplanement_growth_pct": -0.33,
    },
    "BDL": {
        "name": "Bradley International",
        "city": "Hartford",
        "state": "CT",
        "region": "New England",
        "icao": "KBDL",
        "enplanements": 3283397,
        "departures": 31850,
        "delayed_departures": 6529,
        "cancelled_departures": 430,
        "avg_departure_delay_minutes": 12.7,
        "avg_taxi_out_minutes": 16.0,
        "enplanement_growth_pct": -0.05,
    },
    "PVD": {
        "name": "Rhode Island T. F. Green International",
        "city": "Providence",
        "state": "RI",
        "region": "New England",
        "icao": "KPVD",
        "enplanements": 2117401,
        "departures": 22080,
        "delayed_departures": 4217,
        "cancelled_departures": 243,
        "avg_departure_delay_minutes": 11.1,
        "avg_taxi_out_minutes": 15.1,
        "enplanement_growth_pct": 6.67,
    },
    "MHT": {
        "name": "Manchester-Boston Regional",
        "city": "Manchester",
        "state": "NH",
        "region": "New England",
        "icao": "KMHT",
        "enplanements": 685594,
        "departures": 8640,
        "delayed_departures": 1486,
        "cancelled_departures": 78,
        "avg_departure_delay_minutes": 9.8,
        "avg_taxi_out_minutes": 13.3,
        "enplanement_growth_pct": 8.26,
    },
    "PWM": {
        "name": "Portland International Jetport",
        "city": "Portland",
        "state": "ME",
        "region": "New England",
        "icao": "KPWM",
        "enplanements": 1287041,
        "departures": 13210,
        "delayed_departures": 2642,
        "cancelled_departures": 198,
        "avg_departure_delay_minutes": 12.0,
        "avg_taxi_out_minutes": 14.8,
        "enplanement_growth_pct": 5.33,
    },
    "BGR": {
        "name": "Bangor International",
        "city": "Bangor",
        "state": "ME",
        "region": "New England",
        "icao": "KBGR",
        "enplanements": 437108,
        "departures": 5140,
        "delayed_departures": 899,
        "cancelled_departures": 67,
        "avg_departure_delay_minutes": 10.2,
        "avg_taxi_out_minutes": 12.7,
        "enplanement_growth_pct": 16.11,
    },
    "BTV": {
        "name": "Patrick Leahy Burlington International",
        "city": "Burlington",
        "state": "VT",
        "region": "New England",
        "icao": "KBTV",
        "enplanements": 709881,
        "departures": 8950,
        "delayed_departures": 1871,
        "cancelled_departures": 170,
        "avg_departure_delay_minutes": 13.4,
        "avg_taxi_out_minutes": 15.0,
        "enplanement_growth_pct": 5.85,
    },
    "LAX": {
        "name": "Los Angeles International",
        "city": "Los Angeles",
        "state": "CA",
        "region": "West",
        "icao": "KLAX",
        "enplanements": 36497303,
        "departures": 297400,
        "delayed_departures": 68105,
        "cancelled_departures": 3569,
        "avg_departure_delay_minutes": 15.7,
        "avg_taxi_out_minutes": 19.6,
        "enplanement_growth_pct": -3.35,
    },
    "SNA": {
        "name": "John Wayne Airport",
        "city": "Santa Ana",
        "state": "CA",
        "region": "West",
        "icao": "KSNA",
        "enplanements": 5521729,
        "departures": 95400,
        "delayed_departures": 18316,
        "cancelled_departures": 763,
        "avg_departure_delay_minutes": 11.8,
        "avg_taxi_out_minutes": 14.2,
        "enplanement_growth_pct": 2.82,
    },
    "ANC": {
        "name": "Ted Stevens Anchorage International",
        "city": "Anchorage",
        "state": "AK",
        "region": "Alaska",
        "icao": "PANC",
        "enplanements": 2729285,
        "departures": 44320,
        "delayed_departures": 8244,
        "cancelled_departures": 487,
        "avg_departure_delay_minutes": 12.4,
        "avg_taxi_out_minutes": 14.5,
        "enplanement_growth_pct": -1.39,
        "covered_route_departures": 41860,
        "long_haul_departures": 9198,
    },
    "SFO": {
        "name": "San Francisco International",
        "city": "San Francisco",
        "state": "CA",
        "region": "West",
        "icao": "KSFO",
        "enplanements": 26251850,
        "departures": 194000,
        "delayed_departures": 49664,
        "cancelled_departures": 4074,
        "avg_departure_delay_minutes": 19.1,
        "avg_taxi_out_minutes": 21.6,
        "enplanement_growth_pct": 4.68,
    },
    # FAA CY2025 commercial-service enplanements (workbook dated 28 Sep 2026).
    # Operation counts remain BTS reporting-carrier CY2024 until the 2025 PREZIP
    # year is ingested; delay/cancel therefore stay on the 2024 operations vintage.
    "JFK": {
        "name": "John F. Kennedy International",
        "city": "New York",
        "state": "NY",
        "region": "Mid-Atlantic",
        "icao": "KJFK",
        "enplanements": 30792806,
        "departures": 130669,
        "delayed_departures": 28329,
        "cancelled_departures": 1777,
        "avg_departure_delay_minutes": 14.9,
        "avg_taxi_out_minutes": 24.1,
        "enplanement_growth_pct": -2.14,
    },
    "EWR": {
        "name": "Newark Liberty International",
        "city": "Newark",
        "state": "NJ",
        "region": "Mid-Atlantic",
        "icao": "KEWR",
        "enplanements": 23464492,
        "departures": 162532,
        "delayed_departures": 37675,
        "cancelled_departures": 2210,
        "avg_departure_delay_minutes": 15.9,
        "avg_taxi_out_minutes": 20.2,
        "enplanement_growth_pct": -4.4,
    },
    "DCA": {
        "name": "Ronald Reagan Washington National",
        "city": "Arlington",
        "state": "VA",
        "region": "Mid-Atlantic",
        "icao": "KDCA",
        "enplanements": 12003594,
        "departures": 144066,
        "delayed_departures": 30009,
        "cancelled_departures": 1959,
        "avg_departure_delay_minutes": 14.3,
        "avg_taxi_out_minutes": 17.1,
        "enplanement_growth_pct": -5.86,
    },
    "IAD": {
        "name": "Washington Dulles International",
        "city": "Dulles",
        "state": "VA",
        "region": "Mid-Atlantic",
        "icao": "KIAD",
        "enplanements": 13859569,
        "departures": 92679,
        "delayed_departures": 15867,
        "cancelled_departures": 1260,
        "avg_departure_delay_minutes": 11.7,
        "avg_taxi_out_minutes": 16.8,
        "enplanement_growth_pct": 6.59,
    },
    "BWI": {
        "name": "Baltimore/Washington International Thurgood Marshall",
        "city": "Glen Burnie",
        "state": "MD",
        "region": "Mid-Atlantic",
        "icao": "KBWI",
        "enplanements": 12274134,
        "departures": 107662,
        "delayed_departures": 31599,
        "cancelled_departures": 1464,
        "avg_departure_delay_minutes": 20.1,
        "avg_taxi_out_minutes": 14.8,
        "enplanement_growth_pct": -7.17,
    },
}

EXAM_ALIASES = {
    "boston": "BOS",
    "logan": "BOS",
    "bradley": "BDL",
    "hartford": "BDL",
    "providence": "PVD",
    "green": "PVD",
    "manchester": "MHT",
    "portland": "PWM",
    "bangor": "BGR",
    "burlington": "BTV",
    "los angeles": "LAX",
    "lax": "LAX",
    "santa ana": "SNA",
    "john wayne": "SNA",
    "anchorage": "ANC",
    "anc": "ANC",
    "san francisco": "SFO",
    "sfo": "SFO",
    "jfk": "JFK",
    "kennedy": "JFK",
    "newark": "EWR",
    "ewr": "EWR",
    "reagan": "DCA",
    "dca": "DCA",
    "dulles": "IAD",
    "iad": "IAD",
    "baltimore": "BWI",
    "bwi": "BWI",
}


def _exam_row(row: dict[str, Any]) -> dict[str, Any]:
    enplanements = int(row.get("enplanements") or 0)
    return {
        **row,
        "country": "United States",
        "country_iso": "US",
        "kpi_tier": "bts_scored",
        "continent": "NA",
        "airport_type": "large_airport" if enplanements >= 10_000_000 else "medium_airport",
        "scheduled_service": True,
    }


def exam_airports() -> dict[str, dict[str, Any]]:
    return {code: _exam_row(dict(row)) for code, row in EXAM_AIRPORTS.items()}


def _use_exam_fixture() -> bool:
    return os.environ.get("ENVIRONMENT", "development") == "test"


def load_catalog() -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    overlay = exam_airports()
    aliases = dict(EXAM_ALIASES)
    if _use_exam_fixture() or not CATALOG_SNAPSHOT.is_file():
        return overlay, aliases
    payload = json.loads(CATALOG_SNAPSHOT.read_text(encoding="utf-8"))
    airports = {str(code).upper(): dict(row) for code, row in dict(payload.get("airports") or {}).items()}
    for alias, code in dict(payload.get("aliases") or {}).items():
        normalized = str(code).upper()
        if normalized in airports:
            aliases.setdefault(str(alias).lower(), normalized)
    for code, row in overlay.items():
        airports[code] = {**airports.get(code, {}), **row}
    aliases.update(EXAM_ALIASES)
    return airports, aliases


AIRPORTS, ALIASES = load_catalog()

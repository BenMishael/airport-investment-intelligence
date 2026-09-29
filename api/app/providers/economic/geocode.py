from __future__ import annotations

from typing import Any

import httpx

from app.providers.base import ProviderResult, TTLCache

_CACHE = TTLCache()
ENDPOINT = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates"


def county_for_point(lat: float | None, lon: float | None, timeout: float = 5.0) -> dict[str, Any] | None:
    if lat is None or lon is None:
        return None
    key = f"{round(float(lat), 4)},{round(float(lon), 4)}"
    cached = _CACHE.get(key)
    if cached and cached.data:
        return dict(cached.data)
    try:
        response = httpx.get(
            ENDPOINT,
            params={
                "x": lon,
                "y": lat,
                "benchmark": "Public_AR_Current",
                "vintage": "Current_Current",
                "format": "json",
            },
            timeout=timeout,
        )
        response.raise_for_status()
        counties = ((response.json().get("result") or {}).get("geographies") or {}).get("Counties") or []
        if not counties:
            return None
        row = counties[0]
        payload = {
            "county_fips": row.get("GEOID"),
            "county_name": row.get("NAME"),
            "county": row.get("COUNTY"),
            "state_fips": row.get("STATE"),
        }
        _CACHE.set(key, ProviderResult("census_geocoder", True, payload), 7 * 24 * 3600)
        return payload
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return None

"""Keyless Aviation Weather Center API adapter with process-local TTL caching."""

from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx

_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
CACHE_SECONDS = 3600
AWC = "https://aviationweather.gov/api/data"
HEADERS = {"User-Agent": "airport-investment-intelligence-demo/0.3 (educational)"}


def _vis(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).replace("+", "").strip())
    except (TypeError, ValueError):
        return None


def _int(value: Any) -> int | None:
    try:
        if value is None or str(value).strip() == "":
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _normalize_metar(item: dict[str, Any], icao: str) -> dict[str, Any]:
    return {
        "available": True,
        "station": item.get("icaoId", icao),
        "observed_at": item.get("reportTime") or item.get("obsTime"),
        "flight_category": item.get("fltCat"),
        "temperature_c": item.get("temp"),
        "wind_speed_kt": item.get("wspd"),
        "visibility_statute_miles": item.get("visib"),
        "raw_observation": item.get("rawOb"),
    }


def _window(items: list[dict[str, Any]], hours: int) -> dict[str, Any]:
    categories: dict[str, int] = {}
    winds: list[int] = []
    visibilities: list[float] = []
    for item in items:
        cat = str(item.get("fltCat") or "unknown")
        categories[cat] = categories.get(cat, 0) + 1
        wind = _int(item.get("wspd"))
        if wind is not None:
            winds.append(wind)
        vis = _vis(item.get("visib"))
        if vis is not None:
            visibilities.append(vis)
    return {
        "hours": hours,
        "observations": len(items),
        "categories": categories,
        "ifr_or_worse": categories.get("IFR", 0) + categories.get("LIFR", 0),
        "max_wind_kt": max(winds) if winds else None,
        "min_visibility_sm": min(visibilities) if visibilities else None,
    }


def _forecast(payload: Any) -> dict[str, Any] | None:
    if not isinstance(payload, list) or not payload or not isinstance(payload[0], dict):
        return None
    taf = payload[0]
    raw_periods = taf.get("fcsts")
    periods = raw_periods if isinstance(raw_periods, list) else []
    nxt = periods[0] if periods and isinstance(periods[0], dict) else {}
    return {
        "issued_at": taf.get("issueTime"),
        "periods": len(periods),
        "raw": taf.get("rawTAF"),
        "next": {
            "from": nxt.get("timeFrom"),
            "to": nxt.get("timeTo"),
            "wind_speed_kt": nxt.get("wspd"),
            "visibility_statute_miles": nxt.get("visib"),
            "weather": nxt.get("wxString"),
            "change": nxt.get("fcstChange"),
        },
    }


def _runways(payload: Any) -> dict[str, Any] | None:
    if not isinstance(payload, list) or not payload or not isinstance(payload[0], dict):
        return None
    airport = payload[0]
    rows = []
    longest = None
    for raw in airport.get("runways") or []:
        if not isinstance(raw, dict):
            continue
        dimension = str(raw.get("dimension") or "")
        length = _int(dimension.split("x", 1)[0]) if "x" in dimension else None
        width = _int(dimension.split("x", 1)[1]) if "x" in dimension else None
        row = {
            "id": raw.get("id"),
            "length_ft": length,
            "width_ft": width,
            "surface": raw.get("surface"),
        }
        rows.append(row)
        if length is not None and (longest is None or length > longest):
            longest = length
    if not rows:
        return None
    rows.sort(key=lambda item: item.get("length_ft") or 0, reverse=True)
    return {
        "count": len(rows),
        "longest_ft": longest,
        "runways": rows,
    }


def _get(path: str, params: dict[str, Any], timeout: float) -> Any:
    response = httpx.get(f"{AWC}/{path}", params=params, headers=HEADERS, timeout=timeout)
    response.raise_for_status()
    return response.json()


def conditions_bundle(icao: str | None, *, hours: int = 24) -> dict[str, Any]:
    if not icao:
        return {"available": False, "reason": "No ICAO identifier is available."}
    now = time.time()
    cached = _CACHE.get(icao)
    if cached and cached[0] > now:
        return {**cached[1], "cache": "hit"}
    try:
        with ThreadPoolExecutor(max_workers=3, thread_name_prefix="awc") as pool:
            metar_f = pool.submit(_get, "metar", {"ids": icao, "format": "json", "hours": hours}, 6.0)
            taf_f = pool.submit(_get, "taf", {"ids": icao, "format": "json"}, 6.0)
            airport_f = pool.submit(_get, "airport", {"ids": icao, "format": "json"}, 6.0)
            metars = metar_f.result()
            try:
                taf = taf_f.result()
            except (httpx.HTTPError, json.JSONDecodeError):
                taf = None
            try:
                airport = airport_f.result()
            except (httpx.HTTPError, json.JSONDecodeError):
                airport = None
        if not isinstance(metars, list) or not metars:
            return {"available": False, "reason": "No current METAR was returned."}
        current = _normalize_metar(metars[0], icao)
        result = {
            **current,
            "window": _window(metars, hours),
            "forecast": _forecast(taf),
            "airfield": _runways(airport),
            "cache": "miss",
        }
        _CACHE[icao] = (now + CACHE_SECONDS, result)
        return result
    except httpx.TimeoutException:
        return {"available": False, "reason": "Live weather did not respond in time."}
    except (httpx.HTTPError, json.JSONDecodeError):
        return {"available": False, "reason": "Live weather is temporarily unavailable."}


def latest_metar(icao: str | None) -> dict[str, Any]:
    return conditions_bundle(icao)

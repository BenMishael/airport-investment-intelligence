from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.catalog import AIRPORTS, SOURCES
from app.core.auth import get_current_user
from app.core.config import Settings, get_settings
from app.service import compare, metric_response, public_airport, ranking
from app.services.context import airport_context
from app.weather import latest_metar

router = APIRouter(tags=["airport intelligence"], dependencies=[Depends(get_current_user)])


def _known(code: str) -> str:
    normalized = code.upper()
    if normalized not in AIRPORTS:
        raise HTTPException(404, "Airport is not in the catalog")
    return normalized


@router.get("/airports")
def airports(
    q: str | None = None,
    country: str | None = None,
    region: str | None = None,
    kpi_tier: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict:
    items = [public_airport(code) for code in sorted(AIRPORTS)]
    if q:
        query = q.lower()
        items = [item for item in items if query in " ".join(str(value or "") for value in item.values()).lower()]
    if country:
        needle = country.lower()
        items = [
            item
            for item in items
            if needle in str(item.get("country") or "").lower() or needle == str(item.get("country_iso") or "").lower()
        ]
    if region:
        needle = region.lower()
        items = [item for item in items if needle in str(item.get("region") or "").lower()]
    if kpi_tier:
        items = [item for item in items if str(item.get("kpi_tier") or "") == kpi_tier]
    total = len(items)
    page = items[offset : offset + limit]
    return {"airports": page, "count": len(page), "total": total, "limit": limit, "offset": offset}


@router.get("/airports/{code}/metrics")
def metrics(code: str) -> dict:
    return metric_response(_known(code))


@router.get("/airports/{code}/weather")
def weather(code: str) -> dict:
    normalized = _known(code)
    icao = AIRPORTS[normalized].get("icao")
    return {
        "airport": public_airport(normalized),
        "conditions": latest_metar(icao)
        if icao
        else {"available": False, "reason": "No ICAO identifier is available."},
        "source": SOURCES["awc"],
    }


@router.get("/airports/{code}/context")
def context(code: str, settings: Settings = Depends(get_settings)) -> dict:
    return airport_context(_known(code), settings)


@router.get("/compare")
def comparison(airports: str = Query(description="Comma-separated IATA codes, e.g. LAX,SNA")) -> dict:
    codes = list(dict.fromkeys(value.strip().upper() for value in airports.split(",") if value.strip()))
    if len(codes) < 2 or len(codes) > 4:
        raise HTTPException(422, "Provide between two and four airport codes")
    unknown = [code for code in codes if code not in AIRPORTS]
    if unknown:
        raise HTTPException(404, f"Unknown catalog airport(s): {', '.join(unknown)}")
    return compare(codes)


@router.get("/rankings")
def rankings(region: str = "New England", limit: int = Query(default=10, ge=1, le=25)) -> dict:
    result = ranking(region, limit)
    if not result["ranking"]:
        raise HTTPException(404, "No airports found for that region")
    return result


@router.get("/sources")
def sources() -> dict:
    return {"sources": list(SOURCES.values())}

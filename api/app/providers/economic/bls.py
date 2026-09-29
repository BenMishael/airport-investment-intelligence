from __future__ import annotations

from typing import Any

from app.providers.base import ProviderResult, ResilientHTTPProvider
from app.providers.economic.census import STATE_FIPS
from app.providers.economic.geocode import county_for_point


def _numeric(value: Any) -> float | None:
    text = str(value or "").strip()
    if not text or text in {"-", ".", "*", "N/A"}:
        return None
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _point(item: dict[str, Any]) -> dict[str, Any] | None:
    rate = _numeric(item.get("value"))
    if rate is None:
        return None
    footnotes = item.get("footnotes") or []
    note = None
    if footnotes and isinstance(footnotes[0], dict):
        note = footnotes[0].get("text") or footnotes[0].get("code")
    return {
        "unemployment_rate_pct": rate,
        "period": f"{item.get('year')}-{item.get('period')}",
        "period_name": item.get("periodName"),
        "year": item.get("year"),
        "preliminary": any(isinstance(fn, dict) and fn.get("code") == "P" for fn in footnotes),
        "footnote": note,
    }


def _points(items: Any) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        point = _point(item)
        if point:
            parsed.append(point)
    return parsed


class BLSProvider(ResilientHTTPProvider):
    provider_name = "bls_public_data"
    cache_ttl_seconds = 24 * 3600
    endpoint = "https://api.bls.gov/publicAPI/v2/timeseries/data/"

    def __init__(self, api_key: str | None, timeout: float = 5.0) -> None:
        super().__init__(timeout)
        self.api_key = api_key

    def _series_payload(self, series_ids: list[str], *, latest: bool = False) -> dict[str, Any]:
        body: dict[str, Any] = {"seriesid": series_ids}
        if latest:
            body["latest"] = True
        else:
            body["startyear"] = "2023"
            body["endyear"] = "2026"
        if self.api_key:
            body["registrationkey"] = self.api_key
        return body

    def _fetch(self, cache_key: str, series_ids: list[str], *, latest: bool) -> ProviderResult:
        def transform(payload: dict[str, Any]) -> ProviderResult:
            if payload.get("status") != "REQUEST_SUCCEEDED":
                return ProviderResult(self.provider_name, False, None, reason="BLS did not return a complete series")
            by_id = {item.get("seriesID"): item for item in (payload.get("Results") or {}).get("series") or []}
            return ProviderResult(self.provider_name, True, {"by_id": by_id, "message": payload.get("message")})

        return self.request_json(
            cache_key,
            "POST",
            self.endpoint,
            json=self._series_payload(series_ids, latest=latest),
            transform=transform,
        )

    def labor_market(
        self,
        state: str,
        lat: float | None = None,
        lon: float | None = None,
        geo: dict[str, Any] | None = None,
    ) -> ProviderResult:
        fips = STATE_FIPS.get(state.upper())
        if not fips:
            return ProviderResult(self.provider_name, False, None, reason="state mapping unavailable")
        state_id = f"LASST{fips}0000000000003"
        resolved = geo if geo is not None else county_for_point(lat, lon, self.timeout)
        county_id = f"LAUCN{resolved['county_fips']}0000000003" if resolved and resolved.get("county_fips") else None
        series_ids = [state_id] + ([county_id] if county_id else [])
        ranged = self._fetch(f"{state_id}-range", series_ids, latest=False)
        raw = ranged.data if ranged.available and isinstance(ranged.data, dict) else None
        if raw is None:
            ranged = self._fetch(f"{state_id}-latest", series_ids, latest=True)
            raw = ranged.data if ranged.available and isinstance(ranged.data, dict) else None
        if not raw:
            return ranged
        by_id = raw.get("by_id") or {}
        state_points = _points((by_id.get(state_id) or {}).get("data"))
        if not state_points:
            return ProviderResult(
                self.provider_name, False, None, reason="BLS did not return a numeric unemployment series"
            )
        latest_state = state_points[0]
        data: dict[str, Any] = {
            **latest_state,
            "series_id": state_id,
            "geography": "state",
            "history": state_points[:36],
        }
        county_points = _points((by_id.get(county_id) or {}).get("data")) if county_id else []
        if county_points:
            data["county"] = {
                **county_points[0],
                "series_id": county_id,
                "county_fips": resolved.get("county_fips") if resolved else None,
                "county_name": resolved.get("county_name") if resolved else None,
            }
            data["unemployment_rate_pct"] = data["county"]["unemployment_rate_pct"]
            data["period"] = data["county"]["period"]
            data["geography"] = "county"
            data["series_id"] = county_id
        return ProviderResult(self.provider_name, True, data, observed_at=data["period"], cache=ranged.cache)

    def state_unemployment(self, state: str) -> ProviderResult:
        return self.labor_market(state)

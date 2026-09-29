from __future__ import annotations

from typing import Any

from app.providers.base import ProviderResult, ResilientHTTPProvider
from app.providers.economic.geocode import county_for_point

STATE_FIPS = {
    "AL": "01",
    "AK": "02",
    "AZ": "04",
    "AR": "05",
    "CA": "06",
    "CO": "08",
    "CT": "09",
    "DE": "10",
    "DC": "11",
    "FL": "12",
    "GA": "13",
    "HI": "15",
    "ID": "16",
    "IL": "17",
    "IN": "18",
    "IA": "19",
    "KS": "20",
    "KY": "21",
    "LA": "22",
    "ME": "23",
    "MD": "24",
    "MA": "25",
    "MI": "26",
    "MN": "27",
    "MS": "28",
    "MO": "29",
    "MT": "30",
    "NE": "31",
    "NV": "32",
    "NH": "33",
    "NJ": "34",
    "NM": "35",
    "NY": "36",
    "NC": "37",
    "ND": "38",
    "OH": "39",
    "OK": "40",
    "OR": "41",
    "PA": "42",
    "RI": "44",
    "SC": "45",
    "SD": "46",
    "TN": "47",
    "TX": "48",
    "UT": "49",
    "VT": "50",
    "VA": "51",
    "WA": "53",
    "WV": "54",
    "WI": "55",
    "WY": "56",
    "PR": "72",
}

VARIABLES = "NAME,DP05_0001E,DP03_0062E,DP03_0009PE"


def _int(value: str | None) -> int | None:
    try:
        if value is None or str(value).strip() in {"", "-", "null"}:
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _float(value: str | None) -> float | None:
    try:
        if value is None or str(value).strip() in {"", "-", "null"}:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


class CensusProvider(ResilientHTTPProvider):
    provider_name = "census_acs"
    cache_ttl_seconds = 7 * 24 * 3600
    endpoint = "https://api.census.gov/data/2024/acs/acs1/profile"
    fallback_endpoint = "https://api.census.gov/data/2023/acs/acs1/profile"

    def __init__(self, api_key: str | None, timeout: float = 5.0) -> None:
        super().__init__(timeout)
        self.api_key = api_key

    def _profile(self, cache_key: str, params: dict[str, str], geo_level: str) -> ProviderResult:
        def transform(payload: list[list[str]], vintage: int) -> ProviderResult:
            headers, values = payload[0], payload[1]
            row = dict(zip(headers, values, strict=True))
            return ProviderResult(
                self.provider_name,
                True,
                {
                    "region": row["NAME"],
                    "geo_level": geo_level,
                    "population": _int(row.get("DP05_0001E")),
                    "median_household_income_usd": _int(row.get("DP03_0062E")),
                    "unemployment_rate_pct": _float(row.get("DP03_0009PE")),
                    "vintage": vintage,
                    "county_fips": f"{row.get('state', '')}{row.get('county', '')}" if row.get("county") else None,
                },
                observed_at=str(vintage),
            )

        query = {"get": VARIABLES, "key": self.api_key, **params}
        current = self.request_json(
            f"{cache_key}-2024",
            "GET",
            self.endpoint,
            params=query,
            transform=lambda payload: transform(payload, 2024),
        )
        if current.available or "HTTP 404" not in (current.reason or ""):
            return current
        return self.request_json(
            f"{cache_key}-2023",
            "GET",
            self.fallback_endpoint,
            params=query,
            transform=lambda payload: transform(payload, 2023),
        )

    def state_indicators(self, state: str) -> ProviderResult:
        fips = STATE_FIPS.get(state.upper())
        if not fips:
            return ProviderResult(self.provider_name, False, None, reason="state mapping unavailable")
        if not self.api_key:
            return ProviderResult(self.provider_name, False, None, reason="census api key not configured")
        return self._profile(f"{state.upper()}-state", {"for": f"state:{fips}"}, "state")

    def catchment_indicators(
        self,
        state: str,
        lat: float | None = None,
        lon: float | None = None,
        geo: dict[str, Any] | None = None,
    ) -> ProviderResult:
        if not self.api_key:
            return ProviderResult(self.provider_name, False, None, reason="census api key not configured")
        resolved = geo if geo is not None else county_for_point(lat, lon, self.timeout)
        if resolved and resolved.get("state_fips") and resolved.get("county"):
            county = self._profile(
                f"{resolved['state_fips']}{resolved['county']}-county",
                {"for": f"county:{resolved['county']}", "in": f"state:{resolved['state_fips']}"},
                "county",
            )
            if county.available and isinstance(county.data, dict):
                return ProviderResult(
                    county.provider,
                    True,
                    {
                        **county.data,
                        "county_fips": resolved.get("county_fips"),
                        "county_name": resolved.get("county_name"),
                    },
                    observed_at=county.observed_at,
                    cache=county.cache,
                )
        return self.state_indicators(state)

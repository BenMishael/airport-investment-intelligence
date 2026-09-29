from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from functools import lru_cache, partial
from typing import Any

from app.catalog import AIRPORTS, SOURCES
from app.core.config import Settings
from app.providers.aviation import FAAFacilitiesProvider, NASStatusProvider, NOAAWeatherProvider
from app.providers.base import ProviderResult
from app.providers.economic import BLSProvider, CensusProvider
from app.providers.economic.geocode import county_for_point


def _unavailable(provider: str, reason: str) -> ProviderResult:
    return ProviderResult(provider, False, None, reason=reason)


@lru_cache
def _providers(timeout: float, census_key: str | None, bls_key: str | None) -> tuple:
    return (
        FAAFacilitiesProvider(timeout),
        NASStatusProvider(timeout),
        NOAAWeatherProvider(),
        CensusProvider(census_key, timeout),
        BLSProvider(bls_key, timeout),
    )


def _test_stub_sections() -> dict[str, Any]:
    unavailable = {"available": False, "reason": "Live public APIs are disabled in test."}
    return {
        "facility": dict(unavailable),
        "weather": dict(unavailable),
        "operations": dict(unavailable),
        "regional": {"census": dict(unavailable), "labor": dict(unavailable)},
    }


def _is_united_states(airport: dict[str, Any]) -> bool:
    return str(airport.get("country_iso") or "").upper() == "US"


def collect_context_sections(code: str, settings: Settings) -> dict[str, Any]:
    if settings.environment == "test":
        return _test_stub_sections()
    airport = AIRPORTS[code]
    icao = airport.get("icao")
    timeout = settings.provider_timeout_seconds
    facilities, nas, weather, census, bls = _providers(timeout, settings.census_api_key, settings.bls_api_key)
    domestic = _is_united_states(airport)
    geo = (
        county_for_point(airport.get("latitude"), airport.get("longitude"), timeout)
        if domestic and airport.get("state")
        else None
    )
    with ThreadPoolExecutor(max_workers=5, thread_name_prefix="airport-context") as executor:
        weather_future = executor.submit(weather.current, icao) if icao else None
        facility_future = executor.submit(facilities.facility, code) if domestic else None
        operations_future = executor.submit(nas.events, code) if domestic else None
        census_future = (
            executor.submit(partial(census.catchment_indicators, airport["state"], geo=geo))
            if domestic and airport.get("state")
            else None
        )
        labor_future = (
            executor.submit(partial(bls.labor_market, airport["state"], geo=geo))
            if domestic and airport.get("state")
            else None
        )
    weather_result = (
        weather_future.result().as_dict()
        if weather_future
        else _unavailable("noaa_awc", "No ICAO identifier is available.").as_dict()
    )
    if domestic:
        facility = (
            facility_future.result().as_dict()
            if facility_future
            else _unavailable("faa_facilities", "U.S. facility lookup was skipped.").as_dict()
        )
        operations = (
            operations_future.result().as_dict()
            if operations_future
            else _unavailable("faa_nas", "U.S. NAS lookup was skipped.").as_dict()
        )
        regional_census = (
            census_future.result().as_dict()
            if census_future
            else _unavailable("census_acs", "State mapping unavailable.").as_dict()
        )
        regional_labor = (
            labor_future.result().as_dict()
            if labor_future
            else _unavailable("bls_public_data", "State mapping unavailable.").as_dict()
        )
    else:
        facility = _unavailable("faa_facilities", "FAA facilities cover U.S. airports only.").as_dict()
        operations = _unavailable("faa_nas", "FAA NAS status covers U.S. airports only.").as_dict()
        regional_census = _unavailable("census_acs", "Census ACS covers U.S. states only.").as_dict()
        regional_labor = _unavailable("bls_public_data", "BLS labor series cover U.S. states only.").as_dict()
    return {
        "facility": facility,
        "weather": weather_result,
        "operations": operations,
        "regional": {"census": regional_census, "labor": regional_labor},
    }


class LiveContextJobs:
    """Dedupe in-flight live fetches so prefetch and the final code set share work."""

    def __init__(self, settings: Settings, pool: ThreadPoolExecutor) -> None:
        self.settings = settings
        self._pool = pool
        self._futures: dict[str, Future] = {}

    def ensure(self, codes: list[str]) -> None:
        for code in codes:
            if code not in AIRPORTS or code in self._futures:
                continue
            self._futures[code] = self._pool.submit(collect_context_sections, code, self.settings)

    def gather(self, codes: list[str]) -> dict[str, Any]:
        self.ensure(codes)
        payload: dict[str, Any] = {}
        for code in codes:
            if code not in AIRPORTS:
                continue
            payload[code] = self._futures[code].result()
        return payload


def live_context_for_codes(codes: list[str], settings: Settings) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for code in codes[:2]:
        if code not in AIRPORTS:
            continue
        payload[code] = collect_context_sections(code, settings)
    return payload


def attach_live_context(evidence: dict[str, Any], live_context: dict[str, Any]) -> dict[str, Any]:
    updated = dict(evidence)
    updated["live_context"] = live_context
    return updated


def airport_context(code: str, settings: Settings) -> dict:
    from app.service import metric_response, public_airport

    sections = collect_context_sections(code, settings)
    return {
        "airport": public_airport(code),
        "screening": metric_response(code),
        "context": sections,
        "sources": [SOURCES[key] for key in ("faa_facilities", "awc", "faa_nas", "census_acs", "bls", "ourairports")],
        "partial": any(
            not section.get("available", True)
            for section in [
                sections["facility"],
                sections["weather"],
                sections["operations"],
                *sections["regional"].values(),
            ]
        ),
    }

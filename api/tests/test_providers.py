from __future__ import annotations

import httpx
import respx

from app.providers.aviation.faa_facilities import FAAFacilitiesProvider
from app.providers.economic.census import CensusProvider


@respx.mock
def test_faa_facility_normalizes_success() -> None:
    respx.get(FAAFacilitiesProvider.endpoint).mock(
        return_value=httpx.Response(
            200,
            json={
                "features": [
                    {
                        "attributes": {"ARPT_ID": "SFO", "ARPT_NAME": "San Francisco International", "CUST_FLAG": "Y"},
                        "geometry": {"x": -122.3, "y": 37.6},
                    }
                ]
            },
        )
    )
    respx.get(FAAFacilitiesProvider.runways_endpoint).mock(
        return_value=httpx.Response(
            200,
            json={
                "features": [
                    {
                        "attributes": {
                            "RWY_ID": "28L/10R",
                            "RWY_LEN": 11870,
                            "RWY_WIDTH": 200,
                            "SURFACE_TYPE_CODE": "ASPH",
                            "COND": "GOOD",
                        }
                    },
                    {
                        "attributes": {
                            "RWY_ID": "19L/01R",
                            "RWY_LEN": 8650,
                            "RWY_WIDTH": 200,
                            "SURFACE_TYPE_CODE": "ASPH",
                            "COND": "GOOD",
                        }
                    },
                ]
            },
        )
    )
    result = FAAFacilitiesProvider().facility("SFO")
    assert result.available is True
    assert result.data["iata_code"] == "SFO"
    assert result.data["customs"] == "Y"
    assert result.data["longest_runway_ft"] == 11870
    assert result.data["runway_count"] == 2


@respx.mock
def test_census_failure_degrades_explicitly() -> None:
    respx.get(CensusProvider.endpoint).mock(side_effect=httpx.ConnectError("offline"))
    result = CensusProvider("test-key").state_indicators("CA")
    assert result.available is False
    assert "provider unavailable" in (result.reason or "")


@respx.mock
def test_census_skips_without_key() -> None:
    route = respx.get(CensusProvider.endpoint)
    result = CensusProvider(None).state_indicators("CA")
    assert result.available is False
    assert result.reason == "census api key not configured"
    assert route.call_count == 0


@respx.mock
def test_census_includes_http_status() -> None:
    respx.get(CensusProvider.endpoint).mock(return_value=httpx.Response(403, json={"error": "denied"}))
    result = CensusProvider("test-key").state_indicators("CA")
    assert result.available is False
    assert "HTTP 403" in (result.reason or "")


@respx.mock
def test_census_falls_back_to_2023_on_404() -> None:
    respx.get(CensusProvider.endpoint).mock(return_value=httpx.Response(404, json={"error": "missing"}))
    respx.get(CensusProvider.fallback_endpoint).mock(
        return_value=httpx.Response(
            200,
            json=[
                ["NAME", "DP05_0001E", "DP03_0062E", "DP03_0009PE", "state"],
                ["California", "39000000", "91000", "4.1", "06"],
            ],
        )
    )
    result = CensusProvider("test-key").state_indicators("CA")
    assert result.available is True
    assert result.data["vintage"] == 2023
    assert result.data["unemployment_rate_pct"] == 4.1
    assert result.data["geo_level"] == "state"


@respx.mock
def test_census_prefers_county_catchment(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(
        "app.providers.economic.census.county_for_point",
        lambda *args, **kwargs: {"county_fips": "25025", "county": "025", "state_fips": "25", "county_name": "Suffolk"},
    )
    respx.get(CensusProvider.endpoint).mock(
        return_value=httpx.Response(
            200,
            json=[
                ["NAME", "DP05_0001E", "DP03_0062E", "DP03_0009PE", "state", "county"],
                ["Suffolk County, Massachusetts", "793144", "97195", "4.8", "25", "025"],
            ],
        )
    )
    result = CensusProvider("test-key").catchment_indicators("MA", 42.36, -71.01)
    assert result.available is True
    assert result.data["geo_level"] == "county"
    assert result.data["region"] == "Suffolk County, Massachusetts"
    assert result.data["unemployment_rate_pct"] == 4.8


@respx.mock
def test_bls_prefers_county_series(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from app.providers.economic.bls import BLSProvider

    monkeypatch.setattr(
        "app.providers.economic.bls.county_for_point",
        lambda *args, **kwargs: {"county_fips": "25025", "county_name": "Suffolk"},
    )
    respx.post(BLSProvider.endpoint).mock(
        return_value=httpx.Response(
            200,
            json={
                "status": "REQUEST_SUCCEEDED",
                "Results": {
                    "series": [
                        {
                            "seriesID": "LASST250000000000003",
                            "data": [
                                {
                                    "year": "2026",
                                    "period": "M08",
                                    "periodName": "August",
                                    "value": "4.3",
                                    "footnotes": [{"code": "P"}],
                                }
                            ],
                        },
                        {
                            "seriesID": "LAUCN250250000000003",
                            "data": [
                                {
                                    "year": "2026",
                                    "period": "M07",
                                    "periodName": "July",
                                    "value": "4.7",
                                    "footnotes": [{"code": "P"}],
                                }
                            ],
                        },
                    ]
                },
            },
        )
    )
    result = BLSProvider("test-key").labor_market("MA", 42.36, -71.01)
    assert result.available is True
    assert result.data["geography"] == "county"
    assert result.data["unemployment_rate_pct"] == 4.7
    assert result.data["county"]["unemployment_rate_pct"] == 4.7
    assert len(result.data["history"]) == 1


@respx.mock
def test_bls_skips_non_numeric_county_and_keeps_state() -> None:
    from app.providers.economic.bls import BLSProvider

    respx.post(BLSProvider.endpoint).mock(
        return_value=httpx.Response(
            200,
            json={
                "status": "REQUEST_SUCCEEDED",
                "Results": {
                    "series": [
                        {
                            "seriesID": "LASST250000000000003",
                            "data": [
                                {
                                    "year": "2026",
                                    "period": "M08",
                                    "periodName": "August",
                                    "value": "4.3",
                                    "footnotes": [{"code": "P"}],
                                }
                            ],
                        },
                        {
                            "seriesID": "LAUCN250250000000003",
                            "data": [
                                {
                                    "year": "2026",
                                    "period": "M07",
                                    "periodName": "July",
                                    "value": "-",
                                    "footnotes": [{"code": "P"}],
                                }
                            ],
                        },
                    ]
                },
            },
        )
    )
    result = BLSProvider("test-key").labor_market("MA", geo={"county_fips": "25025", "county_name": "Suffolk"})
    assert result.available is True
    assert result.data["geography"] == "state"
    assert result.data["unemployment_rate_pct"] == 4.3
    assert "county" not in result.data


@respx.mock
def test_bls_connect_error_is_public_copy() -> None:
    from app.providers.economic.bls import BLSProvider

    respx.post(BLSProvider.endpoint).mock(side_effect=httpx.ConnectError("offline"))
    result = BLSProvider("test-key").labor_market("MA")
    assert result.available is False
    assert "ValueError" not in (result.reason or "")
    assert "ConnectError" not in (result.reason or "")
    assert "could not be reached" in (result.reason or "")


@respx.mock
def test_shared_geo_skips_provider_geocode(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from app.providers.economic.bls import BLSProvider

    census_calls: list[int] = []
    bls_calls: list[int] = []
    monkeypatch.setattr(
        "app.providers.economic.census.county_for_point",
        lambda *args, **kwargs: census_calls.append(1) or None,
    )
    monkeypatch.setattr(
        "app.providers.economic.bls.county_for_point",
        lambda *args, **kwargs: bls_calls.append(1) or None,
    )
    geo = {"county_fips": "25025", "county": "025", "state_fips": "25", "county_name": "Suffolk"}
    respx.get(CensusProvider.endpoint).mock(
        return_value=httpx.Response(
            200,
            json=[
                ["NAME", "DP05_0001E", "DP03_0062E", "DP03_0009PE", "state", "county"],
                ["Suffolk County, Massachusetts", "793144", "97195", "4.8", "25", "025"],
            ],
        )
    )
    respx.post(BLSProvider.endpoint).mock(
        return_value=httpx.Response(
            200,
            json={
                "status": "REQUEST_SUCCEEDED",
                "Results": {
                    "series": [
                        {
                            "seriesID": "LASST250000000000003",
                            "data": [
                                {
                                    "year": "2026",
                                    "period": "M08",
                                    "periodName": "August",
                                    "value": "4.3",
                                    "footnotes": [{"code": "P"}],
                                }
                            ],
                        },
                        {
                            "seriesID": "LAUCN250250000000003",
                            "data": [
                                {
                                    "year": "2026",
                                    "period": "M07",
                                    "periodName": "July",
                                    "value": "4.7",
                                    "footnotes": [{"code": "P"}],
                                }
                            ],
                        },
                    ]
                },
            },
        )
    )
    census = CensusProvider("test-key").catchment_indicators("MA", geo=geo)
    labor = BLSProvider("test-key").labor_market("MA", geo=geo)
    assert census_calls == []
    assert bls_calls == []
    assert census.data["county_fips"] == "25025"
    assert labor.data["geography"] == "county"


def test_collect_context_geocodes_once_for_census_and_bls(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from app.catalog import AIRPORTS
    from app.core.config import Settings
    from app.providers.base import ProviderResult
    from app.services.context import collect_context_sections

    geo_calls: list[str] = []
    seen: list[dict] = []

    monkeypatch.setattr(
        "app.services.context.county_for_point",
        lambda *args, **kwargs: (
            geo_calls.append("geo")
            or {"county_fips": "25025", "county": "025", "state_fips": "25", "county_name": "Suffolk"}
        ),
    )

    class FakeProvider:
        def current(self, icao):  # type: ignore[no-untyped-def]
            return ProviderResult("noaa_awc", False, None, reason="skip")

        def facility(self, code):  # type: ignore[no-untyped-def]
            return ProviderResult("faa_facilities", False, None, reason="skip")

        def events(self, code):  # type: ignore[no-untyped-def]
            return ProviderResult("faa_nas", False, None, reason="skip")

        def catchment_indicators(self, state, lat=None, lon=None, geo=None):  # type: ignore[no-untyped-def]
            seen.append({"side": "census", "geo": geo})
            return ProviderResult("census_acs", True, {"ok": True})

        def labor_market(self, state, lat=None, lon=None, geo=None):  # type: ignore[no-untyped-def]
            seen.append({"side": "bls", "geo": geo})
            return ProviderResult("bls_public_data", True, {"ok": True})

    fake = FakeProvider()
    monkeypatch.setattr("app.services.context._providers", lambda *args, **kwargs: (fake, fake, fake, fake, fake))
    original = (AIRPORTS["BOS"].get("latitude"), AIRPORTS["BOS"].get("longitude"))
    AIRPORTS["BOS"]["latitude"] = 42.36
    AIRPORTS["BOS"]["longitude"] = -71.01
    try:
        settings = Settings(environment="development", census_api_key="k", bls_api_key="k")
        sections = collect_context_sections("BOS", settings)
    finally:
        if original[0] is None:
            AIRPORTS["BOS"].pop("latitude", None)
            AIRPORTS["BOS"].pop("longitude", None)
        else:
            AIRPORTS["BOS"]["latitude"], AIRPORTS["BOS"]["longitude"] = original
    assert geo_calls == ["geo"]
    assert [item["side"] for item in seen] == ["census", "bls"] or set(item["side"] for item in seen) == {
        "census",
        "bls",
    }
    assert all(item["geo"] and item["geo"]["county_fips"] == "25025" for item in seen)
    assert sections["regional"]["census"]["available"] is True
    assert sections["regional"]["labor"]["available"] is True

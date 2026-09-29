import httpx

from app import weather


def test_weather_provider_failure_is_explicit(monkeypatch) -> None:
    weather._CACHE.clear()

    def fail(*args, **kwargs):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(httpx, "get", fail)
    result = weather.latest_metar("KSFO")
    assert result["available"] is False
    assert result["reason"] == "Live weather is temporarily unavailable."
    assert "ConnectError" not in result["reason"]


def test_weather_bundle_includes_window_forecast_and_runways(monkeypatch) -> None:
    weather._CACHE.clear()

    def fake_get(url, params=None, **kwargs):
        class Response:
            def raise_for_status(self) -> None:
                return None

            def json(self):
                if "metar" in url:
                    return [
                        {
                            "icaoId": "KSFO",
                            "fltCat": "VFR",
                            "temp": 12,
                            "wspd": 8,
                            "visib": "10+",
                            "rawOb": "KSFO 000000Z",
                        },
                        {
                            "icaoId": "KSFO",
                            "fltCat": "IFR",
                            "temp": 10,
                            "wspd": 18,
                            "visib": 2,
                            "rawOb": "KSFO 010000Z",
                        },
                    ]
                if "taf" in url:
                    return [
                        {
                            "issueTime": "2026-09-29T17:20:00Z",
                            "rawTAF": "TAF KSFO",
                            "fcsts": [{"wspd": 12, "wxString": "RA"}],
                        }
                    ]
                return [{"runways": [{"id": "28L/10R", "dimension": "11870x200", "surface": "A"}]}]

        return Response()

    monkeypatch.setattr(httpx, "get", fake_get)
    result = weather.conditions_bundle("KSFO")
    assert result["available"] is True
    assert result["window"]["observations"] == 2
    assert result["window"]["ifr_or_worse"] == 1
    assert result["forecast"]["periods"] == 1
    assert result["airfield"]["longest_ft"] == 11870


def test_weather_timeout_uses_public_copy(monkeypatch) -> None:
    weather._CACHE.clear()

    def fail(*args, **kwargs):
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(httpx, "get", fail)
    result = weather.latest_metar("KBOS")
    assert result["available"] is False
    assert result["reason"] == "Live weather did not respond in time."
    assert "ReadTimeout" not in result["reason"]

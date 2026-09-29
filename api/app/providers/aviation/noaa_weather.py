from __future__ import annotations

from app.providers.base import ProviderResult
from app.weather import conditions_bundle


class NOAAWeatherProvider:
    provider_name = "noaa_awc"

    def current(self, icao: str) -> ProviderResult:
        payload = conditions_bundle(icao)
        return ProviderResult(
            self.provider_name,
            bool(payload.get("available")),
            payload if payload.get("available") else None,
            observed_at=payload.get("observed_at"),
            cache=str(payload.get("cache", "miss")),
            reason=payload.get("reason"),
        )

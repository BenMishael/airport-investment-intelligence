from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any

import httpx

from app.providers.base import ProviderResult, TTLCache, public_failure_reason


class NASStatusProvider:
    provider_name = "faa_nas_status"
    endpoint = "https://nasstatus.faa.gov/api/airport-status-information"

    def __init__(self, timeout: float = 5.0) -> None:
        self.timeout = timeout
        self.cache = TTLCache()

    def events(self, code: str) -> ProviderResult:
        cached = self.cache.get(code)
        if cached:
            return cached
        try:
            response = httpx.get(self.endpoint, headers={"Accept": "application/xml"}, timeout=self.timeout)
            response.raise_for_status()
            root = ET.fromstring(response.text)
            matches: list[dict[str, Any]] = []
            for element in root.iter():
                airport = element.findtext("ARPT")
                if airport and airport.upper() == code.upper():
                    matches.append(
                        {
                            "type": element.tag.split("}")[-1],
                            "airport": airport.upper(),
                            "reason": element.findtext("Reason"),
                            "start": element.findtext("Start"),
                            "end": element.findtext("Reopen") or element.findtext("End_Time"),
                            "average_delay": element.findtext("Avg"),
                        }
                    )
            result = ProviderResult(self.provider_name, True, matches[:10], observed_at=root.findtext("Update_Time"))
            self.cache.set(code, result, 300)
            return result
        except (httpx.HTTPError, ET.ParseError) as exc:
            return ProviderResult(
                self.provider_name, False, None, reason=f"provider unavailable: {public_failure_reason(exc)}"
            )

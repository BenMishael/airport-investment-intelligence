from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx


def public_failure_reason(exc: BaseException) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "the service did not respond in time"
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code}"
    if isinstance(exc, httpx.HTTPError):
        return "the service could not be reached"
    return "the service returned unusable data"


@dataclass(frozen=True)
class ProviderResult:
    provider: str
    available: bool
    data: dict[str, Any] | list[Any] | None
    observed_at: str | None = None
    cache: str = "miss"
    reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {key: value for key, value in self.__dict__.items() if value is not None}


class TTLCache:
    def __init__(self) -> None:
        self._values: dict[str, tuple[float, ProviderResult]] = {}

    def get(self, key: str) -> ProviderResult | None:
        cached = self._values.get(key)
        if cached and cached[0] > time.time():
            return ProviderResult(**{**cached[1].__dict__, "cache": "hit"})
        return None

    def set(self, key: str, value: ProviderResult, ttl_seconds: int) -> None:
        self._values[key] = (time.time() + ttl_seconds, value)


class ResilientHTTPProvider:
    provider_name = "external"
    cache_ttl_seconds = 3600

    def __init__(self, timeout: float = 5.0) -> None:
        self.timeout = timeout
        self.cache = TTLCache()

    def request_json(
        self, cache_key: str, method: str, url: str, *, transform: Callable[[Any], ProviderResult], **kwargs: Any
    ) -> ProviderResult:
        cached = self.cache.get(cache_key)
        if cached:
            return cached
        last_error = "unknown provider error"
        for attempt in range(2):
            try:
                response = httpx.request(method, url, timeout=self.timeout, **kwargs)
                response.raise_for_status()
                result = transform(response.json())
                self.cache.set(cache_key, result, self.cache_ttl_seconds)
                return result
            except httpx.HTTPStatusError as exc:
                last_error = public_failure_reason(exc)
                if attempt == 0:
                    time.sleep(0.1)
            except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
                last_error = public_failure_reason(exc)
                if attempt == 0:
                    time.sleep(0.1)
        return ProviderResult(self.provider_name, False, None, reason=f"provider unavailable: {last_error}")

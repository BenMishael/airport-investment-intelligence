from __future__ import annotations

from typing import Literal

from app.core.config import Settings

from .gemini import GeminiProvider
from .groq import GroqProvider
from .types import LLMProvider

ProviderName = Literal["groq", "gemini"]


def get_llm_provider(settings: Settings, *, override: ProviderName | None = None) -> LLMProvider:
    timeout = min(settings.provider_timeout_seconds + 3, 12)
    groq = GroqProvider(settings.groq_api_key, settings.groq_model, timeout=timeout)
    gemini = GeminiProvider(settings.gemini_api_key, settings.gemini_model, timeout=timeout)
    requested = override or settings.llm_provider
    if requested == "none" and override is None:
        return GroqProvider(None, settings.groq_model, timeout=timeout)
    if requested == "gemini":
        if settings.gemini_api_key:
            return gemini
        if settings.groq_api_key:
            return groq
        return gemini
    if requested == "groq":
        if settings.groq_api_key:
            return groq
        if settings.gemini_api_key:
            return gemini
        return groq
    return GroqProvider(None, settings.groq_model, timeout=timeout)

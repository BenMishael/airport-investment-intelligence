from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class LLMResult:
    value: dict[str, Any] | None
    status: str
    provider: str
    model: str
    purpose: str
    latency_ms: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None

    def run_metadata(self) -> dict[str, Any]:
        return {key: value for key, value in self.__dict__.items() if key != "value"}


class LLMProvider(Protocol):
    calls: list[LLMResult]

    def classify(self, message: str, history: list[dict[str, str]]) -> LLMResult: ...

    def explain(
        self,
        question: str,
        evidence: dict[str, Any],
        fallback: str,
        history: list[dict[str, str]] | None = None,
    ) -> LLMResult: ...

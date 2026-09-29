from __future__ import annotations

import json
import re
import time
from typing import Any

import httpx

from app.briefing import plain_memo_for_llm

from .types import LLMResult

INTENTS = ["ranking", "compare", "long_haul", "demand_pressure", "metrics", "unsupported"]


class GroqProvider:
    provider_name = "groq"
    endpoint = "https://api.groq.com/openai/v1/chat/completions"

    def __init__(self, api_key: str | None, model: str, timeout: float = 8.0) -> None:
        self.api_key, self.model, self.timeout = api_key, model, timeout
        self.calls: list[LLMResult] = []

    def _request(
        self, purpose: str, messages: list[dict[str, str]], schema: dict[str, Any], max_completion_tokens: int = 700
    ) -> LLMResult:
        if not self.api_key:
            result = LLMResult(None, "not_configured", "groq", self.model, purpose)
            self.calls.append(result)
            return result
        started = time.perf_counter()
        try:
            response = httpx.post(
                self.endpoint,
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json={
                    "model": self.model,
                    "messages": messages,
                    "temperature": 0,
                    "max_completion_tokens": max_completion_tokens,
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {"name": purpose, "strict": True, "schema": schema},
                    },
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            body = response.json()
            value = json.loads(body["choices"][0]["message"]["content"])
            usage = body.get("usage", {})
            result = LLMResult(
                value,
                "available",
                "groq",
                self.model,
                purpose,
                round((time.perf_counter() - started) * 1000),
                usage.get("prompt_tokens"),
                usage.get("completion_tokens"),
            )
        except httpx.HTTPStatusError as exc:
            result = LLMResult(
                None,
                f"unavailable:HTTP {exc.response.status_code}",
                "groq",
                self.model,
                purpose,
                round((time.perf_counter() - started) * 1000),
            )
        except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError, TypeError) as exc:
            result = LLMResult(
                None,
                f"unavailable:{type(exc).__name__}",
                "groq",
                self.model,
                purpose,
                round((time.perf_counter() - started) * 1000),
            )
        self.calls.append(result)
        return result

    def classify(self, message: str, history: list[dict[str, str]]) -> LLMResult:
        schema = {
            "type": "object",
            "properties": {
                "intent": {"type": "string", "enum": INTENTS},
                "airport_codes": {"type": "array", "items": {"type": "string", "pattern": "^[A-Z]{3}$"}, "maxItems": 4},
                "region": {"type": ["string", "null"]},
            },
            "required": ["intent", "airport_codes", "region"],
            "additionalProperties": False,
        }
        context = json.dumps(history[-4:], separators=(",", ":"))
        return self._request(
            "intent",
            [
                {
                    "role": "system",
                    "content": (
                        "Classify the airport-investment question. Never answer or calculate. "
                        "Use ranking for terminal-expansion screening. Extract IATA codes and a region or country string. "
                        "Map east coast wording to East Coast, northeast/New England to New England, west coast to West. "
                        "Do not invent IATA codes that are not present in the question. "
                        "Do not invent airports. The catalog includes U.S. commercial-service airports and international IATA identity."
                    ),
                },
                {"role": "user", "content": f"Conversation: {context}\nQuestion: {message}"},
            ],
            schema,
        )

    def explain(
        self,
        question: str,
        evidence: dict[str, Any],
        fallback: str,
        history: list[dict[str, str]] | None = None,
    ) -> LLMResult:
        schema = {
            "type": "object",
            "properties": {
                "answer": {"type": "string", "maxLength": 4000},
                "source_ids": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
            },
            "required": ["answer", "source_ids"],
            "additionalProperties": False,
        }
        recent = json.dumps((history or [])[-6:], separators=(",", ":"))
        result = self._request(
            "explanation",
            [
                {
                    "role": "system",
                    "content": (
                        "Rewrite the deterministic briefing into a professional memo with exactly these headings: "
                        "Direct answer, Evidence and method, Scope and uncertainty, and Conclusion. "
                        "Use only numbers, airport codes, and source IDs that appear in the evidence or fallback. "
                        "Preserve caveats. Do not forecast profitability or invent KPIs. Close with Conclusion."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Recent conversation: {recent}\nQuestion: {question}\n"
                        f"Deterministic briefing: {plain_memo_for_llm(fallback)}\n"
                        f"Evidence: {json.dumps(evidence, default=str, separators=(',', ':'))}"
                    ),
                },
            ],
            schema,
            max_completion_tokens=1600,
        )
        if not result.value:
            return result
        answer = str(result.value.get("answer", ""))
        evidence_text = json.dumps(evidence, default=str) + fallback
        invented_numbers = [
            token for token in re.findall(r"\b\d+(?:\.\d+)?%?\b", answer) if token.rstrip("%") not in evidence_text
        ]
        allowed_sources = set(re.findall(r'"id":\s*"([^"]+)"', evidence_text))
        returned_sources = set(map(str, result.value.get("source_ids", [])))
        if not answer or invented_numbers or not returned_sources.issubset(allowed_sources):
            invalid = LLMResult(
                None,
                "rejected_validation",
                result.provider,
                result.model,
                result.purpose,
                result.latency_ms,
                result.input_tokens,
                result.output_tokens,
            )
            self.calls[-1] = invalid
            return invalid
        return result

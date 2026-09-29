from __future__ import annotations

import json
import re
import time
from typing import Any

import httpx

from app.briefing import plain_memo_for_llm

from .groq import INTENTS
from .types import LLMResult


class GeminiProvider:
    """Explicit opt-in adapter; never used automatically after another provider fails."""

    provider_name = "gemini"

    def __init__(self, api_key: str | None, model: str, timeout: float = 8.0) -> None:
        self.api_key, self.model, self.timeout = api_key, model, timeout
        self.calls: list[LLMResult] = []

    def _request(self, purpose: str, prompt: str, schema: dict[str, Any], max_output_tokens: int = 700) -> LLMResult:
        if not self.api_key:
            result = LLMResult(None, "not_configured", "gemini", self.model, purpose)
            self.calls.append(result)
            return result
        started = time.perf_counter()
        try:
            response = httpx.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
                headers={"x-goog-api-key": self.api_key, "Content-Type": "application/json"},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "temperature": 0,
                        "maxOutputTokens": max_output_tokens,
                        "responseMimeType": "application/json",
                        "responseJsonSchema": schema,
                    },
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            body = response.json()
            value = json.loads(body["candidates"][0]["content"]["parts"][0]["text"])
            usage = body.get("usageMetadata", {})
            result = LLMResult(
                value,
                "available",
                "gemini",
                self.model,
                purpose,
                round((time.perf_counter() - started) * 1000),
                usage.get("promptTokenCount"),
                usage.get("candidatesTokenCount"),
            )
        except httpx.HTTPStatusError as exc:
            result = LLMResult(
                None,
                f"unavailable:HTTP {exc.response.status_code}",
                "gemini",
                self.model,
                purpose,
                round((time.perf_counter() - started) * 1000),
            )
        except (httpx.HTTPError, KeyError, IndexError, json.JSONDecodeError, TypeError) as exc:
            result = LLMResult(
                None,
                f"unavailable:{type(exc).__name__}",
                "gemini",
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
                "airport_codes": {"type": "array", "items": {"type": "string"}, "maxItems": 4},
                "region": {"type": ["string", "null"]},
            },
            "required": ["intent", "airport_codes", "region"],
            "additionalProperties": False,
        }
        context = json.dumps(history[-4:], separators=(",", ":"))
        prompt = (
            "Classify this airport-investment question without answering or calculating. "
            "Use ranking for terminal-expansion screening. Extract IATA codes and a region or country. "
            "Map east coast wording to East Coast and New England wording to New England. "
            "Do not invent IATA codes that are not present in the question.\n"
            f"Conversation: {context}\nQuestion: {message}"
        )
        return self._request("intent", prompt, schema)

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
        evidence_text = json.dumps(evidence, default=str, separators=(",", ":"))
        recent = json.dumps((history or [])[-6:], separators=(",", ":"))
        prompt = (
            "Rewrite the deterministic briefing into a professional memo with headings "
            "Direct answer, Evidence and method, Scope and uncertainty, and Conclusion. "
            "Use only numbers that appear in the evidence or briefing. Preserve caveats. No profitability forecasts.\n"
            f"Conversation: {recent}\nQuestion: {question}\n"
            f"Briefing: {plain_memo_for_llm(fallback)}\nEvidence: {evidence_text}"
        )
        result = self._request("explanation", prompt, schema, max_output_tokens=1600)
        if not result.value:
            return result
        answer = str(result.value.get("answer", ""))
        haystack = evidence_text + fallback
        invented = [token for token in re.findall(r"\b\d+(?:\.\d+)?%?\b", answer) if token.rstrip("%") not in haystack]
        allowed_sources = set(re.findall(r'"id":"([^"]+)"', evidence_text))
        returned_sources = set(map(str, result.value.get("source_ids", [])))
        if not answer or invented or not returned_sources.issubset(allowed_sources):
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

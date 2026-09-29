from __future__ import annotations

import threading
import time

from app.briefing import compare_briefing, metrics_briefing, ranking_briefing
from app.catalog import AIRPORTS, ALIASES
from app.providers.llm.factory import get_llm_provider
from app.providers.llm.types import LLMResult
from app.scoring import expansion_opportunity_score
from app.service import (
    _deterministic_intent,
    _prefetch_codes,
    chat,
    compare,
    metric_response,
    ranking,
    resolve_airports,
)


class FakeProvider:
    provider_name = "fake"

    def __init__(self, intent: dict | None, explanation: dict | None = None) -> None:
        self.intent = intent
        self.explanation = explanation
        self.calls: list[LLMResult] = []

    def classify(self, message: str, history: list[dict[str, str]]) -> LLMResult:
        result = LLMResult(self.intent, "available", "fake", "fake", "intent")
        self.calls.append(result)
        return result

    def explain(
        self,
        question: str,
        evidence: dict,
        fallback: str,
        history: list[dict[str, str]] | None = None,
    ) -> LLMResult:
        result = LLMResult(self.explanation, "unavailable:skipped", "fake", "fake", "explanation")
        self.calls.append(result)
        return result


def test_east_coast_ranking_uses_atlantic_scored_airports() -> None:
    payload = ranking("East Coast")
    assert payload["region"] == "East Coast"
    assert payload["ranking"]
    assert payload["ranking_mode"] == "bts_scored"
    assert payload["ranking"][0]["airport"]["code"] in AIRPORTS
    assert "Atlantic" in payload["coverage_note"]


def test_new_england_ranking_still_scoped() -> None:
    payload = ranking("New England")
    assert payload["region"] == "New England"
    codes = {row["airport"]["code"] for row in payload["ranking"]}
    assert "BOS" in codes
    assert "LAX" not in codes


def test_expansion_wording_routes_to_ranking() -> None:
    intent = _deterministic_intent(
        "which airports at the east coast in the usa will be the best candidates for terminal expansion?",
        [],
    )
    assert intent["intent"] == "ranking"
    assert intent["region"] == "East Coast"


def test_llm_unsupported_still_ranks_expansion_questions(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    provider = FakeProvider({"intent": "unsupported", "airport_codes": [], "region": "East Coast"})
    monkeypatch.setattr("app.service.get_llm_provider", lambda _settings, override=None: provider)
    result = chat(
        "which airports at the east coast in the usa will be the best candidates for terminal expansion?",
        [],
    )
    assert result["intent"] == "ranking"
    assert result["evidence"]["ranking"]
    assert "Conclusion" in result["answer"]
    assert result["ai_status"].startswith("fallback:")


def test_exam_questions_include_conclusion_and_kpis(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr("app.service.get_llm_provider", lambda _settings, override=None: FakeProvider(None))
    ranking_answer = chat("Which airports in New England are strong candidates for terminal expansion?", [])
    assert ranking_answer["intent"] == "ranking"
    assert "Conclusion" in ranking_answer["answer"]
    assert "Direct answer" in ranking_answer["answer"]
    ranked = [row["airport"]["code"] for row in ranking_answer["evidence"]["ranking"]]
    assert ranked[0] == "BGR"
    assert "BOS" in ranked
    assert "BGR" in ranking_answer["answer"]

    compare_answer = chat("Compare Los Angeles and Santa Ana airport congestion levels.", [])
    assert compare_answer["intent"] == "compare"
    assert "Conclusion" in compare_answer["answer"]
    assert "LAX" in compare_answer["answer"] and "SNA" in compare_answer["answer"]

    long_haul = chat("What percentage of flights out of Anchorage are long haul?", [])
    assert long_haul["intent"] == "long_haul"
    assert "Conclusion" in long_haul["answer"]
    assert "22.0" in long_haul["answer"] or "22%" in long_haul["answer"]

    demand = chat("What is the unmet flight demand at SFO, and why?", [])
    assert demand["intent"] == "demand_pressure"
    assert "Conclusion" in demand["answer"]
    assert "53738" in demand["answer"] or "53,738" in demand["answer"]


def test_ranking_briefing_uses_markdown_headings_and_bullets() -> None:
    payload = ranking("New England")
    text = ranking_briefing(payload, [])
    assert "## Direct answer" in text
    assert "## Evidence and method" in text
    assert "## Scope and uncertainty" in text
    assert "## Conclusion" in text
    assert "\n- **" in text
    leader = payload["ranking"][0]
    leader_code = leader["airport"]["code"]
    assert leader_code == "BGR"
    assert f"**{leader_code}**" in text
    assert any(row["airport"]["code"] == "BOS" for row in payload["ranking"])
    leader_score = leader["score"]
    assert leader_score is not None
    assert f"{leader_score:.1f}" in text or str(leader_score) in text
    parts = leader["components"]
    assert f"growth {parts['passenger_growth']}" in text
    assert f"delay {parts['departure_delay']}" in text
    assert f"cancel {parts['cancellation']}" in text
    assert f"activity {parts['activity_scale']}" in text
    assert "delayed departures" not in text.split("Evidence and method")[1].split("Scope and uncertainty")[0].lower()


def test_metrics_and_compare_briefings_cite_score_components() -> None:
    bos_score, bos_parts = expansion_opportunity_score(AIRPORTS["BOS"])
    assert bos_score is not None
    metrics_text = metrics_briefing(metric_response("BOS"), [], "BOS")
    assert f"growth {bos_parts['passenger_growth']}" in metrics_text
    assert f"delay {bos_parts['departure_delay']}" in metrics_text
    compare_text = compare_briefing(compare(["BOS", "PWM"]), [])
    assert "delayed departures" in compare_text
    assert f"Screen {bos_score}" in compare_text
    assert f"growth {bos_parts['passenger_growth']}" in compare_text
    assert f"activity {bos_parts['activity_scale']}" in compare_text


def test_as_markdown_memo_promotes_colon_headings() -> None:
    from app.briefing import as_markdown_memo, plain_memo_for_llm

    markdown = ranking_briefing(ranking("New England"), [])
    plain = plain_memo_for_llm(markdown)
    assert "## " not in plain
    assert "**" not in plain
    restored = as_markdown_memo(
        "Direct answer: BOS leads.\n\nEvidence and method: Weights.\n\nScope and uncertainty: Snapshot.\n\nConclusion: Screening only."
    )
    assert restored.startswith("## Direct answer\n\nBOS leads.")
    semicolon = as_markdown_memo(
        "Direct answer; BOS leads.\n\nEvidence and method; Weights.\n\nScope and uncertainty; Snapshot.\n\nConclusion; Screening only."
    )
    assert semicolon.startswith("## Direct answer\n\nBOS leads.")
    assert "; BOS" not in semicolon
    assert "## Conclusion" in restored
    escaped = as_markdown_memo(
        "Direct answer:\\nBOS leads.\\n\\nEvidence and method:\\nWeights.\\n\\nScope and uncertainty:\\nSnapshot.\\n\\nConclusion:\\nScreening only."
    )
    assert "\\n" not in escaped
    assert "## Evidence and method" in escaped
    assert "BOS leads." in escaped


def test_unsupported_question_is_still_a_briefing(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr("app.service.get_llm_provider", lambda _settings, override=None: FakeProvider(None))
    result = chat("What is the weather on Mars?", [])
    assert result["intent"] == "unsupported"
    assert "Conclusion" in result["answer"]
    assert "Direct answer" in result["answer"]


def test_live_context_does_not_change_scores(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr("app.service.get_llm_provider", lambda _settings, override=None: FakeProvider(None))
    baseline = ranking("New England")
    result = chat("Which airports in New England are strong candidates for terminal expansion?", [])
    live_scores = [row["score"] for row in result["evidence"]["ranking"]]
    expected = [row["score"] for row in baseline["ranking"]]
    assert live_scores == expected
    assert result["evidence"]["live_context"]
    first = next(iter(result["evidence"]["live_context"].values()))
    assert first["weather"]["available"] is False


def test_prefetch_codes_only_for_explicit_iata_intents() -> None:
    ranking_intent = _deterministic_intent(
        "Which airports in New England are strong candidates for terminal expansion?", []
    )
    assert ranking_intent["intent"] == "ranking"
    assert _prefetch_codes(ranking_intent) == []
    metrics_intent = _deterministic_intent("What are the metrics for BOS?", [])
    assert metrics_intent["intent"] == "metrics"
    assert _prefetch_codes(metrics_intent) == ["BOS"]
    compare_intent = _deterministic_intent("Compare Los Angeles and Santa Ana airport congestion levels.", [])
    assert compare_intent["intent"] == "compare"
    assert _prefetch_codes(compare_intent) == ["LAX", "SNA"]


def test_explain_runs_while_live_context_is_in_flight(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    order: list[str] = []
    started = threading.Event()
    stub = {
        "facility": {"available": False, "reason": "Live public APIs are disabled in test."},
        "weather": {"available": False, "reason": "Live public APIs are disabled in test."},
        "operations": {"available": False, "reason": "Live public APIs are disabled in test."},
        "regional": {
            "census": {"available": False, "reason": "Live public APIs are disabled in test."},
            "labor": {"available": False, "reason": "Live public APIs are disabled in test."},
        },
    }

    def slow_sections(code: str, settings) -> dict:  # type: ignore[no-untyped-def]
        started.set()
        order.append("live_start")
        time.sleep(0.15)
        order.append("live_done")
        return stub

    class RecordingProvider(FakeProvider):
        def explain(self, question, evidence, fallback, history=None):  # type: ignore[no-untyped-def]
            assert started.wait(timeout=1)
            order.append("explain")
            assert "live_context" not in evidence
            return super().explain(question, evidence, fallback, history)

    monkeypatch.setattr("app.services.context.collect_context_sections", slow_sections)
    monkeypatch.setattr("app.service.get_llm_provider", lambda _settings, override=None: RecordingProvider(None))
    result = chat("What are the metrics for BOS?", [])
    assert result["intent"] == "metrics"
    assert "BOS" in result["evidence"]["live_context"]
    assert order.index("explain") < order.index("live_done")


def test_identity_airport_has_no_expansion_score() -> None:
    AIRPORTS["LHR"] = {
        "name": "London Heathrow Airport",
        "city": "London",
        "state": None,
        "region": "United Kingdom",
        "country": "United Kingdom",
        "country_iso": "GB",
        "icao": "EGLL",
        "continent": "EU",
        "airport_type": "large_airport",
        "kpi_tier": "identity",
        "scheduled_service": True,
    }
    try:
        payload = metric_response("LHR")
        assert payload["kpi_tier"] == "identity"
        assert payload["expansion_opportunity"] is None
        assert payload["metrics"]["departure_delay_rate_pct"] is None
        identity = ranking("United Kingdom")
        assert identity["ranking_mode"] == "identity"
        assert identity["ranking"]
        assert identity["ranking"][0]["score"] is None
    finally:
        AIRPORTS.pop("LHR", None)


def test_english_the_does_not_bind_without_explicit_iata() -> None:
    AIRPORTS["THE"] = {
        "name": "Senador Petronio Portela",
        "city": "Teresina",
        "state": None,
        "region": "Brazil",
        "country": "Brazil",
        "country_iso": "BR",
        "icao": "SBTE",
        "continent": "SA",
        "airport_type": "medium_airport",
        "kpi_tier": "identity",
        "scheduled_service": True,
    }
    ALIASES["teresina"] = "THE"
    try:
        assert resolve_airports("What is the unmet demand at XYZ Mars spaceport?") == []
        assert resolve_airports("What are the metrics for THE?") == ["THE"]
        assert resolve_airports("Teresina congestion") == ["THE"]
    finally:
        AIRPORTS.pop("THE", None)
        ALIASES.pop("teresina", None)


def test_short_city_alias_does_not_bind_inside_iata() -> None:
    AIRPORTS["KBS"] = {
        "name": "Bo Airport",
        "city": "Bo",
        "state": None,
        "region": "Sierra Leone",
        "country": "Sierra Leone",
        "country_iso": "SL",
        "icao": "GFBO",
        "continent": "AF",
        "airport_type": "medium_airport",
        "kpi_tier": "identity",
        "scheduled_service": True,
    }
    ALIASES["bo"] = "KBS"
    try:
        assert resolve_airports("What are the metrics for BOS?") == ["BOS"]
        assert resolve_airports("Bo Airport congestion") == ["KBS"]
    finally:
        AIRPORTS.pop("KBS", None)
        ALIASES.pop("bo", None)


def test_metrics_question_ignores_classifier_extra_airport(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    AIRPORTS["KBS"] = {
        "name": "Bo Airport",
        "city": "Bo",
        "state": None,
        "region": "Sierra Leone",
        "country": "Sierra Leone",
        "country_iso": "SL",
        "icao": "GFBO",
        "continent": "AF",
        "airport_type": "medium_airport",
        "kpi_tier": "identity",
        "scheduled_service": True,
    }
    ALIASES["bo"] = "KBS"
    provider = FakeProvider({"intent": "compare", "airport_codes": ["BOS", "KBS"], "region": None})
    monkeypatch.setattr("app.service.get_llm_provider", lambda _settings, override=None: provider)
    try:
        result = chat("What are the metrics for BOS?", [])
        assert result["intent"] == "metrics"
        assert result["evidence"]["airport"]["code"] == "BOS"
        assert "KBS" not in (result["evidence"].get("live_context") or {})
    finally:
        AIRPORTS.pop("KBS", None)
        ALIASES.pop("bo", None)


def test_long_haul_keyword_wins_over_llm_compare(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    provider = FakeProvider({"intent": "compare", "airport_codes": ["ANC", "MAA"], "region": None})
    monkeypatch.setattr("app.service.get_llm_provider", lambda _settings, override=None: provider)
    result = chat("What percentage of flights out of Anchorage are long haul?", [])
    assert result["intent"] == "long_haul"
    assert result["evidence"]["airport"]["code"] == "ANC"


def test_ranking_live_context_ignores_classifier_extras(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    AIRPORTS["MAA"] = {
        "name": "Chennai International",
        "city": "Chennai",
        "state": None,
        "region": "India",
        "country": "India",
        "country_iso": "IN",
        "icao": "VOMM",
        "continent": "AS",
        "airport_type": "large_airport",
        "kpi_tier": "identity",
        "scheduled_service": True,
    }
    provider = FakeProvider({"intent": "ranking", "airport_codes": ["MAA"], "region": "New England"})
    monkeypatch.setattr("app.service.get_llm_provider", lambda _settings, override=None: provider)
    try:
        result = chat("Which airports in New England are strong candidates for terminal expansion?", [])
        assert result["intent"] == "ranking"
        assert "MAA" not in result["evidence"]["live_context"]
        leader = result["evidence"]["ranking"][0]["airport"]["code"]
        assert leader in result["evidence"]["live_context"]
    finally:
        AIRPORTS.pop("MAA", None)


def test_compare_one_airport_becomes_metrics(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr("app.service.get_llm_provider", lambda _settings, override=None: FakeProvider(None))
    result = chat("Compare BOS congestion.", [])
    assert result["intent"] == "metrics"
    assert result["evidence"]["airport"]["code"] == "BOS"
    assert result["evidence"]["metrics"]["departure_delay_rate_pct"] is not None


def test_east_coast_ranking_includes_jfk() -> None:
    payload = ranking("East Coast")
    codes = {row["airport"]["code"] for row in payload["ranking"]}
    assert "JFK" in codes
    assert payload["ranking"][0]["score"] is not None


def test_chat_echoes_requested_llm_provider(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr("app.service.get_llm_provider", lambda _settings, override=None: FakeProvider(None))
    groq = chat("Which airports in New England are strong candidates for terminal expansion?", [], llm_provider="groq")
    gemini = chat(
        "Which airports in New England are strong candidates for terminal expansion?", [], llm_provider="gemini"
    )
    assert groq["llm_provider"] == "groq"
    assert gemini["llm_provider"] == "gemini"
    groq_scores = [row["score"] for row in groq["evidence"]["ranking"]]
    gemini_scores = [row["score"] for row in gemini["evidence"]["ranking"]]
    assert groq_scores == gemini_scores


def test_factory_prefers_override_then_fallback_key() -> None:
    class Stub:
        groq_api_key = None
        groq_model = "openai/gpt-oss-20b"
        gemini_api_key = "gemini-test-key"
        gemini_model = "gemini-3.8-flash"
        llm_provider = "groq"
        provider_timeout_seconds = 5.0

    provider = get_llm_provider(Stub(), override="groq")  # type: ignore[arg-type]
    assert provider.provider_name == "gemini"  # type: ignore[union-attr]

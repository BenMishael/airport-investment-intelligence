"""Deterministic analysis and bounded conversational routing."""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Literal

from .briefing import as_markdown_memo, briefing
from .catalog import AIRPORTS, ALIASES, EXAM_AIRPORTS, OBSERVATION_WINDOW, SOURCES
from .core.config import get_settings
from .providers.llm import get_llm_provider
from .regions import identity_sort_key, resolve_region, scoped_airports
from .scoring import (
    airport_metrics,
    demand_pressure_proxy,
    expansion_opportunity_score,
    is_bts_scored,
    kpi_tier,
    long_haul_share,
)
from .services.context import LiveContextJobs, attach_live_context


def public_airport(code: str) -> dict[str, Any]:
    row = AIRPORTS[code]
    return {
        "code": code,
        "icao": row.get("icao"),
        "name": row.get("name"),
        "city": row.get("city"),
        "state": row.get("state"),
        "region": row.get("region"),
        "country": row.get("country"),
        "country_iso": row.get("country_iso"),
        "kpi_tier": kpi_tier(row),
        "airport_type": row.get("airport_type"),
    }


ENGLISH_IATA_STOPWORDS = frozenset(
    {
        "THE",
        "AND",
        "ARE",
        "FOR",
        "BUT",
        "CAN",
        "HAS",
        "HER",
        "HIS",
        "SHE",
        "MAY",
        "MAN",
        "GET",
        "LET",
        "PUT",
        "DAY",
        "BOY",
    }
)
KEYWORD_INTENTS = frozenset({"ranking", "long_haul", "demand_pressure"})
PREFETCH_INTENTS = frozenset({"compare", "long_haul", "demand_pressure", "metrics"})


def _explicit_iata_mention(text: str, code: str) -> bool:
    if re.search(rf"(?i)\b(?:iata|airport|code)\s+{re.escape(code)}\b", text):
        return True
    return bool(re.search(rf"\b{re.escape(code)}\b", text))


def resolve_airports(text: str) -> list[str]:
    lowered, found = text.lower(), []
    for code in AIRPORTS:
        match = re.search(rf"\b{code.lower()}\b", lowered)
        if not match:
            continue
        if code in ENGLISH_IATA_STOPWORDS and not _explicit_iata_mention(text, code):
            continue
        found.append((match.start(), code))
    for alias, code in ALIASES.items():
        if code not in AIRPORTS:
            continue
        match = re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", lowered)
        if match:
            found.append((match.start(), code))
    return list(dict.fromkeys(code for _, code in sorted(found)))


def metric_response(code: str) -> dict[str, Any]:
    row = AIRPORTS[code]
    score, components = expansion_opportunity_score(row)
    expansion = None
    if score is not None:
        expansion = {
            "score": score,
            "components": components,
            "interpretation": "Demand and operational-pressure screening signal; not terminal utilization or investment return.",
        }
    sources = [SOURCES["ourairports"]]
    if is_bts_scored(row) or row.get("enplanements") is not None:
        sources = [SOURCES["bts_ontime"], SOURCES["bts_t100"], SOURCES["faa_enplanements"], SOURCES["ourairports"]]
    return {
        "airport": public_airport(code),
        "window": OBSERVATION_WINDOW,
        "kpi_tier": kpi_tier(row),
        "metrics": airport_metrics(row),
        "expansion_opportunity": expansion,
        "long_haul": long_haul_share(row),
        "sources": sources,
        "caveats": [
            "BTS on-time coverage is limited to reporting carriers and domestic nonstop operations.",
            "Annual aggregates hide seasonality and peak-hour constraints.",
            "International IATA rows are identity-only unless a U.S. BTS overlay exists.",
        ],
    }


def ranking(region: str = "New England", limit: int = 10) -> dict[str, Any]:
    resolved = resolve_region(region)
    matches = scoped_airports(resolved)
    scored_rows: list[dict[str, Any]] = []
    identity_rows: list[dict[str, Any]] = []
    for code, airport in matches:
        if is_bts_scored(airport):
            score, components = expansion_opportunity_score(airport)
            if score is None:
                continue
            scored_rows.append(
                {
                    "airport": public_airport(code),
                    "score": score,
                    "components": components,
                    "metrics": airport_metrics(airport),
                }
            )
        else:
            identity_rows.append({"airport": public_airport(code), "score": None, "metrics": airport_metrics(airport)})
    if scored_rows:
        scored_rows.sort(key=lambda item: (-item["score"], item["airport"]["code"]))
        rows = scored_rows[:limit]
        mode = "bts_scored"
        methodology = (
            "35% passenger growth, 30% departure delay rate, 20% cancellation rate, 15% log-scaled flight activity; "
            "each component normalized to 0-100. Only bts_scored U.S. commercial-service airports are ranked."
        )
        sources = [SOURCES["bts_ontime"], SOURCES["faa_enplanements"], SOURCES["ourairports"]]
    else:
        identity_rows.sort(
            key=lambda item: identity_sort_key((item["airport"]["code"], AIRPORTS[item["airport"]["code"]]))
        )
        rows = identity_rows[:limit]
        mode = "identity"
        methodology = "Ordered by OurAirports type (large, then medium, then name). BTS expansion scores are U.S. reporting-carrier only."
        sources = [SOURCES["ourairports"]]
    payload: dict[str, Any] = {
        "region": resolved,
        "window": OBSERVATION_WINDOW,
        "ranking_mode": mode,
        "ranking": rows,
        "methodology": methodology,
        "caveat": "A screening ranking, not evidence that terminal space caused the pressure or that expansion is profitable.",
        "sources": sources,
    }
    requested = (region or "").strip()
    if requested and requested.lower() != resolved.lower():
        payload["coverage_note"] = (
            f"The query '{requested}' is screened as {resolved} using commercial-service/IATA catalog coverage; "
            "it is not a complete general-aviation inventory."
        )
    if resolved == "East Coast":
        payload["coverage_note"] = (
            "This ranking screens commercial-service airports with BTS reporting-carrier scores along the Atlantic seaboard "
            "(Maine through Florida). It is not a complete coastal inventory including general aviation."
        )
    if mode == "identity":
        payload["coverage_note"] = (
            f"No BTS-scored airports are in {resolved}. The list is identity-only from OurAirports IATA coverage."
        )
    return payload


def compare(codes: list[str]) -> dict[str, Any]:
    return {
        "window": OBSERVATION_WINDOW,
        "airports": [metric_response(code) for code in codes],
        "comparison_basis": "Reported departure delay, cancellation, average delay, taxi-out time, and activity when BTS coverage exists. These are congestion proxies, not direct gate or terminal occupancy measurements.",
    }


def _deterministic_intent(message: str, history: list[dict[str, str]]) -> dict[str, Any]:
    lowered, codes = message.lower(), resolve_airports(message)
    if not codes and history:
        for item in reversed(history):
            codes = resolve_airports(item.get("content", ""))
            if codes:
                break
    ranking_words = ("rank", "candidate", "expansion", "screening", "best airports")
    if (
        "new england" in lowered
        or "east coast" in lowered
        or "east-coast" in lowered
        or any(word in lowered for word in ranking_words)
    ):
        region = resolve_region(message)
        return {"intent": "ranking", "airport_codes": codes, "region": region}
    if len(codes) >= 2 or "compare" in lowered or "congestion" in lowered:
        return {"intent": "compare", "airport_codes": codes, "region": None}
    if "long haul" in lowered or "long-haul" in lowered:
        return {"intent": "long_haul", "airport_codes": codes, "region": None}
    if "unmet" in lowered or "demand" in lowered:
        return {"intent": "demand_pressure", "airport_codes": codes, "region": None}
    if codes:
        return {"intent": "metrics", "airport_codes": codes, "region": None}
    return {"intent": "unsupported", "airport_codes": [], "region": None}


def _catalog_codes(values: list[Any] | None) -> list[str]:
    selected: list[str] = []
    for value in values or []:
        code = str(value).upper()
        if code in AIRPORTS and code not in selected:
            selected.append(code)
    return selected


def _merge_intent(llm: dict[str, Any] | None, deterministic: dict[str, Any], message: str) -> dict[str, Any]:
    mentioned = resolve_airports(message)
    if not llm or llm.get("intent") in {None, "unsupported"}:
        return deterministic
    merged = dict(llm)
    if merged.get("region"):
        merged["region"] = resolve_region(str(merged["region"]))
    llm_codes = _catalog_codes(list(merged.get("airport_codes") or []))
    allowed = set(mentioned) | {str(code).upper() for code in deterministic.get("airport_codes") or []}
    if deterministic["intent"] in KEYWORD_INTENTS:
        codes = [code for code in llm_codes if code in allowed] or list(deterministic["airport_codes"])
        return {
            "intent": deterministic["intent"],
            "airport_codes": codes,
            "region": deterministic.get("region") or merged.get("region"),
        }
    if mentioned:
        llm_codes = [code for code in llm_codes if code in mentioned] or mentioned
    return {
        "intent": merged.get("intent") or deterministic["intent"],
        "airport_codes": llm_codes or list(deterministic["airport_codes"]),
        "region": merged.get("region") or deterministic.get("region"),
    }


def _evidence_airport_codes(evidence: dict[str, Any]) -> list[str]:
    selected: list[str] = []
    for item in evidence.get("ranking") or []:
        code = str((item.get("airport") or {}).get("code") or "")
        if code in AIRPORTS and code not in selected:
            selected.append(code)
    for item in evidence.get("airports") or []:
        code = str((item.get("airport") or {}).get("code") or "")
        if code in AIRPORTS and code not in selected:
            selected.append(code)
    nested = str((evidence.get("airport") or {}).get("code") or "")
    if nested in AIRPORTS and nested not in selected:
        selected.append(nested)
    return selected


def _live_codes(kind: str, evidence: dict[str, Any], codes: list[str]) -> list[str]:
    if kind == "ranking":
        return _evidence_airport_codes(evidence)[:2]
    if kind == "compare":
        from_evidence = _evidence_airport_codes(evidence)
        return from_evidence[:2] or _catalog_codes(codes)[:2]
    from_evidence = _evidence_airport_codes(evidence)
    if from_evidence:
        return from_evidence[:1]
    return _catalog_codes(codes)[:1]


def _prefetch_codes(deterministic: dict[str, Any]) -> list[str]:
    if deterministic.get("intent") not in PREFETCH_INTENTS:
        return []
    return _catalog_codes(list(deterministic.get("airport_codes") or []))[:2]


def _provider_label(provider: Any, override: str | None, default: str) -> str:
    name = str(getattr(provider, "provider_name", "") or "")
    if override:
        return name if name in {"groq", "gemini"} else override
    if default == "none":
        return "none"
    return name or default


def chat(
    message: str,
    history: list[dict[str, str]],
    llm_provider: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    override: Literal["groq", "gemini"] | None = None
    if llm_provider == "groq":
        override = "groq"
    elif llm_provider == "gemini":
        override = "gemini"
    provider = get_llm_provider(settings, override=override)
    deterministic = _deterministic_intent(message, history)
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="live-context") as pool:
        jobs = LiveContextJobs(settings, pool)
        jobs.ensure(_prefetch_codes(deterministic))
        intent_result = provider.classify(message, history)
        ai_status = intent_result.status
        intent = _merge_intent(
            intent_result.value if isinstance(intent_result.value, dict) else None, deterministic, message
        )
        codes = _catalog_codes(list(intent.get("airport_codes") or []))
        kind = intent.get("intent")
        if (kind == "compare" and len(codes) < 2) or (
            kind in {"long_haul", "demand_pressure", "metrics"} and not codes
        ):
            intent = deterministic
            codes = _catalog_codes(list(intent["airport_codes"]))
            kind = intent["intent"]
        if kind == "compare" and len(codes) == 1:
            kind = "metrics"
        if kind == "ranking":
            evidence = ranking(intent.get("region") or "New England")
            if not evidence["ranking"]:
                evidence = ranking("New England")
        elif kind == "compare" and len(codes) >= 2:
            evidence = compare(codes[:4])
        elif kind == "long_haul" and codes:
            evidence = metric_response(codes[0])
        elif kind == "demand_pressure" and codes:
            proxy = demand_pressure_proxy(AIRPORTS[codes[0]])
            evidence = {
                "airport": public_airport(codes[0]),
                "window": OBSERVATION_WINDOW,
                "kpi_tier": kpi_tier(AIRPORTS[codes[0]]),
                "proxy": proxy,
                "sources": [SOURCES["bts_ontime"], SOURCES["ourairports"]],
            }
        elif kind == "metrics" and codes:
            evidence = metric_response(codes[0])
        else:
            kind = "unsupported"
            counted = {"bts_scored": 0, "enplanement_only": 0, "identity": 0}
            for row in AIRPORTS.values():
                counted[kpi_tier(row)] = counted.get(kpi_tier(row), 0) + 1
            evidence = {
                "example_airports": sorted(EXAM_AIRPORTS),
                "catalog_size": len(AIRPORTS),
                "kpi_tiers": counted,
                "supported_questions": [
                    "New England expansion ranking",
                    "airport congestion comparison",
                    "Anchorage long-haul share",
                    "SFO demand-pressure proxy",
                ],
                "sources": [SOURCES["ourairports"], SOURCES["bts_ontime"], SOURCES["faa_enplanements"]],
            }
        live_codes = _live_codes(kind, evidence, codes)
        jobs.ensure(live_codes)
        answer = briefing(kind, evidence, history, codes)
        explanation = provider.explain(message, evidence, answer, history)
        if explanation.value:
            answer = as_markdown_memo(str(explanation.value["answer"]))
            ai_status = "generated"
        elif ai_status == "available":
            ai_status = f"fallback:{explanation.status}"
        evidence = attach_live_context(evidence, jobs.gather(live_codes))
    assumptions = [
        "Metrics use the checked-in FAA CY2025 / BTS CY2024 snapshot where those KPIs exist.",
        "Operational pressure does not establish a need for terminal expansion or predict profitability.",
        "Live public APIs are supplemental and never change the 0-100 score.",
    ]
    coverage_note = evidence.get("coverage_note") if isinstance(evidence, dict) else None
    if isinstance(coverage_note, str):
        assumptions.append(coverage_note)
    used_provider = _provider_label(provider, override, settings.llm_provider)
    if isinstance(evidence, dict):
        evidence["llm_provider"] = used_provider
        evidence["ai_status"] = ai_status
    return {
        "answer": answer,
        "intent": kind,
        "ai_status": ai_status,
        "llm_provider": used_provider,
        "evidence": evidence,
        "assumptions": assumptions,
        "_llm_runs": [result.run_metadata() for result in provider.calls],
    }

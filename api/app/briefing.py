"""Deterministic four-heading screening briefings built only from evidence."""

from __future__ import annotations

import re
from typing import Any

HEADINGS = ("Direct answer", "Evidence and method", "Scope and uncertainty", "Conclusion")


def _section(title: str, body: str) -> str:
    return f"## {title}\n\n{body.strip()}"


def _bullets(items: list[str]) -> str:
    return "\n".join(f"- {item}" for item in items if item.strip())


COMPONENT_LABELS = (
    ("passenger_growth", "growth"),
    ("departure_delay", "delay"),
    ("cancellation", "cancel"),
    ("activity_scale", "activity"),
)


def _component_clause(components: Any) -> str:
    if not isinstance(components, dict):
        return ""
    parts: list[str] = []
    for key, label in COMPONENT_LABELS:
        value = components.get(key)
        if value is None:
            continue
        parts.append(f"{label} {value}")
    return " · ".join(parts)


def plain_memo_for_llm(text: str) -> str:
    """Strip markdown punctuation Groq's JSON decoder cannot copy into a string field."""
    out = re.sub(r"^## ", "", text, flags=re.M)
    out = out.replace("**", "")
    return re.sub(r"^- ", "", out, flags=re.M)


def as_markdown_memo(text: str) -> str:
    """Turn the four briefing titles into markdown H2s without changing KPI wording."""
    out = text.strip()
    if "\\n" in out:
        out = out.replace("\\n", "\n")
    if "\\t" in out:
        out = out.replace("\\t", "\t")
    out = out.replace("\r\n", "\n").replace("\r", "\n")
    for title in HEADINGS:
        escaped = re.escape(title)
        out = re.sub(rf"(?m)^(?:## )?{escaped}\s*[:;]?\s*", f"## {title}\n\n", out)
    out = re.sub(r"(?m)^;\s+", "", out)
    return re.sub(r"\n{3,}", "\n\n", out).strip()


def render(direct: str, method: str, scope: str, conclusion: str) -> str:
    return "\n\n".join(
        [
            _section("Direct answer", direct),
            _section("Evidence and method", method),
            _section("Scope and uncertainty", scope),
            _section("Conclusion", conclusion),
        ]
    )


def _codes_from_history(history: list[dict[str, str]]) -> list[str]:
    found: list[str] = []
    for item in history[-6:]:
        text = item.get("content") or ""
        for token in text.replace(",", " ").split():
            code = token.strip().upper()
            if len(code) == 3 and code.isalpha() and code not in found:
                found.append(code)
    return found


def _follow_up_clause(history: list[dict[str, str]]) -> str:
    if not history:
        return ""
    prior = _codes_from_history(history)
    if prior:
        return f" Relative to the prior discussion of {', '.join(prior[-4:])},"
    return " Relative to the prior turn,"


def _tier_scope(evidence: dict[str, Any]) -> str:
    mode = evidence.get("ranking_mode")
    if mode == "identity":
        return (
            "These airports are in the identity catalog (OurAirports IATA). "
            "BTS delay, cancellation, and expansion scores exist only for U.S. reporting-carrier coverage. "
            "Live NOAA METAR, if attached, is observational context and is not a score."
        )
    return (
        "The 0-100 expansion screen mixes FAA CY2025 enplanement growth with BTS CY2024 on-time rates: "
        "35% passenger growth, 30% departure-delay rate, "
        "20% cancellation rate, and 15% log-scaled flight activity. It is not terminal utilization, gate occupancy, "
        "causation, or investment return. Live FAA/NOAA/Census/BLS context never changes that score."
    )


def ranking_briefing(evidence: dict[str, Any], history: list[dict[str, str]]) -> str:
    region = str(evidence.get("region") or "the requested region")
    rows = list(evidence.get("ranking") or [])
    follow = _follow_up_clause(history)
    coverage = evidence.get("coverage_note")
    if evidence.get("ranking_mode") == "identity":
        names = ", ".join(
            f"{item['airport']['code']} ({item['airport'].get('name')})"
            for item in rows[:5]
            if isinstance(item, dict) and item.get("airport")
        )
        direct = (
            f"BTS expansion scores are not available for {region}. The largest IATA airports in this catalog for that "
            f"place are {names or 'not present in the current snapshot'}."
        )
        method = (
            "Identity and type come from the OurAirports snapshot. Airports are ordered large, then medium, then name. "
            "No delay rate, cancellation rate, or 0-100 screen is computed because those KPIs require BTS reporting-carrier data."
        )
        scope = _tier_scope(evidence)
        if coverage:
            scope = f"{scope} {coverage}"
        conclusion = (
            f"{follow} treat this as a directory of {region} airports that can be inspected for live weather, not as a "
            "terminal-expansion ranking. Ask about a U.S. commercial-service airport or region when a scored screen is required."
        ).strip()
        return render(direct, method, scope, conclusion)

    leaders = []
    for item in rows[:3]:
        airport = item.get("airport") or {}
        score = item.get("score")
        if airport.get("code") is not None and score is not None:
            leaders.append(f"{airport['code']} ({score:.1f})")
    direct = (
        f"The strongest screening signals in {region} are {', '.join(leaders) or 'not available in this snapshot'}. "
        "Growth and reported operational pressure drive the order."
    )
    method_intro = str(evidence.get("methodology") or "35% growth, 30% delay, 20% cancel, 15% activity.")
    method_items = []
    for item in rows[:3]:
        airport = item.get("airport") or {}
        code = airport.get("code")
        if not code:
            continue
        clause = _component_clause(item.get("components"))
        score = item.get("score")
        if clause:
            method_items.append(f"**{code}** {score} — {clause}")
        else:
            method_items.append(f"**{code}** scored {score}")
    method = method_intro if not method_items else f"{method_intro}\n\n{_bullets(method_items)}"
    scope = _tier_scope(evidence)
    if coverage:
        scope = f"{scope} {coverage}"
    conclusion = (
        f"{follow} use this as a screening shortlist for {region}, then check terminal-specific constraints, peak-hour "
        "queues, and facility data before treating any airport as an expansion candidate. The ranking is not evidence that "
        "expansion would be profitable."
    ).strip()
    return render(direct, method, scope, conclusion)


def compare_briefing(evidence: dict[str, Any], history: list[dict[str, str]]) -> str:
    airports = list(evidence.get("airports") or [])
    follow = _follow_up_clause(history)
    labels = []
    details = []
    for item in airports[:4]:
        airport = item.get("airport") or {}
        metrics = item.get("metrics") or {}
        code = airport.get("code")
        if not code:
            continue
        labels.append(code)
        expansion = item.get("expansion_opportunity") or {}
        clause = _component_clause(expansion.get("components"))
        if expansion.get("score") is not None:
            detail = (
                f"**{code}** ({airport.get('kpi_tier', 'bts_scored')}) has {metrics.get('departure_delay_rate_pct')}% delayed departures, "
                f"{metrics.get('cancellation_rate_pct')}% cancellations, and {metrics.get('average_taxi_out_minutes')} average taxi-out minutes."
            )
            if clause:
                detail = f"{detail} Screen {expansion.get('score')} — {clause}."
            details.append(detail)
        else:
            details.append(
                f"**{code}** is catalogued as {airport.get('kpi_tier') or item.get('kpi_tier') or 'identity'} "
                f"in {airport.get('country') or 'an unspecified country'}; BTS delay KPIs are not attached."
            )
    detail_block = f"\n\n{_bullets(details)}" if details else ""
    if len(labels) >= 2 and airports[0].get("metrics", {}).get("departure_delay_rate_pct") is not None:
        first, second = labels[0], labels[1]
        fm, sm = airports[0]["metrics"], airports[1]["metrics"]
        if sm.get("departure_delay_rate_pct") is not None:
            leader = (
                first
                if (fm.get("departure_delay_rate_pct") or 0) >= (sm.get("departure_delay_rate_pct") or 0)
                else second
            )
            direct = (
                f"{leader} shows more reported departure-delay pressure in the BTS CY2024 snapshot among {', '.join(labels)}."
                + detail_block
            )
        else:
            direct = f"Comparison is partial because not every airport has BTS operational KPIs.{detail_block}"
    else:
        direct = (
            f"Comparison of {', '.join(labels) or 'the requested airports'} is limited to the fields each catalog row actually contains."
            f"{detail_block}"
        )
    method = str(
        evidence.get("comparison_basis")
        or "Reported departure delay, cancellation, average delay, taxi-out time, and activity when BTS coverage exists."
    )
    scope = (
        "Congestion proxies are not gate or terminal occupancy. Identity-tier airports contribute name, country, and optional "
        "live weather only. Mixed comparisons must not invent a foreign delay rate."
    )
    conclusion = (
        f"{follow} read the higher delay/cancel figures as operational pressure, then inspect live NAS/weather and facility "
        "constraints. This is not a profitability comparison."
    ).strip()
    return render(direct, method, scope, conclusion)


def long_haul_briefing(evidence: dict[str, Any], history: list[dict[str, str]], code: str) -> str:
    follow = _follow_up_clause(history)
    value = evidence.get("long_haul")
    if not value:
        direct = f"Long-haul route coverage is not available in this snapshot for {code}."
        method = "Long haul is defined as a nonstop T-100 segment of at least 1,500 statute miles with matched numerator and denominator."
        scope = "T-100 long-haul shares are ingested only where both covered and long-haul departures exist; they are not inferred."
        conclusion = f"{follow} ask about Anchorage or another airport with T-100 coverage if a long-haul share is required.".strip()
        return render(direct, method, scope, conclusion)
    direct = (
        f"{code}'s long-haul share is {value['long_haul_share_pct']}% "
        f"({value['long_haul_departures']:,} of {value['covered_route_departures']:,} covered departures)."
    )
    method = (
        f"Long haul is {str(value.get('definition') or 'a nonstop segment of at least 1,500 statute miles').lower()}."
    )
    scope = (
        "The share uses matched T-100 coverage. It is not alliance mix, widebody share, or a terminal-expansion score."
    )
    conclusion = (
        f"{follow} treat the share as route-mix evidence for {code}, then pair it with delay and growth screens if expansion "
        "is the actual question."
    ).strip()
    return render(direct, method, scope, conclusion)


def demand_briefing(evidence: dict[str, Any], history: list[dict[str, str]], code: str) -> str:
    follow = _follow_up_clause(history)
    proxy = evidence.get("proxy")
    if not proxy:
        direct = f"True unmet demand is not observable in these public operations data, and {code} has no BTS disruption proxy in this snapshot."
        method = "The schedule-disruption proxy is delayed plus cancelled reporting-carrier departures. It is computed only for bts_scored U.S. airports."
        scope = "Bookings, fares, spill/recapture, and gate/terminal capacity are not in the catalog."
        conclusion = (
            f"{follow} use a scored U.S. airport such as SFO when a numeric disruption proxy is required.".strip()
        )
        return render(direct, method, scope, conclusion)
    direct = (
        f"True unmet demand is not observable in these public operations data. For {code}, the schedule-disruption pressure "
        f"proxy is {proxy['affected_departures']:,} affected departures ({proxy['share_pct']}%)."
    )
    method = f"{proxy.get('formula')}. {proxy.get('caveat')}"
    scope = "The BTS on-time window is a CY2024 annual snapshot. Live weather or NAS events are not this proxy and do not change it."
    conclusion = (
        f"{follow} do not read {proxy['share_pct']}% as passengers who could not travel. The next check is terminal and "
        "schedule data that public delay files do not contain."
    ).strip()
    return render(direct, method, scope, conclusion)


def metrics_briefing(evidence: dict[str, Any], history: list[dict[str, str]], code: str) -> str:
    follow = _follow_up_clause(history)
    metrics = evidence.get("metrics") or {}
    tier = evidence.get("kpi_tier") or (evidence.get("airport") or {}).get("kpi_tier")
    expansion = evidence.get("expansion_opportunity") or {}
    score = expansion.get("score")
    clause = _component_clause(expansion.get("components"))
    if metrics.get("reported_departures") is not None and metrics.get("departure_delay_rate_pct") is not None:
        screen = ""
        if score is not None:
            screen = f", for an expansion screen of {score}"
            if clause:
                screen = f"{screen} ({clause})"
            screen += "."
        else:
            screen = "."
        direct = (
            f"{code} recorded {metrics['reported_departures']:,} covered departures; "
            f"{metrics['departure_delay_rate_pct']}% were delayed 15+ minutes and {metrics['cancellation_rate_pct']}% were cancelled "
            f"in the mixed FAA CY2025 / BTS CY2024 snapshot{screen}"
        )
        method = "Delay rate is delayed-15+ / reported departures; cancellation rate is cancelled / reported departures. Enplanement growth is FAA boardings."
        if clause:
            method = f"{method} The 0-100 screen components are {clause}."
    else:
        airport = evidence.get("airport") or {}
        direct = (
            f"{code} ({airport.get('name') or code}) is in the catalog as {tier or 'identity'} in "
            f"{airport.get('city') or ''} {airport.get('country') or ''}. Operational delay KPIs are not attached."
        )
        method = "Identity comes from OurAirports. Expansion scores require BTS reporting-carrier on-time counts plus FAA enplanements."
    scope = "Annual aggregates hide seasonality and peak-hour constraints. Live METAR is not a substitute for the 0-100 score."
    conclusion = f"{follow} use these figures as a screening snapshot for {code}, not as proof that terminal expansion is warranted.".strip()
    return render(direct, method, scope, conclusion)


def unsupported_briefing(evidence: dict[str, Any]) -> str:
    examples = ", ".join(str(item) for item in evidence.get("example_airports") or [])
    questions = "; ".join(str(item) for item in evidence.get("supported_questions") or [])
    size = evidence.get("catalog_size")
    direct = (
        "That question is outside the scored screening paths this agent can answer with public KPIs. "
        f"The catalog currently holds {size} airports (U.S. commercial-service plus international IATA identity)."
    )
    method = (
        f"Supported analyses include: {questions or 'regional expansion ranking, congestion comparison, long-haul share, and demand-pressure proxy'}. "
        f"Example scored U.S. airports: {examples}."
    )
    scope = (
        "Scores exist only where BTS reporting-carrier on-time data and FAA enplanements are present. "
        "International IATA airports can be named and, when NOAA has an ICAO, shown with live METAR. "
        "The model does not invent delay rates or profitability."
    )
    conclusion = (
        "Ask a ranking, comparison, long-haul, or metrics question using an IATA code or a supported region/country, "
        "and the agent will return a briefing with sources rather than a refusal line."
    )
    return render(direct, method, scope, conclusion)


def briefing(
    kind: str,
    evidence: dict[str, Any],
    history: list[dict[str, str]],
    codes: list[str],
) -> str:
    if kind == "ranking":
        return ranking_briefing(evidence, history)
    if kind == "compare":
        return compare_briefing(evidence, history)
    if kind == "long_haul":
        return long_haul_briefing(evidence, history, codes[0] if codes else "")
    if kind == "demand_pressure":
        return demand_briefing(evidence, history, codes[0] if codes else "")
    if kind == "metrics":
        return metrics_briefing(evidence, history, codes[0] if codes else "")
    return unsupported_briefing(evidence)

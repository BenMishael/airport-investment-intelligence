from app.catalog import AIRPORTS
from app.scoring import demand_pressure_proxy, expansion_opportunity_score, percentage


def test_percentage_handles_zero_denominator() -> None:
    assert percentage(4, 0) is None
    assert percentage(1, 4) == 25.0


def test_expansion_score_is_bounded_and_deterministic() -> None:
    score, components = expansion_opportunity_score(AIRPORTS["BOS"])
    assert 0 <= score <= 100
    assert score == expansion_opportunity_score(AIRPORTS["BOS"])[0]
    assert set(components) == {"passenger_growth", "departure_delay", "cancellation", "activity_scale"}
    assert AIRPORTS["BOS"]["enplanements"] == 21021153
    assert AIRPORTS["BOS"]["enplanement_growth_pct"] == -0.33


def test_sfo_proxy_adds_disjoint_outcomes() -> None:
    proxy = demand_pressure_proxy(AIRPORTS["SFO"])
    assert proxy["affected_departures"] == 53738
    assert proxy["share_pct"] == 27.7
    assert "not measured unmet" in proxy["caveat"]

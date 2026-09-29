"""Backward-compatible imports for the domain scoring module."""

from app.domain.scoring import (
    airport_metrics,
    clamp,
    demand_pressure_proxy,
    expansion_opportunity_score,
    is_bts_scored,
    kpi_tier,
    long_haul_share,
    percentage,
)

__all__ = [
    "airport_metrics",
    "clamp",
    "demand_pressure_proxy",
    "expansion_opportunity_score",
    "is_bts_scored",
    "kpi_tier",
    "long_haul_share",
    "percentage",
]

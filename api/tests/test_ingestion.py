from __future__ import annotations

from sqlalchemy import func, select

from app.db.models import Airport, AirportMetric, DataSource
from app.db.session import get_session_factory
from app.ingestion.catalog import seed_reference_data


def test_catalog_seed_is_idempotent() -> None:
    with get_session_factory()() as session:
        first = seed_reference_data(session)
        second = seed_reference_data(session)
        assert first == second
        assert session.scalar(select(func.count()).select_from(Airport)) == first["airports"]
        assert session.scalar(select(func.count()).select_from(DataSource)) == first["sources"]
        assert session.scalar(select(func.count()).select_from(AirportMetric)) == first["metrics"]

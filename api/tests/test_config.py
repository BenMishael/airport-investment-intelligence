from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_cors_origins_accepts_comma_separated_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:3000,https://airport.example.com")

    settings = Settings(_env_file=None)

    assert settings.cors_origins == ["http://localhost:3000", "https://airport.example.com"]


def test_production_rejects_local_or_auth_disabled_configuration() -> None:
    with pytest.raises(ValidationError, match="DATABASE_URL must use PostgreSQL"):
        Settings(environment="production", auth_required=False)


def test_production_accepts_explicit_secure_configuration() -> None:
    settings = Settings(
        environment="production",
        database_url="postgresql://db.example.com/postgres",
        auth_required=True,
        supabase_url="https://project.supabase.co",
        cors_origins=["https://airport.example.com"],
    )
    assert settings.docs_enabled is False

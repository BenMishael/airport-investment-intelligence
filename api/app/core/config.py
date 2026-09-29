from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    database_url: str = "sqlite:///./airport_intelligence.db"
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"]
    )
    auth_required: bool = True
    supabase_url: str | None = None
    supabase_jwt_audience: str = "authenticated"
    supabase_service_role_key: str | None = None
    groq_api_key: str | None = None
    groq_model: str = "openai/gpt-oss-20b"
    llm_provider: Literal["groq", "gemini", "none"] = "groq"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.8-flash"
    census_api_key: str | None = None
    bls_api_key: str | None = None
    log_level: str = "INFO"
    provider_timeout_seconds: float = 5.0
    conversation_retention_days: int = 30

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def validate_production_security(self) -> Settings:
        if self.environment != "production":
            return self
        errors: list[str] = []
        if self.is_sqlite:
            errors.append("DATABASE_URL must use PostgreSQL")
        if not self.auth_required:
            errors.append("AUTH_REQUIRED must be true")
        if not self.supabase_url:
            errors.append("SUPABASE_URL is required")
        if not self.cors_origins or any(origin == "*" or "localhost" in origin for origin in self.cors_origins):
            errors.append("CORS_ORIGINS must contain exact deployed origins")
        if errors:
            raise ValueError("Invalid production configuration: " + "; ".join(errors))
        return self

    @property
    def supabase_issuer(self) -> str | None:
        if not self.supabase_url:
            return None
        return f"{self.supabase_url.rstrip('/')}/auth/v1"

    @property
    def docs_enabled(self) -> bool:
        return self.environment != "production"

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()

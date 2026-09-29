from __future__ import annotations

from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings


def _sqlalchemy_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


@lru_cache
def get_engine() -> Engine:
    settings = get_settings()
    if settings.database_url == "sqlite://":
        options = {"connect_args": {"check_same_thread": False}, "poolclass": StaticPool}
    elif settings.is_sqlite:
        options = {"connect_args": {"check_same_thread": False}}
    else:
        options = {"pool_pre_ping": True}
    return create_engine(_sqlalchemy_url(settings.database_url), **options)


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    with get_session_factory()() as session:
        yield session


def initialize_local_database() -> None:
    from app.db.models import Base

    if get_settings().environment != "production":
        Base.metadata.create_all(get_engine())

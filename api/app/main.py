from __future__ import annotations

from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes import airports, auth, conversations, system
from app.catalog import AIRPORTS, CATALOG_SNAPSHOT, OBSERVATION_WINDOW
from app.core.config import get_settings
from app.core.errors import http_error, internal_error, validation_error
from app.core.logging import configure_logging
from app.core.middleware import RequestContextMiddleware
from app.db.session import get_session_factory, initialize_local_database
from app.ingestion.catalog import seed_reference_data

settings = get_settings()
configure_logging(settings.log_level, settings.environment == "production")
log = structlog.get_logger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_local_database()
    if settings.environment != "production":
        with get_session_factory()() as session:
            seed_reference_data(session)
    log.info(
        "catalog_ready",
        window=OBSERVATION_WINDOW,
        airports=len(AIRPORTS),
        snapshot=str(CATALOG_SNAPSHOT),
    )
    yield


app = FastAPI(
    title="Airport Investment Intelligence API",
    version="1.0.0",
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    lifespan=lifespan,
)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)
app.add_exception_handler(StarletteHTTPException, http_error)  # type: ignore[arg-type]
app.add_exception_handler(RequestValidationError, validation_error)  # type: ignore[arg-type]
app.add_exception_handler(Exception, internal_error)
app.include_router(system.router)
app.include_router(auth.router)
app.include_router(airports.router)
app.include_router(conversations.router)

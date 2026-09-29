from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.models import AppUser
from app.db.session import get_db

router = APIRouter(tags=["system"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": "1.0.0"}


@router.get("/ready")
def readiness(
    response: Response, session: Session = Depends(get_db), settings: Settings = Depends(get_settings)
) -> dict:
    checks: dict[str, str] = {}
    try:
        session.execute(select(func.count()).select_from(AppUser))
        checks["database"] = "ok"
    except SQLAlchemyError:
        checks["database"] = "unavailable"
    checks["authentication"] = "ok" if settings.supabase_url or not settings.auth_required else "not_configured"
    ready = all(value == "ok" for value in checks.values())
    if not ready:
        response.status_code = 503
    return {"status": "ready" if ready else "not_ready", "checks": checks}

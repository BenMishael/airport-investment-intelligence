from __future__ import annotations

import ssl
from dataclasses import dataclass
from functools import lru_cache

import certifi
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.repositories.users import UserRepository

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    id: str
    subject: str
    email: str


@lru_cache
def _jwks_client(supabase_url: str) -> PyJWKClient:
    return PyJWKClient(
        f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json",
        cache_jwk_set=True,
        lifespan=900,
        ssl_context=ssl.create_default_context(cafile=certifi.where()),
    )


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    if not settings.auth_required and settings.environment != "production":
        dev_user = UserRepository(session).upsert("00000000-0000-0000-0000-000000000001", "developer@local.test")
        session.commit()
        return CurrentUser(dev_user.id, dev_user.supabase_user_id, dev_user.email)
    if credentials is None:
        raise HTTPException(401, "Authentication is required", headers={"WWW-Authenticate": "Bearer"})
    if not settings.supabase_url or not settings.supabase_issuer:
        raise HTTPException(503, "Authentication is not configured")
    try:
        signing_key = _jwks_client(settings.supabase_url).get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            audience=settings.supabase_jwt_audience,
            issuer=settings.supabase_issuer,
            options={"require": ["exp", "sub", "email"]},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(401, "The session is invalid or expired", headers={"WWW-Authenticate": "Bearer"}) from exc
    subject, email = str(claims["sub"]), str(claims["email"]).strip().lower()
    repository = UserRepository(session)
    user = repository.allowed_by_subject(subject)
    if user is None or user.email != email:
        raise HTTPException(403, "This account is not authorized")
    repository.record_login(user, getattr(request.state, "request_id", None))
    return CurrentUser(user.id, subject, email)

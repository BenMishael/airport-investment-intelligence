from __future__ import annotations

import ssl
from types import SimpleNamespace

import jwt
from fastapi.testclient import TestClient

import app.core.auth as auth_module
from app.core.config import get_settings
from app.main import app


def test_jwks_client_uses_verified_certifi_trust_store() -> None:
    auth_module._jwks_client.cache_clear()
    try:
        client = auth_module._jwks_client("https://project.supabase.co")
        assert client.ssl_context is not None
        assert client.ssl_context.verify_mode == ssl.CERT_REQUIRED
        assert client.ssl_context.check_hostname is True
    finally:
        auth_module._jwks_client.cache_clear()


def test_protected_endpoint_rejects_missing_token_when_auth_enabled(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    get_settings.cache_clear()
    try:
        response = TestClient(app).get("/airports")
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"
    finally:
        monkeypatch.setenv("AUTH_REQUIRED", "false")
        get_settings.cache_clear()


def test_malformed_token_is_unauthorized(monkeypatch) -> None:
    class BrokenJwks:
        def get_signing_key_from_jwt(self, _: str) -> None:
            raise jwt.InvalidTokenError("invalid")

    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setattr(auth_module, "_jwks_client", lambda _: BrokenJwks())
    get_settings.cache_clear()
    try:
        response = TestClient(app).get("/airports", headers={"Authorization": "Bearer invalid"})
        assert response.status_code == 401
    finally:
        monkeypatch.setenv("AUTH_REQUIRED", "false")
        monkeypatch.delenv("SUPABASE_URL")
        get_settings.cache_clear()


def test_valid_token_for_non_allowlisted_subject_is_forbidden(monkeypatch) -> None:
    class Jwks:
        def get_signing_key_from_jwt(self, _: str) -> SimpleNamespace:
            return SimpleNamespace(key="public-key")

    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setattr(auth_module, "_jwks_client", lambda _: Jwks())
    monkeypatch.setattr(
        auth_module.jwt,
        "decode",
        lambda *args, **kwargs: {
            "sub": "ffffffff-ffff-ffff-ffff-ffffffffffff",
            "email": "removed@example.com",
            "exp": 4_102_444_800,
        },
    )
    get_settings.cache_clear()
    try:
        response = TestClient(app).get("/airports", headers={"Authorization": "Bearer valid"})
        assert response.status_code == 403
    finally:
        monkeypatch.setenv("AUTH_REQUIRED", "false")
        monkeypatch.delenv("SUPABASE_URL")
        get_settings.cache_clear()

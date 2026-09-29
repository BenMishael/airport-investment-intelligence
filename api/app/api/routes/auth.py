from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.auth import CurrentUser, get_current_user

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user)) -> dict[str, str]:
    return {"id": user.id, "email": user.email}

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AppUser, AuthAuditEvent


class UserRepository:
    def __init__(self, session: Session):
        self.session = session

    def allowed_by_subject(self, subject: str) -> AppUser | None:
        return self.session.scalar(
            select(AppUser).where(AppUser.supabase_user_id == subject, AppUser.is_allowed.is_(True))
        )

    def upsert(self, subject: str, email: str, allowed: bool = True) -> AppUser:
        email = email.strip().lower()
        user = self.session.scalar(select(AppUser).where(AppUser.supabase_user_id == subject))
        if user is None:
            user = self.session.scalar(select(AppUser).where(AppUser.email == email))
        if user is None:
            user = AppUser(supabase_user_id=subject, email=email, is_allowed=allowed)
            self.session.add(user)
        else:
            user.supabase_user_id = subject
            user.email = email
            user.is_allowed = allowed
            user.updated_at = datetime.now(UTC)
        self.session.flush()
        return user

    def disable_except(self, subjects: set[str]) -> int:
        users = self.session.scalars(select(AppUser).where(AppUser.is_allowed.is_(True))).all()
        changed = 0
        for user in users:
            if user.supabase_user_id not in subjects:
                user.is_allowed = False
                changed += 1
        return changed

    def record_login(self, user: AppUser, request_id: str | None) -> None:
        now = datetime.now(UTC)
        previous = user.last_login_at
        if previous and previous.tzinfo is None:
            previous = previous.replace(tzinfo=UTC)
        if previous and now - previous < timedelta(minutes=15):
            return
        user.last_login_at = now
        self.session.add(
            AuthAuditEvent(user_id=user.id, event_type="api_authenticated", result="allowed", request_id=request_id)
        )
        self.session.commit()

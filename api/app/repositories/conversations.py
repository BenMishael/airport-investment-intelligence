from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import Conversation, Message


class ConversationRepository:
    def __init__(self, session: Session):
        self.session = session

    def list_for_user(self, user_id: str) -> list[Conversation]:
        statement = (
            select(Conversation)
            .where(Conversation.user_id == user_id)
            .order_by(Conversation.updated_at.desc())
            .limit(100)
        )
        return list(self.session.scalars(statement))

    def get_owned(self, conversation_id: str, user_id: str) -> Conversation | None:
        statement = (
            select(Conversation)
            .options(selectinload(Conversation.messages))
            .where(Conversation.id == conversation_id, Conversation.user_id == user_id)
        )
        return self.session.scalar(statement)

    def create(self, user_id: str, title: str) -> Conversation:
        conversation = Conversation(user_id=user_id, title=title[:160])
        self.session.add(conversation)
        self.session.flush()
        return conversation

    def add_message(
        self, conversation_id: str, role: str, content: str, evidence: dict[str, Any] | None = None
    ) -> Message:
        message = Message(conversation_id=conversation_id, role=role, content=content, evidence=evidence)
        self.session.add(message)
        conversation = self.session.get(Conversation, conversation_id)
        if conversation:
            conversation.updated_at = datetime.now(UTC)
        self.session.flush()
        return message

    def delete_owned(self, conversation_id: str, user_id: str) -> bool:
        result = self.session.execute(
            delete(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user_id)
        )
        self.session.commit()
        return bool(getattr(result, "rowcount", 0))

    def purge_older_than(self, days: int) -> int:
        cutoff = datetime.now(UTC) - timedelta(days=days)
        result = self.session.execute(delete(Conversation).where(Conversation.updated_at < cutoff))
        self.session.commit()
        return int(getattr(result, "rowcount", 0) or 0)

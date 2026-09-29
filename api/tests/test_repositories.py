from __future__ import annotations

from app.db.session import get_session_factory
from app.repositories.conversations import ConversationRepository
from app.repositories.users import UserRepository


def test_conversation_access_is_scoped_to_owner() -> None:
    with get_session_factory()() as session:
        users = UserRepository(session)
        owner = users.upsert("11111111-1111-1111-1111-111111111111", "owner@example.com")
        other = users.upsert("22222222-2222-2222-2222-222222222222", "other@example.com")
        conversations = ConversationRepository(session)
        record = conversations.create(owner.id, "Private analysis")
        conversations.add_message(record.id, "user", "Compare LAX and SNA")
        session.commit()

        assert conversations.get_owned(record.id, owner.id) is not None
        assert conversations.get_owned(record.id, other.id) is None
        assert conversations.delete_owned(record.id, other.id) is False

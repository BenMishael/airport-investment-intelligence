from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.auth import CurrentUser, get_current_user
from app.db.session import get_db
from app.main import app
from app.repositories.users import UserRepository

client = TestClient(app)


@pytest.fixture
def as_user() -> Iterator:  # type: ignore[type-arg]
    def switch(subject: str, email: str) -> None:
        session = next(app.dependency_overrides.get(get_db, get_db)())
        user = UserRepository(session).upsert(subject, email)
        session.commit()
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(user.id, subject, email)

    yield switch
    app.dependency_overrides.pop(get_current_user, None)


def test_conversations_are_isolated_between_users_over_http(as_user) -> None:  # type: ignore[no-untyped-def]
    as_user("00000000-0000-0000-0000-00000000000a", "owner@example.com")
    conversation_id = client.post("/chat", json={"message": "What are the metrics for SFO?"}).json()["conversation_id"]

    as_user("00000000-0000-0000-0000-00000000000b", "intruder@example.com")
    assert conversation_id not in [item["id"] for item in client.get("/conversations").json()["conversations"]]
    assert client.get(f"/conversations/{conversation_id}").status_code == 404
    assert client.post("/chat", json={"message": "Hijack", "conversation_id": conversation_id}).status_code == 404
    assert client.delete(f"/conversations/{conversation_id}").status_code == 404

    as_user("00000000-0000-0000-0000-00000000000a", "owner@example.com")
    detail = client.get(f"/conversations/{conversation_id}").json()
    assert [message["content"] for message in detail["messages"]][0] == "What are the metrics for SFO?"
    assert len(detail["messages"]) == 2


def _assert_validation_envelope(response) -> None:  # type: ignore[no-untyped-def]
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["request_id"]


def test_chat_rejects_messages_over_one_thousand_characters() -> None:
    _assert_validation_envelope(client.post("/chat", json={"message": "A" * 1001}))


def test_chat_rejects_blank_messages() -> None:
    _assert_validation_envelope(client.post("/chat", json={"message": ""}))


def test_chat_rejects_history_items_over_four_thousand_characters() -> None:
    history = [{"role": "assistant", "content": "A" * 4001}]
    _assert_validation_envelope(client.post("/chat", json={"message": "Follow up", "history": history}))


def test_chat_rejects_more_than_twelve_history_items() -> None:
    history = [{"role": "user", "content": "Earlier question"}] * 13
    _assert_validation_envelope(client.post("/chat", json={"message": "Follow up", "history": history}))


def test_chat_rejects_malformed_conversation_ids() -> None:
    _assert_validation_envelope(client.post("/chat", json={"message": "Hello", "conversation_id": "short"}))


def test_chat_to_unknown_conversation_is_404() -> None:
    response = client.post("/chat", json={"message": "Hello", "conversation_id": "0" * 36})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_hostile_message_is_stored_verbatim_as_text() -> None:
    message = "<script>alert(1)</script> مرحبا 💺"
    created = client.post("/chat", json={"message": message}).json()
    detail = client.get(f"/conversations/{created['conversation_id']}").json()
    assert detail["messages"][0]["content"] == message
    assert detail["title"].startswith("<script>")


def test_persisted_assistant_messages_keep_assumptions_and_ai_status() -> None:
    created = client.post("/chat", json={"message": "Compare Los Angeles and Santa Ana airport congestion levels."})
    live = created.json()
    detail = client.get(f"/conversations/{live['conversation_id']}").json()
    assistant = detail["messages"][-1]
    assert assistant["assumptions"] == live["assumptions"]
    assert assistant["ai_status"] == live["ai_status"]

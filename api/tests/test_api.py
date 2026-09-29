from fastapi.testclient import TestClient

from app.catalog import EXAM_AIRPORTS
from app.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_ready_checks_database() -> None:
    response = client.get("/ready")
    assert response.status_code == 200
    assert response.json()["checks"]["database"] == "ok"


def test_current_user_is_returned() -> None:
    response = client.get("/auth/me")
    assert response.status_code == 200
    assert response.json()["email"] == "developer@local.test"


def test_new_england_ranking_has_method_and_sources() -> None:
    payload = client.get("/rankings", params={"region": "New England"}).json()
    assert payload["ranking"]
    assert payload["methodology"].startswith("35%")
    assert payload["sources"][0]["observed"] == "2024-01-01/2024-12-31"


def test_compare_lax_sna() -> None:
    response = client.get("/compare", params={"airports": "LAX,SNA"})
    assert response.status_code == 200
    assert [item["airport"]["code"] for item in response.json()["airports"]] == ["LAX", "SNA"]


def test_chat_required_questions_and_follow_up() -> None:
    questions = [
        "Which airports in New England are strong candidates for terminal expansion?",
        "Compare Los Angeles and Santa Ana airport congestion levels.",
        "What percentage of flights out of Anchorage are long haul?",
        "What is the unmet flight demand at SFO, and why?",
    ]
    intents = [client.post("/chat", json={"message": question}).json()["intent"] for question in questions]
    assert intents == ["ranking", "compare", "long_haul", "demand_pressure"]
    follow_up = client.post(
        "/chat", json={"message": "What about its delay rate?", "history": [{"role": "user", "content": questions[-1]}]}
    )
    assert follow_up.status_code == 200
    assert "SFO" in follow_up.json()["answer"]


def test_chat_is_persisted_and_can_be_deleted() -> None:
    created = client.post("/chat", json={"message": "What are the metrics for SFO?"})
    assert created.status_code == 200
    conversation_id = created.json()["conversation_id"]
    detail = client.get(f"/conversations/{conversation_id}")
    assert [message["role"] for message in detail.json()["messages"]] == ["user", "assistant"]
    assert client.delete(f"/conversations/{conversation_id}").status_code == 204
    assert client.get(f"/conversations/{conversation_id}").status_code == 404


def test_airports_list_is_paginated() -> None:
    payload = client.get("/airports", params={"limit": 5, "offset": 0}).json()
    assert payload["count"] == 5
    assert payload["total"] == len(EXAM_AIRPORTS)
    assert payload["limit"] == 5
    assert len(payload["airports"]) == 5
    assert payload["airports"][0]["kpi_tier"] == "bts_scored"


def test_unknown_airport_is_404() -> None:
    response = client.get("/airports/XYZ/metrics")
    assert response.status_code == 404
    assert set(response.json()["error"]) >= {"code", "message", "request_id"}

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, get_current_user
from app.db.models import Conversation, LLMRun
from app.db.session import get_db
from app.repositories.conversations import ConversationRepository
from app.schemas.chat import ChatRequest
from app.service import chat

router = APIRouter(tags=["conversations"])


def _message_payload(item: Any) -> dict[str, Any]:
    evidence = item.evidence if isinstance(item.evidence, dict) else item.evidence
    assumptions: list[str] = []
    ai_status: str | None = None
    if isinstance(evidence, dict):
        stored_assumptions = evidence.get("assumptions")
        if isinstance(stored_assumptions, list):
            assumptions = [value for value in stored_assumptions if isinstance(value, str)]
        stored_status = evidence.get("ai_status")
        if isinstance(stored_status, str):
            ai_status = stored_status
    return {
        "id": item.id,
        "role": item.role,
        "content": item.content,
        "evidence": evidence,
        "assumptions": assumptions,
        "ai_status": ai_status,
        "created_at": item.created_at,
    }


def _conversation_payload(conversation: Conversation) -> dict[str, Any]:
    return {
        "id": conversation.id,
        "title": conversation.title,
        "created_at": conversation.created_at,
        "updated_at": conversation.updated_at,
        "messages": [_message_payload(item) for item in conversation.messages],
    }


@router.post("/chat")
def conversation(
    request: ChatRequest, user: CurrentUser = Depends(get_current_user), session: Session = Depends(get_db)
) -> dict:
    repository = ConversationRepository(session)
    record = repository.get_owned(request.conversation_id, user.id) if request.conversation_id else None
    if request.conversation_id and record is None:
        raise HTTPException(404, "Conversation was not found")
    if record is None:
        record = repository.create(user.id, request.message)
    persisted_history = [{"role": item.role, "content": item.content} for item in record.messages[-12:]]
    history = persisted_history or [item.model_dump() for item in request.history]
    user_message = repository.add_message(record.id, "user", request.message)
    result = chat(request.message, history, llm_provider=request.llm_provider)
    run_metadata = result.pop("_llm_runs", [])
    stored_evidence = dict(result.get("evidence") or {}) if isinstance(result.get("evidence"), dict) else {}
    stored_evidence["assumptions"] = result.get("assumptions") or []
    stored_evidence["ai_status"] = result.get("ai_status")
    assistant_message = repository.add_message(record.id, "assistant", result["answer"], stored_evidence)
    for run in run_metadata:
        session.add(LLMRun(conversation_id=record.id, **run))
    session.commit()
    return {
        **result,
        "conversation_id": record.id,
        "message_id": assistant_message.id,
        "user_message_id": user_message.id,
    }


@router.get("/conversations")
def list_conversations(user: CurrentUser = Depends(get_current_user), session: Session = Depends(get_db)) -> dict:
    records = ConversationRepository(session).list_for_user(user.id)
    return {
        "conversations": [
            {"id": item.id, "title": item.title, "created_at": item.created_at, "updated_at": item.updated_at}
            for item in records
        ]
    }


@router.get("/conversations/{conversation_id}")
def get_conversation(
    conversation_id: str, user: CurrentUser = Depends(get_current_user), session: Session = Depends(get_db)
) -> dict:
    record = ConversationRepository(session).get_owned(conversation_id, user.id)
    if record is None:
        raise HTTPException(404, "Conversation was not found")
    return _conversation_payload(record)


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: str, user: CurrentUser = Depends(get_current_user), session: Session = Depends(get_db)
) -> Response:
    if not ConversationRepository(session).delete_owned(conversation_id, user.id):
        raise HTTPException(404, "Conversation was not found")
    return Response(status_code=204)

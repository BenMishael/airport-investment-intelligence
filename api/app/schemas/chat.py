from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class HistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    history: list[HistoryItem] = Field(default_factory=list, max_length=12)
    conversation_id: str | None = Field(default=None, min_length=36, max_length=36)
    llm_provider: Literal["groq", "gemini"] | None = None

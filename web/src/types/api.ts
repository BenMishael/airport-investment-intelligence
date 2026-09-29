export type Source = { id: string; name: string; url: string; observed: string };

export type LlmProvider = "groq" | "gemini";

export type ChatRequest = {
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  conversation_id?: string;
  llm_provider?: LlmProvider;
};

export type ChatResponse = {
  answer: string;
  intent: string;
  ai_status: string;
  llm_provider?: LlmProvider | "none";
  evidence: Record<string, unknown>;
  assumptions: string[];
  conversation_id: string;
  message_id: string;
  user_message_id: string;
};

export type Message = { role: "user" | "assistant"; content: string; response?: ChatResponse };
export type ConversationSummary = { id: string; title: string; created_at: string; updated_at: string };
export type ConversationDetail = ConversationSummary & {
  messages?: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    evidence?: Record<string, unknown>;
    assumptions?: string[];
    ai_status?: string;
    created_at: string;
  }>;
};

export type ApiErrorEnvelope = { error?: { code?: string; message?: string; request_id?: string } };

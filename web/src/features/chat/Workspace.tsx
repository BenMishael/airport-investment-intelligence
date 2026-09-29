"use client";

import {
  ArrowRight,
  ChatCircleDots,
  ClockCounterClockwise,
  Microphone,
  PaperPlaneTilt,
  Plus,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { AnimatePresence, LayoutGroup, m, useReducedMotion } from "motion/react";
import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { MotionAsset } from "@/components/motion/MotionAsset";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ApiError, apiFetch, describeApiFailure } from "@/lib/api/client";
import { ChatRequest, ChatResponse, ConversationDetail, ConversationSummary, Message } from "@/types/api";
import { Evidence } from "./evidence";
import { MarkdownAnswer } from "./MarkdownAnswer";
import { LlmProviderToggle, useLlmProvider } from "./LlmProviderToggle";
import { joinDictation, QUESTION_MAX_LENGTH, useSpeechDictation } from "./useSpeechDictation";
import styles from "./Workspace.module.css";

const prompts = [
  { category: "Expansion", text: "Which airports in New England are strong candidates for terminal expansion?" },
  { category: "Comparison", text: "Compare Los Angeles and Santa Ana airport congestion levels." },
  { category: "Route mix", text: "What percentage of flights out of Anchorage are long haul?" },
  { category: "Demand", text: "What is the unmet flight demand at SFO, and why?" },
];

function persistedResponse(
  item: NonNullable<ConversationDetail["messages"]>[number],
  conversationId: string,
): ChatResponse | undefined {
  if (item.role !== "assistant") return undefined;
  const evidence =
    item.evidence && typeof item.evidence === "object" && !Array.isArray(item.evidence) ? item.evidence : {};
  const nestedAssumptions = Array.isArray(evidence.assumptions)
    ? evidence.assumptions.filter((value): value is string => typeof value === "string")
    : [];
  return {
    answer: item.content,
    evidence,
    intent: "persisted",
    ai_status:
      typeof item.ai_status === "string"
        ? item.ai_status
        : typeof evidence.ai_status === "string"
          ? evidence.ai_status
          : "persisted",
    llm_provider:
      evidence.llm_provider === "groq" || evidence.llm_provider === "gemini" || evidence.llm_provider === "none"
        ? evidence.llm_provider
        : undefined,
    assumptions: Array.isArray(item.assumptions)
      ? item.assumptions.filter((value): value is string => typeof value === "string")
      : nestedAssumptions,
    conversation_id: conversationId,
    message_id: item.id,
    user_message_id: "",
  };
}

function normalizeChatResponse(response: ChatResponse): ChatResponse {
  return {
    ...response,
    answer: response.answer || "",
    evidence: response.evidence && typeof response.evidence === "object" ? response.evidence : {},
    ai_status: typeof response.ai_status === "string" ? response.ai_status : "unavailable",
    llm_provider: response.llm_provider,
    assumptions: Array.isArray(response.assumptions)
      ? response.assumptions.filter((value): value is string => typeof value === "string")
      : [],
    conversation_id: response.conversation_id || "",
    message_id: response.message_id || "",
    user_message_id: response.user_message_id || "",
  };
}

type WorkspaceProps = {
  accessToken: string;
  onUnauthorized: () => void;
  historyOpen: boolean;
  onHistoryOpenChange: (open: boolean) => void;
  onActiveChange: (active: boolean) => void;
  intro?: ReactNode;
};

export function Workspace({
  accessToken,
  onUnauthorized,
  historyOpen,
  onHistoryOpenChange,
  onActiveChange,
  intro,
}: WorkspaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [showAllPrompts, setShowAllPrompts] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary>();
  const [llmProvider, setLlmProvider] = useLlmProvider();
  const formRef = useRef<HTMLFormElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const askingRef = useRef(false);
  const openRequestRef = useRef(0);
  const restoreFromHistoryRef = useRef(false);
  const dictationBaseRef = useRef("");
  const reduced = useReducedMotion();
  const {
    supported: dictationSupported,
    listening,
    requesting: dictationRequesting,
    error: dictationError,
    start: startDictation,
    stop: stopDictation,
  } = useSpeechDictation((spoken, isFinal) => {
    const next = joinDictation(dictationBaseRef.current, spoken);
    setInput(next);
    if (isFinal) dictationBaseRef.current = next;
  });

  useEffect(() => onActiveChange(messages.length > 0 || loading), [loading, messages.length, onActiveChange]);
  useEffect(() => {
    if (loading) stopDictation();
  }, [loading, stopDictation]);
  useEffect(() => {
    const scroller = conversationRef.current;
    if (!scroller || loading) return;
    const fromHistory = restoreFromHistoryRef.current;
    restoreFromHistoryRef.current = false;
    const target = fromHistory
      ? scroller.querySelector("article")
      : scroller.querySelector("article:last-of-type");
    target?.scrollIntoView({ block: "start", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [messages, loading, reduced]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1025px)");
    const closeDrawer = () => {
      if (media.matches) onHistoryOpenChange(false);
    };
    closeDrawer();
    media.addEventListener("change", closeDrawer);
    return () => media.removeEventListener("change", closeDrawer);
  }, [onHistoryOpenChange]);
  useEffect(() => {
    if (!historyOpen) return;
    restoreFocusRef.current = document.activeElement as HTMLElement;
    requestAnimationFrame(() => drawerCloseRef.current?.focus());
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (document.querySelector('[role="alertdialog"]')) return;
        onHistoryOpenChange(false);
      }
      if (event.key !== "Tab") return;
      const drawer = drawerCloseRef.current?.closest('[role="dialog"]');
      const controls = Array.from(
        drawer?.querySelectorAll<HTMLElement>('button, a, input, textarea, [tabindex]:not([tabindex="-1"])') || [],
      );
      if (!controls.length) return;
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && index === controls.length - 1) {
        event.preventDefault();
        controls[0]?.focus();
      }
    };
    document.addEventListener("keydown", handleKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeys);
      const target = restoreFocusRef.current;
      window.setTimeout(() => {
        if (target?.isConnected) target.focus();
      }, 0);
    };
  }, [historyOpen, onHistoryOpenChange]);

  const refreshConversations = useCallback(async () => {
    try {
      const result = await apiFetch<{ conversations?: ConversationSummary[] }>("/conversations", accessToken);
      if (!Array.isArray(result.conversations)) {
        setConversations([]);
        setHistoryError("Saved analyses could not be loaded. The history service is unavailable.");
        return;
      }
      setConversations(result.conversations);
      setHistoryError("");
      setAccessDenied(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }
      if (caught instanceof ApiError && caught.status === 403) {
        setAccessDenied(true);
        setConversations([]);
        setHistoryError("This account is not authorized. Access has been removed.");
        return;
      }
      setConversations([]);
      setHistoryError("Saved analyses could not be loaded. The history service is unavailable.");
    } finally {
      setHistoryLoading(false);
    }
  }, [accessToken, onUnauthorized]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void refreshConversations());
    return () => cancelAnimationFrame(frame);
  }, [refreshConversations]);

  async function ask(question: string, retry = false) {
    const trimmed = question.trim();
    if (!trimmed || askingRef.current) return;
    askingRef.current = true;
    const contextMessages = retry && messages.at(-1)?.role === "user" ? messages.slice(0, -1) : messages;
    const prior = contextMessages.slice(-12).map(({ role, content }) => ({ role, content: content.slice(0, 4000) }));
    setLastQuestion(trimmed);
    if (!retry) setMessages((current) => [...current, { role: "user", content: trimmed }]);
    setInput("");
    setError("");
    setLoading(true);
    try {
      const response = normalizeChatResponse(
        await apiFetch<ChatResponse>("/chat", accessToken, {
          method: "POST",
          body: JSON.stringify({
            message: trimmed,
            history: prior,
            conversation_id: conversationId,
            llm_provider: llmProvider,
          } satisfies ChatRequest),
        }),
      );
      setConversationId(response.conversation_id);
      setMessages((current) => [...current, { role: "assistant", content: response.answer, response }]);
      await refreshConversations();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }
      if (caught instanceof ApiError && caught.status === 403) {
        setAccessDenied(true);
        setError("This account is not authorized. Access has been removed.");
        return;
      }
      const request = caught instanceof ApiError && caught.requestId ? ` Request ID: ${caught.requestId}.` : "";
      setError(`${describeApiFailure(caught)}${request}`);
    } finally {
      askingRef.current = false;
      setLoading(false);
    }
  }

  async function openConversation(id: string) {
    const requestId = ++openRequestRef.current;
    setError("");
    setLoading(true);
    onHistoryOpenChange(false);
    try {
      const detail = await apiFetch<ConversationDetail>(`/conversations/${id}`, accessToken);
      if (requestId !== openRequestRef.current) return;
      const rows = Array.isArray(detail.messages) ? detail.messages : null;
      if (!rows) {
        setError("Could not load this analysis.");
        return;
      }
      restoreFromHistoryRef.current = true;
      setConversationId(id);
      setMessages(
        rows.map((item) => ({
          role: item.role,
          content: item.content,
          response: persistedResponse(item, id),
        })),
      );
    } catch (caught) {
      if (requestId !== openRequestRef.current) return;
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }
      setError(describeApiFailure(caught));
    } finally {
      if (requestId === openRequestRef.current) setLoading(false);
    }
  }

  async function removeConversation(item: ConversationSummary) {
    setPendingDelete(undefined);
    try {
      await apiFetch<void>(`/conversations/${item.id}`, accessToken, { method: "DELETE" });
      if (item.id === conversationId) newConversation();
      await refreshConversations();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onUnauthorized();
      setError(describeApiFailure(caught));
    }
  }

  function newConversation() {
    setConversationId(undefined);
    setMessages([]);
    setError("");
    onHistoryOpenChange(false);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(input);
  }

  function renderHistoryContent(mobile = false) {
    return (
      <div className={styles.historyInner}>
        <div className={styles.historyHead}>
          <div>
            <span>Saved intelligence</span>
            <small>
              {conversations.length} {conversations.length === 1 ? "analysis" : "analyses"}
            </small>
          </div>
          {mobile && (
            <button
              ref={drawerCloseRef}
              type="button"
              className={styles.iconButton}
              aria-label="Close history"
              onClick={() => onHistoryOpenChange(false)}
            >
              <X size={19} />
            </button>
          )}
        </div>
        <button type="button" className={styles.newButton} onClick={newConversation}>
          <Plus size={17} />
          New analysis
        </button>
        <LayoutGroup>
          <div className={styles.historyList} tabIndex={0} role="region" aria-label="Saved analysis list">
            {historyLoading ? (
              <div className={styles.historyEmpty}>Loading saved analyses…</div>
            ) : historyError ? (
              <div className={styles.historyEmpty}>{historyError}</div>
            ) : conversations.length === 0 ? (
              <div className={styles.historyEmpty}>
                <ClockCounterClockwise size={24} />
                <span>No saved analyses yet.</span>
                <small>Your completed questions will appear here.</small>
              </div>
            ) : (
              <AnimatePresence mode="popLayout" initial={false}>
                {conversations.map((item) => (
                  <m.div
                    layout={!reduced}
                    className={`${styles.historyItem} ${item.id === conversationId ? styles.active : ""}`}
                    key={item.id}
                    initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, x: -12 }}
                  >
                    <button
                      type="button"
                      className={styles.historyOpen}
                      title={item.title}
                      onClick={() => void openConversation(item.id)}
                    >
                      <strong>{item.title}</strong>
                      <small>
                        {new Date(item.updated_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </small>
                    </button>
                    <button type="button" aria-label={`Delete ${item.title}`} onClick={() => setPendingDelete(item)}>
                      <Trash size={16} />
                    </button>
                    <span className={styles.historyTip} aria-hidden="true">
                      {item.title}
                    </span>
                  </m.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </LayoutGroup>
        <div className={styles.dataNote}>
          <i />
          <span>Conversation history is retained for 30 days.</span>
        </div>
      </div>
    );
  }

  return (
    <div id="analysis" className={styles.grid}>
      <aside className={styles.history} aria-label="Saved analyses">
        {renderHistoryContent()}
      </aside>
      <div className={styles.mainColumn}>
        {intro ? <div className={styles.introSlot}>{intro}</div> : null}
        <section className={styles.workspace} aria-label="Airport analysis conversation">
        {messages.length === 0 && !loading ? (
          <m.div className={styles.starter} initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className={styles.starterHead}>
              <div>
                <span className="eyebrow">Start an analysis</span>
                <h2>Questions built for this evidence set</h2>
              </div>
              <ChatCircleDots size={28} />
            </div>
            <div className={styles.promptGrid}>
              {prompts.map((prompt, index) => (
                <m.button
                  type="button"
                  className={`${index > 1 && !showAllPrompts ? styles.secondaryPrompt : ""}`}
                  key={prompt.text}
                  onClick={() => void ask(prompt.text)}
                  initial={{ opacity: 0, y: reduced ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: reduced ? 0 : index * 0.04 }}
                  whileTap={{ scale: 0.99 }}
                >
                  <span className={styles.promptNumber}>0{index + 1}</span>
                  <span>
                    <small>{prompt.category}</small>
                    {prompt.text}
                  </span>
                  <ArrowRight size={20} />
                </m.button>
              ))}
            </div>
            <button
              type="button"
              className={styles.morePrompts}
              aria-expanded={showAllPrompts}
              onClick={() => setShowAllPrompts((value) => !value)}
            >
              {showAllPrompts ? "Show fewer questions" : "Show two more questions"}
            </button>
          </m.div>
        ) : (
          <div ref={conversationRef} className={styles.conversation} aria-live="polite">
            <AnimatePresence initial={false}>
              {messages.map((message, index) => (
                <m.article
                  className={`${styles.message} ${message.role === "user" ? styles.user : styles.assistant}`}
                  key={`${message.role}-${index}`}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <span className={styles.avatar}>{message.role === "user" ? "YOU" : "AI"}</span>
                  <div className={styles.messageBody}>
                    <span className={styles.messageLabel}>
                      {message.role === "user" ? "Your question" : "Evidence-led answer"}
                    </span>
                    {message.role === "user" ? <p>{message.content}</p> : <MarkdownAnswer markdown={message.content} />}
                    {message.response && <Evidence response={message.response} />}
                  </div>
                </m.article>
              ))}
            </AnimatePresence>
            {loading && (
              <m.article
                className={`${styles.message} ${styles.assistant}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <span className={styles.avatar}>AI</span>
                <div className={styles.loadingState}>
                  <MotionAsset
                    src="/assets/motion/evidence-scan.json"
                    posterSrc="/assets/posters/evidence-scan-poster.svg"
                    alt="Evidence sources being analyzed"
                  />
                  <div>
                    <strong>Checking the evidence</strong>
                    <span>Retrieving deterministic metrics and validating source context…</span>
                    <div className={styles.skeleton}>
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                </div>
              </m.article>
            )}
          </div>
        )}
        {accessDenied && !error && (
          <div className={styles.error} role="alert">
            <WarningCircle size={21} />
            <div>
              <strong>Access removed</strong>
              <span>This account is not authorized. Access has been removed.</span>
            </div>
          </div>
        )}
        <AnimatePresence>
          {error && (
            <m.div
              className={styles.error}
              role="alert"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <WarningCircle size={21} />
              <div>
                <strong>Analysis unavailable</strong>
                <span>{error}</span>
              </div>
              {lastQuestion && (
                <button type="button" disabled={loading} onClick={() => void ask(lastQuestion, true)}>
                  Retry
                </button>
              )}
            </m.div>
          )}
        </AnimatePresence>
        <form
          ref={formRef}
          onSubmit={submit}
          className={`${styles.composer} ${messages.length === 0 ? styles.composerIdle : ""}`}
        >
          <label htmlFor="question">Ask about an airport, region, route mix, or operational pressure</label>
          <div>
            <textarea
              id="question"
              value={input}
              onChange={(event) => {
                if (listening) stopDictation();
                setInput(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  formRef.current?.requestSubmit();
                }
              }}
              rows={2}
              maxLength={QUESTION_MAX_LENGTH}
              placeholder="Compare airports, test a hypothesis, or ask a follow-up…"
              disabled={loading}
            />
            <button
              type="button"
              className={styles.micButton}
              aria-label="Dictate question"
              aria-pressed={listening}
              aria-busy={dictationRequesting}
              disabled={loading || !dictationSupported || dictationRequesting}
              onClick={() => {
                if (listening) {
                  stopDictation();
                  return;
                }
                dictationBaseRef.current = input.trim();
                void startDictation();
              }}
            >
              <Microphone size={21} weight={listening ? "fill" : "regular"} />
            </button>
            <button type="submit" className={styles.sendButton} disabled={loading || !input.trim()} aria-label="Send question">
              <PaperPlaneTilt size={21} weight="fill" />
            </button>
          </div>
          <div className={styles.composerMeta}>
            <LlmProviderToggle value={llmProvider} onChange={setLlmProvider} />
            <small role="status" aria-live="polite">
              {listening
                ? "Listening… speak now"
                : dictationRequesting
                  ? "Allow microphone access when the browser asks…"
                  : dictationError === "unsupported"
                    ? "Voice dictation is not available in this browser. Type your question instead."
                    : dictationError === "denied"
                      ? "Microphone access was denied. Allow the microphone for this site, then try again."
                      : dictationError === "ready"
                        ? "Microphone is allowed. Click the mic and speak."
                        : dictationError === "network"
                          ? "The browser speech service did not return text. Check your connection and try again."
                          : dictationError === "empty"
                            ? "No speech was captured. Click the mic, speak, then click it again to stop."
                            : dictationError === "failed"
                              ? "Could not start dictation. Type your question instead."
                              : "Deterministic metrics · evidence-constrained AI explanation · no investment advice"}
            </small>
          </div>
        </form>
        </section>
      </div>
      <AnimatePresence>
        {historyOpen && (
          <m.div
            className={styles.scrim}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) onHistoryOpenChange(false);
            }}
          >
            <m.aside
              role="dialog"
              aria-modal="true"
              aria-label="Saved analyses"
              className={styles.drawer}
              initial={reduced ? { opacity: 0 } : { x: "-100%" }}
              animate={{ x: 0, opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { x: "-100%" }}
            >
              {renderHistoryContent(true)}
            </m.aside>
          </m.div>
        )}
      </AnimatePresence>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this analysis?"
        description={`“${pendingDelete?.title || "This analysis"}” and its messages will be permanently removed.`}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={() => pendingDelete && void removeConversation(pendingDelete)}
      />
    </div>
  );
}

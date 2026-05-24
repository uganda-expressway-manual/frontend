"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useMutation } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/lib/api";
import { rehypeAppendStreamCursor } from "@/lib/rehype-append-stream-cursor";

/* ── Design tokens ── */
const C = {
  navy: "#1a2744",
  gold: "#c97c2a",
  paper: "#faf8f3",
  border: "#d0c4aa",
  muted: "#8a7a60",
  bg: "#f4f1ec",
};
const fontSerif = "'Playfair Display', Georgia, serif";
const fontBody = "'Source Serif 4', Georgia, serif";
const PANEL_TRANSITION_MS = 320;

/* ── Interfaces (unchanged) ── */
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  referencedPages?: ChatReferenceLink[];
}

interface ChatReferenceLink {
  label: string;
  href: string;
}

interface ChatModelOption {
  id: string;
  label: string;
}

const CHATBOT_REQUEST_URLS = {
  library: "/chatbot/chat",
  folder: "/chatbot/chat",
  reader: "/chatbot/chat",
} as const;

type ChatRequestContext = keyof typeof CHATBOT_REQUEST_URLS;

function resolveChatRequestContext(folderId: string, layout: "default" | "reader"): ChatRequestContext {
  if (layout === "reader") return "reader";
  return folderId ? "folder" : "library";
}

interface DocumentChatWidgetProps {
  folderId?: string;
  stackZClass?: string;
  layout?: "default" | "reader";
  readerFullscreen?: boolean;
  /** Optional display name for the current folder/context */
  contextLabel?: string;
}

const CHAT_MODEL_OPTIONS: readonly ChatModelOption[] = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
];

interface AssistantTypingState {
  messageId: string;
  fullText: string;
  cursor: number;
  referencedPages: ChatReferenceLink[];
}

function buildInitialGreeting(folderId: string, contextLabel?: string): string {
  if (folderId && contextLabel) {
    return `Good day. I can see you're in the **${contextLabel}**.\n\nAsk me about any section, specification, or procedure.`;
  }
  if (folderId) {
    return "Good day. I can assist you with documents in this folder.\n\nAsk me about any section, specification, or procedure.";
  }
  return "Good day. I'm here to help you browse the manuals and find the right volume.\n\nWhich one can I help you locate?";
}

/* ── SVG Icons ── */
function BookIcon({ size = 20, color = C.gold }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

export function DocumentChatWidget({
  folderId = "",
  stackZClass = "z-40",
  layout = "default",
  contextLabel,
}: DocumentChatWidgetProps) {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => [{
    id: "assistant-greeting",
    role: "assistant",
    text: buildInitialGreeting(folderId, contextLabel),
  }]);
  const [assistantTyping, setAssistantTyping] = useState<AssistantTypingState | null>(null);
  const [tabHovered, setTabHovered] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);

  const chatViewportRef = useRef<HTMLDivElement | null>(null);
  const requestSequenceRef = useRef(0);
  const blockedRequestIdsRef = useRef<Set<number>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);

  const chatRequestContext = resolveChatRequestContext(folderId, layout);
  const chatRequestUrl = CHATBOT_REQUEST_URLS[chatRequestContext];

  /* ── Animate panel open/close ── */
  useEffect(() => {
    if (isChatOpen) {
      requestAnimationFrame(() => setPanelVisible(true));
    } else {
      setPanelVisible(false);
    }
  }, [isChatOpen]);

  useEffect(() => {
    if (!isChatOpen) setIsModelMenuOpen(false);
  }, [isChatOpen]);

  useEffect(() => {
    if (!isModelMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const el = modelMenuRef.current;
      if (el && !el.contains(event.target as Node)) setIsModelMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsModelMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isModelMenuOpen]);

  const openChat = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setTabHovered(false);
    setIsChatOpen(true);
  }, []);

  const closeChat = useCallback(() => {
    if (!isChatOpen) return;
    setPanelVisible(false);
    setTabHovered(false);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setIsChatOpen(false);
      closeTimerRef.current = null;
    }, PANEL_TRANSITION_MS);
  }, [isChatOpen]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  /* ── / keyboard shortcut (toggle) ── */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement;
      const tag = target.tagName?.toLowerCase();
      const isEditable =
        tag === "input" || tag === "textarea" || target.isContentEditable;
      if (isEditable) return;
      e.preventDefault();
      if (isChatOpen) closeChat();
      else openChat();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isChatOpen, openChat, closeChat]);

  /* ── Model init ── */
  useEffect(() => {
    setSelectedModelId(c => {
      if (c && CHAT_MODEL_OPTIONS.some(m => m.id === c)) return c;
      return CHAT_MODEL_OPTIONS[0]?.id ?? "";
    });
  }, []);

  /* ── Auto-scroll ── */
  useEffect(() => {
    if (!chatViewportRef.current) return;
    chatViewportRef.current.scrollTo({
      top: chatViewportRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chatMessages, isChatOpen]);

  /* ── Typing animation ── */
  useEffect(() => {
    if (!assistantTyping) return;
    if (assistantTyping.cursor >= assistantTyping.fullText.length) {
      setAssistantTyping(null);
      return;
    }
    const currentChar = assistantTyping.fullText.charAt(assistantTyping.cursor);
    const delay = /[,.!?]/.test(currentChar) ? 85 : /\s/.test(currentChar) ? 22 : 14;
    const timer = window.setTimeout(() => {
      const nextCursor = assistantTyping.cursor + 1;
      const nextText = assistantTyping.fullText.slice(0, nextCursor);
      setChatMessages(prev => {
        const idx = prev.findIndex(m => m.id === assistantTyping.messageId);
        if (idx < 0) return [...prev, {
          id: assistantTyping.messageId, role: "assistant",
          text: nextText, referencedPages: assistantTyping.referencedPages,
        }];
        return prev.map(m => m.id === assistantTyping.messageId ? { ...m, text: nextText } : m);
      });
      setAssistantTyping(p =>
        p && p.messageId === assistantTyping.messageId ? { ...p, cursor: nextCursor } : p
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [assistantTyping]);

  /* ── Textarea auto-resize ── */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 80)}px`;
  }, [chatInput]);

  const chatMutation = useMutation({
    mutationFn: async ({ message, requestId, model }: { message: string; requestId: number; model: string }) => {
      const body = model ? { folderId, model, message } : { folderId, message };
      const response = await api.post(chatRequestUrl, body);
      return { ...resolveChatbotResponse(response.data), requestId };
    },
    onSuccess: ({ answer, referencedPages, requestId }) => {
      if (blockedRequestIdsRef.current.has(requestId)) {
        blockedRequestIdsRef.current.delete(requestId); return;
      }
      const assistantMessageId = `${Date.now()}-assistant`;
      const resolvedText = answer || "I couldn't generate a response. Please try again.";
      setAssistantTyping({ messageId: assistantMessageId, fullText: resolvedText, cursor: 0, referencedPages });
    },
    onError: (error, variables) => {
      if (blockedRequestIdsRef.current.has(variables.requestId)) {
        blockedRequestIdsRef.current.delete(variables.requestId); return;
      }
      setChatMessages(prev => [...prev, {
        id: `${Date.now()}-assistant-error`, role: "assistant",
        text: getChatbotErrorMessage(error),
      }]);
    },
  });

  const submitChatMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedMessage = chatInput.trim();
    const modelRequired = CHAT_MODEL_OPTIONS.length > 0;
    if (
      !trimmedMessage ||
      chatMutation.isPending ||
      assistantTyping ||
      (modelRequired && !selectedModelId)
    ) {
      return;
    }
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    setChatMessages(prev => [...prev, { id: `${Date.now()}-user`, role: "user", text: trimmedMessage }]);
    setChatInput("");
    chatMutation.mutate({ message: trimmedMessage, requestId, model: selectedModelId });
  };

  const stopConversation = () => {
    if (chatMutation.isPending) blockedRequestIdsRef.current.add(requestSequenceRef.current);
    setAssistantTyping(null);
  };

  const isConversationRunning = chatMutation.isPending || Boolean(assistantTyping);
  const inputEmpty = !chatInput.trim();
  const selectedModelLabel =
    CHAT_MODEL_OPTIONS.find((m) => m.id === selectedModelId)?.label ?? CHAT_MODEL_OPTIONS[0]?.label ?? "";
  const modelPickerDisabled = chatMutation.isPending || Boolean(assistantTyping);

  /* ══════════════════════════════════════════════════════
     RENDER — Reference Librarian aesthetic
  ══════════════════════════════════════════════════════ */
  return (
    <>
      {/* ── Global styles ── */}
      <style>{`
        @keyframes lib-consulting-pulse {
          0%,100% { opacity: 1; }
          50%      { opacity: 0.4; }
        }
        .lib-consulting-text {
          animation: lib-consulting-pulse 900ms ease-in-out infinite;
        }
        .lib-chat-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: ${C.border} ${C.paper};
        }
        .lib-chat-scrollbar::-webkit-scrollbar { width: 5px; }
        .lib-chat-scrollbar::-webkit-scrollbar-track { background: ${C.paper}; }
        .lib-chat-scrollbar::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
      `}</style>

      {/* ── Collapsed bookmark tab ── */}
      {!isChatOpen && (
        <div style={{ position: "fixed", bottom: 32, right: 32, zIndex: 40, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }} className={stackZClass}>
          <div style={{
            background: C.navy, color: C.paper,
            fontFamily: fontBody, fontSize: 11, fontStyle: "italic",
            padding: "5px 12px", borderRadius: 20,
            pointerEvents: "none", whiteSpace: "nowrap",
          }}>
            Press " / " to open AI chat
          </div>
          <button
            onClick={openChat}
            onMouseEnter={() => setTabHovered(true)}
            onMouseLeave={() => setTabHovered(false)}
            style={{
              background: tabHovered ? C.gold : C.navy,
              color: C.paper,
              fontFamily: fontBody, fontSize: 13,
              letterSpacing: "0.06em",
              padding: "10px 20px",
              borderRadius: "4px 4px 0 0",
              border: "none", cursor: "pointer",
              boxShadow: "0 -4px 16px rgba(0,0,0,0.16)",
              display: "flex", alignItems: "center", gap: 8,
              transform: tabHovered ? "translateY(-3px)" : "translateY(0)",
              transition: "background 200ms, transform 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
            }}
            title='Press "/"   to open AI chat'
          >
            <BookIcon size={15} color={tabHovered ? "white" : C.gold} />
            AI
          </button>
        </div>
      )}

      {/* ── Expanded chat panel ── */}
      {isChatOpen && (
        <div
          style={{
            position: "fixed", bottom: 0, right: 32,
            width: 360, height: 500,
            display: "flex", flexDirection: "column",
            borderRadius: "6px 6px 0 0",
            overflow: "hidden",
            boxShadow: "0 -8px 40px rgba(0,0,0,0.18), 0 -2px 8px rgba(0,0,0,0.08)",
            transform: panelVisible ? "translateY(0)" : "translateY(100%)",
            opacity: panelVisible ? 1 : 0,
            pointerEvents: panelVisible ? "auto" : "none",
            transition: `transform ${PANEL_TRANSITION_MS}ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity ${PANEL_TRANSITION_MS}ms ease`,
          }}
          className={stackZClass}
        >
          {/* Header */}
          <div style={{
            background: C.navy,
            padding: "14px 18px 16px",
            borderRadius: "6px 6px 0 0",
            flexShrink: 0,
          }}>
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              marginBottom: 10,
            }}>
              <BookIcon size={20} color={C.gold} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: fontSerif, fontSize: 15, fontWeight: 700,
                  color: "white", lineHeight: 1.2,
                }}>
                  AI Assistant
                </div>
                <div style={{
                  fontFamily: fontBody, fontSize: 11, fontStyle: "italic",
                  color: "rgba(255,255,255,0.55)", marginTop: 2,
                }}>
                  Ask about manuals and documents
                </div>
              </div>
              <button
                onClick={closeChat}
                aria-label="Close chat"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontFamily: fontBody, fontSize: 18,
                  color: "rgba(255,255,255,0.5)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: "2px 4px",
                  transition: "color 150ms",
                  flexShrink: 0,
                  marginTop: -2,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "white"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.5)"; }}
              >
                ×
              </button>
            </div>
            {/* Model picker */}
            <div ref={modelMenuRef} style={{ position: "relative" }}>
              <button
                type="button"
                id="chat-model-trigger"
                aria-haspopup="listbox"
                aria-expanded={isModelMenuOpen}
                aria-label={`Model: ${selectedModelLabel}. Choose model`}
                disabled={modelPickerDisabled}
                onClick={() => { if (!modelPickerDisabled) setIsModelMenuOpen((o) => !o); }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "6px 10px",
                  fontFamily: fontBody,
                  fontSize: 12,
                  color: C.navy,
                  background: C.paper,
                  border: `1px solid ${C.border}`,
                  borderRadius: 3,
                  cursor: modelPickerDisabled ? "not-allowed" : "pointer",
                  opacity: modelPickerDisabled ? 0.55 : 1,
                  transition: "border-color 150ms, box-shadow 150ms",
                  textAlign: "left",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {selectedModelLabel}
                </span>
                <svg
                  width={12}
                  height={12}
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke={C.navy}
                  strokeWidth={2}
                  aria-hidden
                  style={{
                    transform: isModelMenuOpen ? "rotate(180deg)" : "none",
                    transition: "transform 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
                    flexShrink: 0,
                  }}
                >
                  <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {isModelMenuOpen && (
                <ul
                  role="listbox"
                  aria-labelledby="chat-model-trigger"
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: "calc(100% + 4px)",
                    zIndex: 50,
                    listStyle: "none",
                    margin: 0,
                    padding: "4px 0",
                    background: C.paper,
                    border: `1px solid ${C.border}`,
                    borderRadius: 3,
                    boxShadow: "0 10px 28px rgba(0,0,0,0.12)",
                  }}
                >
                  {CHAT_MODEL_OPTIONS.map((option) => {
                    const sel = option.id === selectedModelId;
                    return (
                      <li key={option.id} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={sel}
                          onClick={() => {
                            setSelectedModelId(option.id);
                            setIsModelMenuOpen(false);
                          }}
                          style={{
                            width: "100%",
                            padding: "7px 12px",
                            fontFamily: fontBody,
                            fontSize: 12,
                            textAlign: "left",
                            border: "none",
                            background: sel ? "rgba(201,124,42,0.12)" : "transparent",
                            color: C.navy,
                            cursor: "pointer",
                          }}
                        >
                          {option.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Border */}
          <div style={{ height: 1, background: C.border, flexShrink: 0 }} />

          {/* Messages */}
          <div
            ref={chatViewportRef}
            className="lib-chat-scrollbar"
            style={{
              flex: 1,
              background: C.paper,
              backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 24px,rgba(180,160,120,0.06) 24px,rgba(180,160,120,0.06) 25px)",
              padding: "20px 16px",
              overflowY: "auto",
              scrollBehavior: "smooth",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {chatMessages.map(message => {
              const isTypingMessage = assistantTyping?.messageId === message.id;
              const isAssistant = message.role === "assistant";

              if (isAssistant) {
                return (
                  <div key={message.id} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                    <div style={{
                      borderLeft: "2px solid " + C.gold,
                      background: "rgba(201,124,42,0.04)",
                      borderRadius: "0 4px 4px 0",
                      padding: "12px 14px",
                      fontFamily: fontBody, fontSize: 13,
                      color: "#3a3020", lineHeight: 1.7,
                      maxWidth: "90%",
                    }}>
                      <div className="break-words">
                        {isTypingMessage && !message.text ? (
                          <span className="chat-typing-cursor-line" aria-hidden />
                        ) : isTypingMessage ? (
                          <div className="chat-typing-md">
                            {renderMessageText(message.text, "assistant", { streamCursor: true })}
                          </div>
                        ) : (
                          renderMessageText(message.text, "assistant")
                        )}
                      </div>
                      {!isTypingMessage && message.referencedPages && message.referencedPages.length > 0 && (
                        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {message.referencedPages.map(ref => (
                            <Link
                              key={`${message.id}-${ref.href}-${ref.label}`}
                              href={ref.href}
                              style={{
                                fontFamily: fontBody, fontSize: 11,
                                color: C.gold, textDecoration: "underline",
                                textUnderlineOffset: 2,
                              }}
                            >
                              {ref.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                    {message.text.trim() !== "" && !isTypingMessage && (
                      <div style={{ marginTop: 4, paddingLeft: 2 }}>
                        <MessageCopyButton text={message.text} variant="assistant" />
                      </div>
                    )}
                  </div>
                );
              }

              /* User message */
              return (
                <div key={message.id} style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-end",
                }}>
                  <div style={{
                    borderRight: "2px solid " + C.navy,
                    padding: "8px 12px 8px 0",
                    marginRight: 4,
                    fontFamily: fontBody, fontSize: 13,
                    color: C.navy, lineHeight: 1.6,
                    maxWidth: "85%", textAlign: "right",
                    wordBreak: "break-word",
                  }}>
                    {renderMessageText(message.text, "user")}
                  </div>
                  <div style={{ marginTop: 4, paddingRight: 8 }}>
                    <MessageCopyButton text={message.text} variant="user" />
                  </div>
                </div>
              );
            })}

            {/* "Consulting the archive…" loading state */}
            {chatMutation.isPending && (
              <p className="lib-consulting-text" style={{
                fontFamily: fontBody, fontSize: 12, fontStyle: "italic",
                color: C.muted, margin: 0, paddingLeft: 14,
              }}>
                Consulting the archive…
              </p>
            )}
          </div>

          {/* Border */}
          <div style={{ height: 1, background: C.border, flexShrink: 0 }} />

          {/* Input area */}
          <form
            onSubmit={submitChatMessage}
            style={{
              background: C.paper,
              padding: "14px 16px",
              display: "flex", alignItems: "center", gap: 12,
              flexShrink: 0,
            }}
          >
            <TextareaWithFocus
              ref={textareaRef}
              value={chatInput}
              onChange={v => setChatInput(v)}
              onEnterSubmit={() => {
                if (!inputEmpty && !isConversationRunning) {
                  const fakeEvent = { preventDefault: () => { } } as FormEvent<HTMLFormElement>;
                  submitChatMessage(fakeEvent);
                }
              }}
              placeholder="Ask about a manual or chapter…"
              disabled={isConversationRunning}
            />
            <button
              type={isConversationRunning ? "button" : "submit"}
              onClick={isConversationRunning ? stopConversation : undefined}
              disabled={!isConversationRunning && inputEmpty}
              style={{
                background: isConversationRunning
                  ? C.gold
                  : inputEmpty ? "#c8b89a" : C.navy,
                color: C.paper,
                fontFamily: fontBody, fontSize: 12,
                letterSpacing: "0.06em",
                border: "none", borderRadius: 3,
                padding: "7px 14px",
                cursor: (!isConversationRunning && inputEmpty) ? "default" : "pointer",
                transition: "background 200ms",
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
              onMouseEnter={e => {
                if (!isConversationRunning && !inputEmpty)
                  (e.currentTarget as HTMLButtonElement).style.background = C.gold;
              }}
              onMouseLeave={e => {
                if (!isConversationRunning && !inputEmpty)
                  (e.currentTarget as HTMLButtonElement).style.background = C.navy;
              }}
            >
              {isConversationRunning ? "Stop" : "Send"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

/* ── Textarea with focus state ── */
function TextareaWithFocus({
  value, onChange, onEnterSubmit, placeholder, disabled, ref: externalRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnterSubmit: () => void;
  placeholder: string;
  disabled?: boolean;
  ref?: React.Ref<HTMLTextAreaElement>;
}) {
  const [focused, setFocused] = useState(false);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const refToUse = (externalRef as React.RefObject<HTMLTextAreaElement>) ?? internalRef;

  return (
    <textarea
      ref={refToUse}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onEnterSubmit();
        }
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      rows={1}
      disabled={disabled}
      style={{
        flex: 1,
        fontFamily: fontBody, fontSize: 13,
        color: C.navy,
        border: "none",
        borderBottom: `${focused ? "1.5px" : "1px"} solid ${focused ? C.gold : C.border}`,
        background: "transparent",
        resize: "none",
        outline: "none",
        padding: "4px 0",
        minHeight: 28,
        maxHeight: 80,
        lineHeight: 1.5,
        transition: "border-color 200ms",
        overflow: "auto",
      }}
    />
  );
}

/* Need to handle ref forwarding properly */
TextareaWithFocus.displayName = "TextareaWithFocus";

/* ── Utility functions (unchanged logic) ── */

function getChatbotErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; error?: string; detail?: string } | string | undefined;
    if (typeof data === "string" && data.trim()) return data.trim();
    if (data && typeof data === "object") {
      if (typeof data.message === "string" && data.message.trim()) return data.message.trim();
      if (typeof data.error === "string" && data.error.trim()) return data.error.trim();
      if (typeof data.detail === "string" && data.detail.trim()) return data.detail.trim();
    }
    const status = error.response?.status;
    if (status) {
      const statusText = error.response?.statusText?.trim();
      return statusText ? `Request failed (${status} ${statusText})` : `Request failed (${status})`;
    }
    if (typeof error.message === "string" && error.message.trim()) return error.message.trim();
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "Something went wrong while contacting the chatbot. Please try again.";
}

function resolveChatbotResponse(payload: unknown): { answer: string; referencedPages: ChatReferenceLink[] } {
  if (typeof payload === "string") return { answer: payload, referencedPages: [] };
  if (!payload || typeof payload !== "object") return { answer: "", referencedPages: [] };
  const r = payload as Record<string, unknown>;
  const answer =
    (typeof r.answer === "string" && r.answer) ||
    (typeof r.message === "string" && r.message) ||
    (typeof r.response === "string" && r.response) || "";
  const directPages = normalizeReferencedPages(r.referencedPages);
  if (directPages.length > 0) return { answer, referencedPages: directPages };
  const data = r.data;
  if (data && typeof data === "object") {
    const n = data as Record<string, unknown>;
    const nestedAnswer =
      (typeof n.answer === "string" && n.answer) ||
      (typeof n.message === "string" && n.message) ||
      (typeof n.response === "string" && n.response) || answer;
    return { answer: nestedAnswer, referencedPages: normalizeReferencedPages(n.referencedPages) };
  }
  return { answer, referencedPages: [] };
}

function normalizeReferencedPages(value: unknown): ChatReferenceLink[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, i) => toReferenceLink(entry, i)).filter((e): e is ChatReferenceLink => e !== null);
}

function toReferenceLink(entry: unknown, index: number): ChatReferenceLink | null {
  if (!entry || typeof entry !== "object") return null;
  const r = entry as Record<string, unknown>;
  const hrefCandidate = r.href ?? r.url ?? r.link;
  if (typeof hrefCandidate === "string" && hrefCandidate.trim()) {
    return {
      href: hrefCandidate,
      label: typeof r.label === "string" && r.label.trim() ? r.label : `Reference ${index + 1}`,
    };
  }
  const fileIdCandidate = r.fileId ?? r.file_id ?? r.id;
  if (typeof fileIdCandidate !== "string" || !fileIdCandidate.trim()) return null;
  const pageCandidate = r.page ?? r.pageNumber;
  const pageNumber =
    typeof pageCandidate === "number" && Number.isFinite(pageCandidate) ? pageCandidate :
      typeof pageCandidate === "string" && pageCandidate.trim() && Number.isFinite(Number(pageCandidate)) ? Number(pageCandidate) : null;
  const params = new URLSearchParams();
  if (pageNumber && pageNumber > 0) params.set("page", String(pageNumber));
  const href = params.toString() ? `/files/${fileIdCandidate}?${params.toString()}` : `/files/${fileIdCandidate}`;
  const filename = typeof r.filename === "string" ? r.filename.trim() : "";
  const label =
    typeof r.label === "string" && r.label.trim() ? r.label :
      filename ? (pageNumber ? `${filename} - Page ${pageNumber}` : filename) :
        pageNumber ? `Page ${pageNumber}` : `Reference ${index + 1}`;
  return { href, label };
}

/* ── renderMessageText (unchanged) ── */
function renderMessageText(
  text: string, role: ChatMessage["role"], options?: { streamCursor?: boolean }
): ReactNode {
  const { streamCursor = false } = options ?? {};
  const isUser = role === "user";
  const inlineCodeClass = isUser
    ? "rounded bg-blue-500/70 px-1 py-0.5 font-mono text-[12px] text-white"
    : "rounded bg-slate-200 px-1 py-0.5 font-mono text-[12px] text-slate-800";
  return (
    <ReactMarkdown
      rehypePlugins={streamCursor ? [rehypeAppendStreamCursor] : undefined}
      components={{
        h1: ({ children }) => <h1 className="mb-2 text-lg font-bold leading-snug last:mb-0">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 text-base font-bold leading-snug last:mb-0">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 text-sm font-semibold leading-snug last:mb-0">{children}</h3>,
        p: ({ children }) => <p className="mb-2 whitespace-pre-wrap break-words leading-relaxed last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        strong: ({ children }) => <strong className="font-bold">{children}</strong>,
        code: ({ children, className }) => {
          const codeText = String(children).replace(/\n$/, "");
          const isBlockCode = Boolean(className) || codeText.includes("\n");
          if (isBlockCode) return <ChatCodeBlock codeText={codeText} role={role} />;
          return <code className={inlineCodeClass}>{children}</code>;
        },
        pre: ({ children }) => <>{children}</>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

/* ── ChatCodeBlock (unchanged) ── */
function ChatCodeBlock({ codeText, role }: { codeText: string; role: ChatMessage["role"] }) {
  const [copied, setCopied] = useState(false);
  const isUser = role === "user";

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(t);
  }, [copied]);

  const onCopy = async () => {
    try { await navigator.clipboard.writeText(codeText); setCopied(true); }
    catch { setCopied(false); }
  };

  return (
    <div className={[
      "mb-2 rounded-lg border p-2.5 font-mono text-[12px] leading-relaxed last:mb-0",
      isUser ? "border-blue-300/40 bg-blue-500/55 text-white" : "border-slate-300 bg-white/75 text-slate-800",
    ].join(" ")}>
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={() => void onCopy()}
          aria-label={copied ? "Copied" : "Copy code"} title={copied ? "Copied" : "Copy"}
          className={["inline-flex h-8 w-8 items-center justify-center rounded-md transition",
            copied ? "bg-emerald-600 text-white" : "bg-black text-white hover:bg-slate-800",
          ].join(" ")}>
          {copied ? <CheckIcon className="h-4 w-4" /> : <ClipboardCopyIcon className="h-4 w-4" />}
        </button>
      </div>
      <pre className="overflow-x-auto"><code>{codeText}</code></pre>
    </div>
  );
}

/* ── MessageCopyButton (unchanged) ── */
function MessageCopyButton({ text, variant }: { text: string; variant: "user" | "assistant" }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  const onCopy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { setCopied(false); }
  };

  const label = copied ? "Copied" : "Copy message";
  return (
    <button type="button" onClick={() => void onCopy()} aria-label={label} title={label}
      style={{
        background: "none", border: "none", cursor: "pointer",
        color: copied ? "#2d6a3a" : C.muted,
        padding: 0, display: "inline-flex", alignItems: "center",
        transition: "color 150ms",
      }}>
      {copied ? <CheckIcon className="h-3 w-3" /> : <ClipboardCopyIcon className="h-3 w-3" />}
    </button>
  );
}

function ClipboardCopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}


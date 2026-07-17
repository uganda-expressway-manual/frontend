"use client";

import Link from "next/link";
import { type CSSProperties, ReactNode } from "react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  createChat,
  deleteChat,
  getChatHistory,
  getChatbotAvailableModels,
  listChats,
  patchChatMessage,
  postChatbotMessage,
  postFolderQuery,
  updateChat,
  updateChatbotModel,
  type ChatModelOption,
} from "@/lib/api";
import type { ChatHistoryMessage, ChatRoomSummary } from "@/lib/types";
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

interface DocumentChatWidgetProps {
  folderId?: string;
  stackZClass?: string;
  layout?: "default" | "reader";
  readerFullscreen?: boolean;
  /** Optional display name for the current folder/context */
  contextLabel?: string;
}

const FALLBACK_CHAT_MODEL_OPTIONS: readonly ChatModelOption[] = [
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
  const queryClient = useQueryClient();
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [chatContextMenuId, setChatContextMenuId] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChatTitle, setActiveChatTitle] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [assistantTyping, setAssistantTyping] = useState<AssistantTypingState | null>(null);
  const [tabHovered, setTabHovered] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);

  const chatViewportRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const handleChatViewportScroll = useCallback(() => {
    const viewport = chatViewportRef.current;
    if (!viewport) return;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= 48;
  }, []);
  const requestSequenceRef = useRef(0);
  const blockedRequestIdsRef = useRef<Set<number>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createTitleInput, setCreateTitleInput] = useState("");
  const [createChatError, setCreateChatError] = useState("");
  const [renameTarget, setRenameTarget] = useState<ChatRoomSummary | null>(null);
  const [renameTitleInput, setRenameTitleInput] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ChatRoomSummary | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState("");
  const [showNewChatIntro, setShowNewChatIntro] = useState(false);

  const modelsQuery = useQuery({
    queryKey: ["chatbot", "available_models"],
    queryFn: getChatbotAvailableModels,
    staleTime: 5 * 60 * 1000,
  });

  /** Backend model switch is global (`PATCH /chatbot/model`) — picking a model here isn't just local UI state. */
  const updateModelMutation = useMutation({
    mutationFn: (model: string) => updateChatbotModel(model),
  });

  const chatsQuery = useQuery({
    queryKey: ["chats"],
    queryFn: listChats,
    enabled: isChatOpen,
  });

  const chatHistoryQuery = useQuery({
    queryKey: ["chat", activeChatId, "history"],
    queryFn: () => getChatHistory(activeChatId!),
    enabled: isChatOpen && Boolean(activeChatId),
  });

  const chatModelOptions: readonly ChatModelOption[] =
    modelsQuery.data && modelsQuery.data.length > 0
      ? modelsQuery.data
      : FALLBACK_CHAT_MODEL_OPTIONS;

  const chats = chatsQuery.data ?? [];
  const isHistoryLoading =
    Boolean(activeChatId) &&
    !showNewChatIntro &&
    (chatHistoryQuery.isLoading || chatHistoryQuery.isFetching) &&
    chatMessages.length === 0;

  const resetToNewChat = useCallback(() => {
    setActiveChatId(null);
    setActiveChatTitle("");
    setAssistantTyping(null);
    setEditingMessageId(null);
    setEditingMessageText("");
    setShowNewChatIntro(false);
    setChatMessages([]);
  }, []);

  const openConversation = useCallback((chat: ChatRoomSummary) => {
    setShowNewChatIntro(false);
    setActiveChatId(chat.id);
    setActiveChatTitle(chat.title);
    setAssistantTyping(null);
    setEditingMessageId(null);
    setEditingMessageText("");
    setIsSidebarOpen(false);
    setChatContextMenuId(null);
    setChatMessages([]);
    if (chat.id !== activeChatId) {
      void queryClient.fetchQuery({
        queryKey: ["chat", chat.id, "history"],
        queryFn: () => getChatHistory(chat.id),
      });
    } else {
      void queryClient.invalidateQueries({ queryKey: ["chat", chat.id, "history"] });
    }
  }, [activeChatId, queryClient]);

  useEffect(() => {
    if (!activeChatId) {
      return;
    }
    if (chatHistoryQuery.isLoading || chatHistoryQuery.isFetching) {
      return;
    }
    if (!chatHistoryQuery.isSuccess || !chatHistoryQuery.data) {
      return;
    }
    const historyChatId = chatHistoryQuery.data.id || activeChatId;
    if (historyChatId !== activeChatId) {
      return;
    }
    setActiveChatTitle(chatHistoryQuery.data.title);
    const historyMessages = chatHistoryQuery.data.messages;
    if (historyMessages.length > 0) {
      setShowNewChatIntro(false);
      setChatMessages(
        historyToChatMessages(historyMessages, folderId, contextLabel, { emptyGreeting: false }),
      );
      return;
    }
    if (showNewChatIntro) {
      return;
    }
    setChatMessages([]);
  }, [
    activeChatId,
    chatHistoryQuery.data,
    chatHistoryQuery.isFetching,
    chatHistoryQuery.isLoading,
    chatHistoryQuery.isFetching,
    chatHistoryQuery.isSuccess,
    folderId,
    contextLabel,
    showNewChatIntro,
  ]);

  const refreshChatList = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: ["chats"] });
  }, [queryClient]);

  const enterChatroom = useCallback((chat: ChatRoomSummary) => {
    void queryClient.removeQueries({ queryKey: ["chat", chat.id, "history"] });
    setIsSidebarOpen(false);
    setChatContextMenuId(null);
    setShowNewChatIntro(true);
    setActiveChatId(chat.id);
    setActiveChatTitle(chat.title);
    setAssistantTyping(null);
    setEditingMessageId(null);
    setEditingMessageText("");
    setChatMessages([{
      id: "assistant-greeting",
      role: "assistant",
      text: buildInitialGreeting(folderId, contextLabel),
    }]);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [folderId, contextLabel, queryClient]);

  const createChatMutation = useMutation({
    mutationFn: (title: string) => createChat(title),
    onMutate: () => {
      setCreateChatError("");
      setIsCreateModalOpen(false);
    },
    onSuccess: (chat) => {
      setCreateTitleInput("");
      setCreateChatError("");
      enterChatroom(chat);
      void refreshChatList();
    },
    onError: (error, title) => {
      setCreateTitleInput(title);
      setCreateChatError(getChatbotErrorMessage(error));
      setIsCreateModalOpen(true);
    },
  });

  const updateChatMutation = useMutation({
    mutationFn: ({ chatId, title }: { chatId: string; title: string }) => updateChat(chatId, { title }),
    onSuccess: async (chat) => {
      if (activeChatId === chat.id) {
        setActiveChatTitle(chat.title);
      }
      setRenameTarget(null);
      setRenameTitleInput("");
      await refreshChatList();
      void queryClient.invalidateQueries({ queryKey: ["chat", chat.id, "history"] });
    },
  });

  const deleteChatMutation = useMutation({
    mutationFn: (chatId: string) => deleteChat(chatId),
    onSuccess: (_data, chatId) => {
      setDeleteTarget(null);
      setChatContextMenuId(null);
      if (activeChatId === chatId) {
        resetToNewChat();
      }
      void refreshChatList();
    },
  });

  /* ── Animate panel open/close ── */
  useEffect(() => {
    if (isChatOpen) {
      requestAnimationFrame(() => setPanelVisible(true));
    } else {
      setPanelVisible(false);
    }
  }, [isChatOpen]);

  useEffect(() => {
    if (!isChatOpen) {
      setIsModelMenuOpen(false);
      setIsSidebarOpen(false);
      setChatContextMenuId(null);
    }
  }, [isChatOpen]);

  useEffect(() => {
    if (!isSidebarOpen && !chatContextMenuId) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest("[data-chat-sidebar]") ||
        target.closest("[data-chat-context-menu]") ||
        target.closest("[data-chat-chrome]") ||
        target.closest("[data-chat-dialog]")
      ) {
        return;
      }
      setChatContextMenuId(null);
      if (isSidebarOpen) setIsSidebarOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isSidebarOpen, chatContextMenuId]);

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
    if (!activeChatId) {
      setIsSidebarOpen(true);
    }
  }, [activeChatId]);

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
      if (c && chatModelOptions.some(m => m.id === c)) return c;
      return chatModelOptions[0]?.id ?? "";
    });
  }, [chatModelOptions]);

  /* ── Auto-scroll ── */
  useEffect(() => {
    if (!chatViewportRef.current) return;
    // Respect user's manual scroll while the assistant is typing — do not force-scroll
    // if the user has scrolled away from the bottom.
    if (!shouldAutoScrollRef.current) return;
    if (assistantTyping) return;
    chatViewportRef.current.scrollTo({
      top: chatViewportRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chatMessages, isChatOpen, assistantTyping]);

  /* ── Typing animation ── */
  useEffect(() => {
    if (!assistantTyping) return;
    if (assistantTyping.cursor >= assistantTyping.fullText.length) {
      setAssistantTyping(null);
      return;
    }
    const currentChar = assistantTyping.fullText.charAt(assistantTyping.cursor);
    const isPunctuation = /[,.!?]/.test(currentChar);
    const isSpace = /\s/.test(currentChar);
    /**
     * Chained setTimeouts get clamped to a ~4ms floor by the browser after a few iterations, so
     * shortening the per-tick delay alone plateaus well short of "4x faster". Revealing a few
     * normal characters per tick (instead of one) is what actually scales the reveal speed;
     * punctuation/spaces still land as single steps so the pacing still reads naturally.
     */
    const step = isPunctuation || isSpace ? 1 : 3;
    const delay = isPunctuation ? 12 : 4;
    const timer = window.setTimeout(() => {
      const nextCursor = Math.min(assistantTyping.cursor + step, assistantTyping.fullText.length);
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

  const editMessageMutation = useMutation({
    mutationFn: ({
      chatId,
      messageId,
      text,
    }: {
      chatId: string;
      messageId: string;
      text: string;
    }) => patchChatMessage(chatId, messageId, text),
    onSuccess: (_data, variables) => {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === variables.messageId ? { ...m, text: variables.text } : m,
        ),
      );
      setEditingMessageId(null);
      setEditingMessageText("");
      void queryClient.invalidateQueries({ queryKey: ["chat", variables.chatId, "history"] });
    },
  });

  const chatMutation = useMutation({
    mutationFn: async ({
      text,
      requestId,
      chatId,
      pendingUserMessageId,
    }: {
      text: string;
      requestId: number;
      chatId: string;
      pendingUserMessageId: string;
    }) => {
      // Folder-scoped chats are grounded in that folder's PDFs via the RAG file-search endpoint;
      // the general chatbot endpoint is used everywhere else (no folder context).
      const data = folderId
        ? await postFolderQuery(folderId, { chatId, text })
        : await postChatbotMessage({ chatId, text });
      return {
        ...resolveChatbotResponse(data),
        requestId,
        chatId,
        pendingUserMessageId,
        serverUserMessageId: pickUserMessageIdFromResponse(data),
      };
    },
    onSuccess: ({
      answer,
      referencedPages,
      requestId,
      chatId,
      pendingUserMessageId,
      serverUserMessageId,
    }) => {
      if (blockedRequestIdsRef.current.has(requestId)) {
        blockedRequestIdsRef.current.delete(requestId); return;
      }
      if (chatId) {
        void queryClient.invalidateQueries({ queryKey: ["chats"] });
      }
      if (serverUserMessageId) {
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === pendingUserMessageId ? { ...m, id: serverUserMessageId } : m,
          ),
        );
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
    if (!activeChatId) {
      setIsSidebarOpen(true);
      return;
    }
    const trimmedMessage = chatInput.trim();
    if (!trimmedMessage || chatMutation.isPending || assistantTyping) {
      return;
    }
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    const pendingUserMessageId = `pending-user-${Date.now()}`;
    setChatMessages((prev) => [
      ...prev,
      { id: pendingUserMessageId, role: "user", text: trimmedMessage },
    ]);
    setChatInput("");
    chatMutation.mutate({
      text: trimmedMessage,
      requestId,
      chatId: activeChatId,
      pendingUserMessageId,
    });
  };

  const startEditingMessage = (message: ChatMessage) => {
    if (!activeChatId || !isEditableUserMessage(message.id)) return;
    setEditingMessageId(message.id);
    setEditingMessageText(message.text);
  };

  const cancelEditingMessage = () => {
    setEditingMessageId(null);
    setEditingMessageText("");
  };

  const saveEditedMessage = () => {
    if (!activeChatId || !editingMessageId) return;
    const trimmed = editingMessageText.trim();
    if (!trimmed || editMessageMutation.isPending) return;
    editMessageMutation.mutate({
      chatId: activeChatId,
      messageId: editingMessageId,
      text: trimmed,
    });
  };

  const handleNewChat = () => {
    setCreateTitleInput("");
    setCreateChatError("");
    setIsCreateModalOpen(true);
  };

  const handleCreateChatSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = createTitleInput.trim();
    if (!trimmed || createChatMutation.isPending) return;
    createChatMutation.mutate(trimmed);
  };

  const openRenameModal = (chat: ChatRoomSummary) => {
    setChatContextMenuId(null);
    setRenameTarget(chat);
    setRenameTitleInput(chat.title);
  };

  const handleRenameChatSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameTarget) return;
    const trimmed = renameTitleInput.trim();
    if (!trimmed || updateChatMutation.isPending) return;
    updateChatMutation.mutate({ chatId: renameTarget.id, title: trimmed });
  };

  const handleDeleteChatInList = (chat: ChatRoomSummary) => {
    setChatContextMenuId(null);
    setDeleteTarget(chat);
  };

  const handleConfirmDeleteChat = () => {
    if (!deleteTarget || deleteChatMutation.isPending) return;
    deleteChatMutation.mutate(deleteTarget.id);
  };

  const stopConversation = () => {
    if (chatMutation.isPending) blockedRequestIdsRef.current.add(requestSequenceRef.current);
    setAssistantTyping(null);
  };

  const waitingMessage = useWaitingChatMessage(chatMutation.isPending);
  const isConversationRunning = chatMutation.isPending || Boolean(assistantTyping);
  const inputEmpty = !chatInput.trim();
  const selectedModelLabel =
    chatModelOptions.find((m) => m.id === selectedModelId)?.label ?? chatModelOptions[0]?.label ?? "";
  const hasActiveChatroom = Boolean(activeChatId);
  const modelPickerDisabled =
    !hasActiveChatroom || chatMutation.isPending || Boolean(assistantTyping) || updateModelMutation.isPending;
  const inputDisabled = !hasActiveChatroom || isConversationRunning;
  const showNoChatroomPrompt = !hasActiveChatroom && !isHistoryLoading;
  const showGreetingEmpty =
    showNewChatIntro &&
    hasActiveChatroom &&
    !isHistoryLoading &&
    chatMessages.length === 1 &&
    chatMessages[0]?.id === "assistant-greeting" &&
    !chatMutation.isPending;

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
          {/* Header — Reference Librarian + Gemini chrome */}
          <div
            data-chat-chrome
            style={{
              background: C.navy,
              padding: "14px 18px 16px",
              borderRadius: "6px 6px 0 0",
              flexShrink: 0,
            }}
          >
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              marginBottom: 10,
            }}>
              <button
                type="button"
                onClick={() => setIsSidebarOpen((open) => !open)}
                aria-label={isSidebarOpen ? "Close menu" : "Open chats menu"}
                aria-expanded={isSidebarOpen}
                style={{
                  background: isSidebarOpen ? "rgba(255,255,255,0.12)" : "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 2px",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                <MenuIcon color="rgba(255,255,255,0.85)" />
              </button>
              <BookIcon size={20} color={C.gold} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: fontSerif, fontSize: 15, fontWeight: 700,
                  color: "white", lineHeight: 1.2,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {activeChatTitle || "AI Assistant"}
                </div>
                <div style={{
                  fontFamily: fontBody, fontSize: 11, fontStyle: "italic",
                  color: "rgba(255,255,255,0.55)", marginTop: 2,
                }}>
                  Ask about manuals and documents
                </div>
              </div>
              <button
                type="button"
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
                  textAlign: "left",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {updateModelMutation.isPending ? "Switching model…" : selectedModelLabel}
                </span>
                <ChevronDownIcon open={isModelMenuOpen} stroke={C.navy} />
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
                    zIndex: 60,
                    listStyle: "none",
                    margin: 0,
                    padding: "4px 0",
                    background: C.paper,
                    border: `1px solid ${C.border}`,
                    borderRadius: 3,
                    boxShadow: "0 10px 28px rgba(0,0,0,0.12)",
                  }}
                >
                  {chatModelOptions.map((option) => {
                    const sel = option.id === selectedModelId;
                    return (
                      <li key={option.id} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={sel}
                          onClick={() => {
                            const previousModelId = selectedModelId;
                            setSelectedModelId(option.id);
                            setIsModelMenuOpen(false);
                            if (option.id !== previousModelId) {
                              updateModelMutation.mutate(option.id, {
                                // Backend rejected the switch — fall back to the model that's actually active.
                                onError: () => setSelectedModelId(previousModelId),
                              });
                            }
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
              {updateModelMutation.isError && (
                <p role="alert" style={{
                  margin: "4px 2px 0", fontFamily: fontBody, fontSize: 10.5,
                  color: "#e6b0a0",
                }}>
                  Couldn't switch models — still using {selectedModelLabel}.
                </p>
              )}
            </div>
          </div>

          <div style={{ height: 1, background: C.border, flexShrink: 0 }} />

          {/* Main area + sidebar */}
          <div style={{ position: "relative", flex: 1, display: "flex", minHeight: 0 }}>
            {isSidebarOpen && (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(26,39,68,0.25)",
                  zIndex: 15,
                }}
                onClick={() => setIsSidebarOpen(false)}
              />
            )}

            <aside
              data-chat-sidebar
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 260,
                zIndex: 20,
                background: C.paper,
                borderRight: `1px solid ${C.border}`,
                display: "flex",
                flexDirection: "column",
                transform: isSidebarOpen ? "translateX(0)" : "translateX(-100%)",
                transition: "transform 220ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
                boxShadow: isSidebarOpen ? "4px 0 20px rgba(0,0,0,0.08)" : "none",
                pointerEvents: isSidebarOpen ? "auto" : "none",
              }}
            >
              <div style={{ padding: "12px 10px 8px" }}>
                <button
                  type="button"
                  onClick={handleNewChat}
                  disabled={createChatMutation.isPending}
                  style={{
                    width: "100%",
                    padding: "9px 14px",
                    borderRadius: 4,
                    border: `1px solid ${C.border}`,
                    background: C.navy,
                    cursor: createChatMutation.isPending ? "not-allowed" : "pointer",
                    fontFamily: fontBody,
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    color: C.paper,
                    opacity: createChatMutation.isPending ? 0.6 : 1,
                  }}
                >
                  + New chat
                </button>
              </div>

              <div style={{
                padding: "6px 14px 8px",
                fontFamily: fontBody,
                fontSize: 11,
                fontStyle: "italic",
                color: C.muted,
                letterSpacing: "0.06em",
              }}>
                Recent conversations
              </div>

              <div className="lib-chat-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "0 10px 12px" }}>
                {chatsQuery.isLoading && (
                  <p style={{ fontFamily: fontBody, fontSize: 13, color: C.muted, textAlign: "center", margin: "16px 0" }}>
                    Loading…
                  </p>
                )}
                {chatsQuery.isError && (
                  <p style={{ fontFamily: fontBody, fontSize: 12, color: "#8b3a3a", textAlign: "center", margin: "16px 8px" }}>
                    Could not load chats.
                  </p>
                )}
                {!chatsQuery.isLoading && !chatsQuery.isError && chats.length === 0 && (
                  <p style={{ fontFamily: fontBody, fontSize: 12, color: C.muted, textAlign: "center", margin: "16px 8px" }}>
                    No conversations yet.
                  </p>
                )}
                {chats.map((chat) => {
                  const isActive = chat.id === activeChatId;
                  return (
                    <div
                      key={chat.id}
                      style={{
                        position: "relative",
                        display: "flex",
                        alignItems: "stretch",
                        marginBottom: 8,
                        border: `1px solid ${isActive ? C.gold : C.border}`,
                        borderRadius: 4,
                        background: isActive ? "rgba(201,124,42,0.08)" : "white",
                        overflow: "visible",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => openConversation(chat)}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          textAlign: "left",
                          border: "none",
                          background: "transparent",
                          padding: "10px 32px 10px 12px",
                          cursor: "pointer",
                          fontFamily: fontBody,
                          fontSize: 13,
                          fontWeight: isActive ? 600 : 400,
                          color: C.navy,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {chat.title}
                      </button>
                      <button
                        type="button"
                        aria-label={`Options for ${chat.title}`}
                        aria-expanded={chatContextMenuId === chat.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setChatContextMenuId((id) => (id === chat.id ? null : chat.id));
                        }}
                        style={{
                          position: "absolute",
                          right: 4,
                          top: "50%",
                          transform: "translateY(-50%)",
                          width: 28,
                          height: 28,
                          border: "none",
                          borderRadius: "50%",
                          background: chatContextMenuId === chat.id ? "rgba(26,39,68,0.08)" : "transparent",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <MoreVerticalIcon />
                      </button>
                      {chatContextMenuId === chat.id && (
                        <div
                          data-chat-context-menu
                          role="menu"
                          style={{
                            position: "absolute",
                            right: 8,
                            top: "100%",
                            zIndex: 30,
                            minWidth: 160,
                            background: C.paper,
                            border: `1px solid ${C.border}`,
                            borderRadius: 3,
                            boxShadow: "0 10px 28px rgba(0,0,0,0.12)",
                            padding: "4px 0",
                            marginTop: 2,
                          }}
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => openRenameModal(chat)}
                            style={contextMenuItemStyle}
                          >
                            <PencilIcon size={16} />
                            Rename
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => handleDeleteChatInList(chat)}
                            style={{ ...contextMenuItemStyle, color: "#8b3a3a" }}
                          >
                            <TrashIcon size={16} />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </aside>

            {/* Messages */}
            <div
              ref={chatViewportRef}
              onScroll={handleChatViewportScroll}
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
                width: "100%",
              }}
            >
              {showNoChatroomPrompt && (
                <div style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  padding: "24px 16px",
                  gap: 16,
                }}>
                  <BookIcon size={36} color={C.gold} />
                  <p style={{
                    margin: 0,
                    fontFamily: fontSerif,
                    fontSize: 17,
                    fontWeight: 700,
                    color: C.navy,
                    lineHeight: 1.35,
                  }}>
                    Start a chatroom first
                  </p>
                  <p style={{
                    margin: 0,
                    fontFamily: fontBody,
                    fontSize: 13,
                    color: C.muted,
                    maxWidth: 260,
                    lineHeight: 1.55,
                  }}>
                    Create a new chatroom or open an existing one from the menu before sending messages to the AI.
                  </p>
                  <button
                    type="button"
                    onClick={handleNewChat}
                    style={{
                      fontFamily: fontBody,
                      fontSize: 13,
                      fontWeight: 600,
                      padding: "9px 18px",
                      border: "none",
                      borderRadius: 3,
                      background: C.navy,
                      color: C.paper,
                      cursor: "pointer",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Create chatroom
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsSidebarOpen(true)}
                    style={{
                      fontFamily: fontBody,
                      fontSize: 12,
                      padding: 0,
                      border: "none",
                      background: "none",
                      color: C.gold,
                      cursor: "pointer",
                      textDecoration: "underline",
                      textUnderlineOffset: 2,
                    }}
                  >
                    Browse existing chatrooms
                  </button>
                </div>
              )}

              {showGreetingEmpty && (
                <div style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  padding: "16px 8px",
                  gap: 14,
                }}>
                  <BookIcon size={36} color={C.gold} />
                  <div style={{
                    maxWidth: "92%",
                    fontFamily: fontBody,
                    fontSize: 13,
                    color: "#3a3020",
                    lineHeight: 1.7,
                    textAlign: "left",
                    borderLeft: `2px solid ${C.gold}`,
                    background: "rgba(201,124,42,0.04)",
                    borderRadius: "0 4px 4px 0",
                    padding: "12px 14px",
                  }}>
                    {renderMessageText(buildInitialGreeting(folderId, contextLabel), "assistant")}
                  </div>
                </div>
              )}

              {isHistoryLoading && chatMessages.length === 0 && (
                <p style={{ fontFamily: fontBody, fontSize: 13, color: C.muted, textAlign: "center" }}>
                  Loading history…
                </p>
              )}
              {!isHistoryLoading && !showNoChatroomPrompt && !showGreetingEmpty && chatMessages.map(message => {
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
                              {renderMessageText(message.text, "assistant")}
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
                  <UserMessageBubble
                    key={message.id}
                    message={message}
                    isEditing={editingMessageId === message.id}
                    editingText={editingMessageText}
                    onEditingTextChange={setEditingMessageText}
                    onStartEdit={() => startEditingMessage(message)}
                    onCancelEdit={cancelEditingMessage}
                    onSaveEdit={saveEditedMessage}
                    isSavingEdit={editMessageMutation.isPending}
                    canEdit={Boolean(activeChatId) && isEditableUserMessage(message.id)}
                  />
                );
              })}

              {/* Waiting for the AI's answer — rotates through reassuring phrases the longer it takes */}
              {hasActiveChatroom && chatMutation.isPending && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 14 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }} aria-hidden>
                    {[0, 1, 2].map((i) => (
                      <span key={i} style={{
                        width: 4, height: 4, borderRadius: "50%", background: C.gold,
                        animation: `uploadDotPulse 1s ease-in-out ${i * 0.15}s infinite`,
                      }} />
                    ))}
                  </span>
                  <p
                    key={waitingMessage}
                    role="status"
                    aria-live="polite"
                    style={{
                      fontFamily: fontBody, fontSize: 12, fontStyle: "italic",
                      color: C.muted, margin: 0,
                      animation: "chatWaitingFadeIn 320ms ease",
                    }}
                  >
                    {waitingMessage}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Input area */}
          <form
            onSubmit={submitChatMessage}
            style={{
              background: C.paper,
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexShrink: 0,
            }}
          >
            <TextareaWithFocus
              ref={textareaRef}
              value={chatInput}
              onChange={v => setChatInput(v)}
              onEnterSubmit={() => {
                if (!inputEmpty && !inputDisabled) {
                  const fakeEvent = { preventDefault: () => { } } as FormEvent<HTMLFormElement>;
                  submitChatMessage(fakeEvent);
                }
              }}
              placeholder={
                hasActiveChatroom
                  ? "Ask about a manual or chapter…"
                  : "Create or select a chatroom to start…"
              }
              disabled={inputDisabled}
            />
            <button
              type={isConversationRunning ? "button" : "submit"}
              onClick={isConversationRunning ? stopConversation : undefined}
              disabled={!hasActiveChatroom || (!isConversationRunning && inputEmpty)}
              style={{
                background: isConversationRunning
                  ? C.gold
                  : inputEmpty ? "#c8b89a" : C.navy,
                color: C.paper,
                fontFamily: fontBody, fontSize: 12,
                letterSpacing: "0.06em",
                border: "none", borderRadius: 3,
                padding: "7px 14px",
                cursor: (!hasActiveChatroom || (!isConversationRunning && inputEmpty)) ? "default" : "pointer",
                opacity: !hasActiveChatroom ? 0.5 : 1,
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

      {isCreateModalOpen && (
        <ChatTitleDialog
          heading="New chat"
          label="Chat title"
          value={createTitleInput}
          onChange={setCreateTitleInput}
          submitLabel="Create"
          isSubmitting={createChatMutation.isPending}
          error={createChatError}
          onClose={() => {
            if (createChatMutation.isPending) return;
            setIsCreateModalOpen(false);
            setCreateTitleInput("");
            setCreateChatError("");
          }}
          onSubmit={handleCreateChatSubmit}
        />
      )}

      {renameTarget && (
        <ChatTitleDialog
          heading="Rename chat"
          label="Chat title"
          value={renameTitleInput}
          onChange={setRenameTitleInput}
          submitLabel="Save"
          isSubmitting={updateChatMutation.isPending}
          onClose={() => {
            if (updateChatMutation.isPending) return;
            setRenameTarget(null);
            setRenameTitleInput("");
          }}
          onSubmit={handleRenameChatSubmit}
        />
      )}

      {deleteTarget && (
        <ChatConfirmDialog
          heading="Delete chat"
          description={`Delete "${deleteTarget.title}"? This conversation and its messages will be removed permanently.`}
          confirmLabel="Delete"
          isSubmitting={deleteChatMutation.isPending}
          destructive
          onClose={() => {
            if (deleteChatMutation.isPending) return;
            setDeleteTarget(null);
          }}
          onConfirm={handleConfirmDeleteChat}
        />
      )}
    </>
  );
}

const contextMenuItemStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 14px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontFamily: fontBody,
  fontSize: 13,
  color: C.navy,
  textAlign: "left",
};

function MenuIcon({ color = C.navy }: { color?: string }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function ChevronDownIcon({ open, stroke = C.muted }: { open: boolean; stroke?: string }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 20 20"
      fill="none"
      stroke={stroke}
      strokeWidth={2}
      aria-hidden
      style={{
        transform: open ? "rotate(180deg)" : "none",
        transition: "transform 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        flexShrink: 0,
      }}
    >
      <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MoreVerticalIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill={C.muted} aria-hidden>
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function PencilIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-1 14H9a1 1 0 0 1-1-1V7h12v12a1 1 0 0 1-1 1z" />
    </svg>
  );
}

function ChatTitleDialog({
  heading,
  label,
  value,
  onChange,
  submitLabel,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: {
  heading: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  submitLabel: string;
  isSubmitting: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-title-dialog-heading"
      data-chat-dialog
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(26,39,68,0.45)",
        padding: 16,
      }}
      onClick={onClose}
    >
      <form
        onSubmit={onSubmit}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 320,
          background: C.paper,
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          boxShadow: "0 16px 48px rgba(0,0,0,0.2)",
          padding: "18px 20px",
          fontFamily: fontBody,
        }}
      >
        <h2
          id="chat-title-dialog-heading"
          style={{
            margin: "0 0 14px",
            fontFamily: fontSerif,
            fontSize: 17,
            fontWeight: 700,
            color: C.navy,
          }}
        >
          {heading}
        </h2>
        {error ? (
          <p style={{
            margin: "0 0 12px",
            fontFamily: fontBody,
            fontSize: 12,
            color: "#8b3a3a",
            lineHeight: 1.45,
          }}>
            {error}
          </p>
        ) : null}
        <label
          htmlFor="chat-title-input"
          style={{ display: "block", fontSize: 12, color: C.muted, marginBottom: 6 }}
        >
          {label}
        </label>
        <input
          ref={inputRef}
          id="chat-title-input"
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={isSubmitting}
          placeholder="Enter a title"
          maxLength={120}
          style={{
            width: "100%",
            boxSizing: "border-box",
            fontFamily: fontBody,
            fontSize: 14,
            color: C.navy,
            border: `1px solid ${C.border}`,
            borderRadius: 3,
            padding: "8px 10px",
            marginBottom: 16,
            outline: "none",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              fontFamily: fontBody,
              fontSize: 12,
              padding: "7px 14px",
              border: `1px solid ${C.border}`,
              borderRadius: 3,
              background: "white",
              color: C.navy,
              cursor: isSubmitting ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !value.trim()}
            style={{
              fontFamily: fontBody,
              fontSize: 12,
              fontWeight: 600,
              padding: "7px 14px",
              border: "none",
              borderRadius: 3,
              background: C.navy,
              color: C.paper,
              cursor: isSubmitting || !value.trim() ? "not-allowed" : "pointer",
              opacity: isSubmitting || !value.trim() ? 0.6 : 1,
            }}
          >
            {isSubmitting ? `${submitLabel}…` : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function ChatConfirmDialog({
  heading,
  description,
  confirmLabel,
  isSubmitting,
  destructive = false,
  onClose,
  onConfirm,
}: {
  heading: string;
  description: string;
  confirmLabel: string;
  isSubmitting: boolean;
  destructive?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="chat-confirm-dialog-heading"
      aria-describedby="chat-confirm-dialog-description"
      data-chat-dialog
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(26,39,68,0.45)",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 320,
          background: C.paper,
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          boxShadow: "0 16px 48px rgba(0,0,0,0.2)",
          padding: "18px 20px",
          fontFamily: fontBody,
        }}
      >
        <h2
          id="chat-confirm-dialog-heading"
          style={{
            margin: "0 0 10px",
            fontFamily: fontSerif,
            fontSize: 17,
            fontWeight: 700,
            color: C.navy,
          }}
        >
          {heading}
        </h2>
        <p
          id="chat-confirm-dialog-description"
          style={{
            margin: "0 0 18px",
            fontFamily: fontBody,
            fontSize: 13,
            color: C.muted,
            lineHeight: 1.55,
          }}
        >
          {description}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              fontFamily: fontBody,
              fontSize: 12,
              padding: "7px 14px",
              border: `1px solid ${C.border}`,
              borderRadius: 3,
              background: "white",
              color: C.navy,
              cursor: isSubmitting ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            style={{
              fontFamily: fontBody,
              fontSize: 12,
              fontWeight: 600,
              padding: "7px 14px",
              border: "none",
              borderRadius: 3,
              background: destructive ? "#8b3a3a" : C.navy,
              color: C.paper,
              cursor: isSubmitting ? "not-allowed" : "pointer",
              opacity: isSubmitting ? 0.6 : 1,
            }}
          >
            {isSubmitting ? `${confirmLabel}…` : confirmLabel}
          </button>
        </div>
      </div>
    </div>
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

const WAITING_MESSAGES = [
  "Consulting the archive…",
  "Searching through the pages…",
  "Cross-referencing your manuals…",
  "Almost there…",
  "Still working on it — thanks for your patience…",
];

/**
 * Rotates through reassuring phrases the longer an answer takes, instead of one static line —
 * folder RAG lookups can legitimately take 15-25s, and visible progress reads as "still working"
 * rather than "stuck" (see the backend's `/folders/:folderId/query` Gemini file-search endpoint).
 */
function useWaitingChatMessage(active: boolean): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) {
      setIndex(0);
      return;
    }
    const stepTimesMs = [4000, 9000, 15000, 24000];
    const timers = stepTimesMs.map((delay, i) => window.setTimeout(() => setIndex(i + 1), delay));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [active]);
  return WAITING_MESSAGES[Math.min(index, WAITING_MESSAGES.length - 1)];
}

function isEditableUserMessage(messageId: string): boolean {
  return !messageId.startsWith("pending-user-") && !messageId.endsWith("-assistant-error");
}

function pickUserMessageIdFromResponse(payload: unknown): string | undefined {
  if (payload == null || typeof payload !== "object") {
    return undefined;
  }
  const r = payload as Record<string, unknown>;
  const direct =
    (typeof r.userMessageId === "string" && r.userMessageId.trim()) ||
    (typeof r.messageId === "string" && r.messageId.trim()) ||
    "";
  if (direct) {
    return direct;
  }
  const userMessage = r.userMessage;
  if (userMessage != null && typeof userMessage === "object") {
    const m = userMessage as Record<string, unknown>;
    if (typeof m.id === "string" && m.id.trim()) {
      return m.id.trim();
    }
  }
  return undefined;
}

function UserMessageBubble({
  message,
  isEditing,
  editingText,
  onEditingTextChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  isSavingEdit,
  canEdit,
}: {
  message: ChatMessage;
  isEditing: boolean;
  editingText: string;
  onEditingTextChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  isSavingEdit: boolean;
  canEdit: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!isEditing || !editInputRef.current) return;
    editInputRef.current.focus();
    editInputRef.current.style.height = "auto";
    editInputRef.current.style.height = `${editInputRef.current.scrollHeight}px`;
  }, [isEditing, editingText]);

  const showActions = (isHovered || isEditing) && !isSavingEdit;

  return (
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", maxWidth: "100%" }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isEditing ? (
        <div style={{
          width: "85%",
          maxWidth: "85%",
          borderRight: `2px solid ${C.navy}`,
          paddingRight: 4,
        }}>
          <textarea
            ref={editInputRef}
            value={editingText}
            onChange={(e) => onEditingTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSaveEdit();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                onCancelEdit();
              }
            }}
            rows={2}
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontFamily: fontBody,
              fontSize: 13,
              color: C.navy,
              lineHeight: 1.6,
              border: `1px solid ${C.border}`,
              borderRadius: 3,
              padding: "8px 10px",
              resize: "vertical",
              minHeight: 56,
              background: "#fff",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              onClick={onCancelEdit}
              disabled={isSavingEdit}
              style={{
                fontFamily: fontBody,
                fontSize: 11,
                padding: "5px 10px",
                border: `1px solid ${C.border}`,
                borderRadius: 3,
                background: "#fff",
                color: C.navy,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSaveEdit}
              disabled={isSavingEdit || !editingText.trim()}
              style={{
                fontFamily: fontBody,
                fontSize: 11,
                fontWeight: 600,
                padding: "5px 10px",
                border: "none",
                borderRadius: 3,
                background: C.navy,
                color: C.paper,
                cursor: isSavingEdit || !editingText.trim() ? "not-allowed" : "pointer",
                opacity: isSavingEdit || !editingText.trim() ? 0.6 : 1,
              }}
            >
              {isSavingEdit ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{
            borderRight: `2px solid ${C.navy}`,
            padding: "8px 12px 8px 0",
            marginRight: 4,
            fontFamily: fontBody,
            fontSize: 13,
            color: C.navy,
            lineHeight: 1.6,
            maxWidth: "85%",
            textAlign: "right",
            wordBreak: "break-word",
          }}>
            {renderMessageText(message.text, "user")}
          </div>
          {showActions && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginTop: 4,
              paddingRight: 8,
            }}>
              <MessageCopyButton text={message.text} variant="user" />
              {canEdit && (
                <button
                  type="button"
                  onClick={onStartEdit}
                  aria-label="Edit message"
                  title="Edit message"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    border: `1px solid ${C.border}`,
                    background: "#fff",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: C.muted,
                    padding: 0,
                  }}
                >
                  <PencilIcon size={14} />
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function historyToChatMessages(
  messages: ChatHistoryMessage[],
  folderId: string,
  contextLabel?: string,
  options?: { emptyGreeting?: boolean },
): ChatMessage[] {
  if (messages.length === 0) {
    if (options?.emptyGreeting === false) {
      return [];
    }
    return [{
      id: "assistant-greeting",
      role: "assistant",
      text: buildInitialGreeting(folderId, contextLabel),
    }];
  }
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    text: message.content,
    referencedPages: message.referencedPages
      ? normalizeReferencedPages(message.referencedPages)
      : undefined,
  }));
}

function formatChatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
  const filename = typeof r.filename === "string" ? r.filename.trim().replace(/\.pdf$/i, "") : "";
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


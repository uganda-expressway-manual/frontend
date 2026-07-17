"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { PdfViewerPageLoading } from "@/components/pdf-loading-ui";
import { DocumentChatWidget } from "@/components/document-chat-widget";
import {
  api,
  createBookmark,
  createHighlight,
  createNote,
  deleteBookmark,
  deleteHighlight,
  deleteNote,
  getBookmarks,
  getHighlights,
  getNotes,
  getPdfViewerPresignedUrl,
  updateHighlightColor,
  updateNote,
} from "@/lib/api";
import { triggerDirectDownload } from "@/lib/pdf-download";
import { isViewerUser } from "@/lib/auth-user";
import { useAuth } from "@/lib/hooks/use-auth";
import { READER_CHAT_ROOM } from "@/lib/reader-chat-room";
import { useFixedChromeInverseScale } from "@/lib/hooks/use-fixed-chrome-inverse-scale";
import { FileDetails, HighlightItem, NoteItem } from "@/lib/types";
import type { PdfPageHighlight, PdfTextSelection } from "@/components/pdf-viewer";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

const PDFViewer = dynamic(() => import("@/components/pdf-viewer").then((mod) => mod.PDFViewer), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl border border-slate-200/90 bg-slate-50/80 px-4 py-6 text-center">
      <p className="text-sm font-medium text-slate-600">Preparing viewer…</p>
      <div className="mx-auto mt-3 h-1.5 max-w-[200px] overflow-hidden rounded-full bg-slate-200">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500/80" />
      </div>
    </div>
  ),
});

type BookmarkColorId = "silver" | "sand" | "ice" | "sage";
type PageToneId = "white" | "ivory" | "mist";
type CoverToneId = "slate" | "stone" | "forest";
type HighlightColorId = "yellow" | "green" | "blue" | "pink";
type PopoverPanelId = "bookmark" | "highlights" | "notes" | "settings" | null;

interface HighlightColorOption {
  id: HighlightColorId;
  label: string;
  /** Visible CSS color used both in the picker swatch and on the rendered text-layer mark. */
  swatch: string;
}

const HIGHLIGHT_COLOR_OPTIONS: HighlightColorOption[] = [
  { id: "yellow", label: "Yellow", swatch: "#fde68a" },
  { id: "green", label: "Mint", swatch: "#bbf7d0" },
  { id: "blue", label: "Sky", swatch: "#bfdbfe" },
  { id: "pink", label: "Pink", swatch: "#fbcfe8" },
];

function resolveHighlightColorId(value: string | null | undefined): HighlightColorId {
  if (typeof value === "string") {
    const found = HIGHLIGHT_COLOR_OPTIONS.find((option) => option.id === value);
    if (found) {
      return found.id;
    }
  }
  return "yellow";
}

function getHighlightSwatch(id: HighlightColorId): string {
  const found = HIGHLIGHT_COLOR_OPTIONS.find((option) => option.id === id);
  return found?.swatch ?? "#fde68a";
}

const BOOKMARK_COLOR_OPTIONS: Array<{ id: BookmarkColorId; label: string; swatch: string }> = [
  { id: "silver", label: "Silver", swatch: "#dfe1e5" },
  { id: "sand", label: "Sand", swatch: "#e8dfd2" },
  { id: "ice", label: "Ice", swatch: "#d7e4ec" },
  { id: "sage", label: "Sage", swatch: "#e2e7dc" },
];

const PAGE_TONE_OPTIONS: Array<{ id: PageToneId; label: string; swatch: string }> = [
  { id: "white", label: "White", swatch: "#ffffff" },
  { id: "ivory", label: "Ivory", swatch: "#f8f2e6" },
  { id: "mist", label: "Mist", swatch: "#f2f5fb" },
];

const COVER_TONE_OPTIONS: Array<{ id: CoverToneId; label: string; swatch: string }> = [
  { id: "slate", label: "Slate", swatch: "#e2e8f0" },
  { id: "stone", label: "Stone", swatch: "#e7ddd2" },
  { id: "forest", label: "Forest", swatch: "#dbe5d8" },
];

export default function FileViewerPage() {
  const params = useParams<{ fileId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canDownloadPdf = !isViewerUser(user);
  const fileId = params.fileId;
  const keyword = searchParams.get("keyword") ?? "";
  const page = Number(searchParams.get("page") ?? "1");
  const returnToParam = searchParams.get("returnTo");
  const previewParam = searchParams.get("preview");
  const previewMode =
    previewParam !== null &&
    previewParam.trim().toLowerCase() !== "0" &&
    previewParam.trim().toLowerCase() !== "false" &&
    previewParam.trim().toLowerCase() !== "no";
  const initialPage = Number.isFinite(page) && page > 0 ? page : 1;
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [activeKeywordHitIndex, setActiveKeywordHitIndex] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [bookmarkedPages, setBookmarkedPages] = useState<number[]>([]);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);
  const [bookmarkColor, setBookmarkColor] = useState<BookmarkColorId>("silver");
  const [pageTone, setPageTone] = useState<PageToneId>("white");
  const [coverTone, setCoverTone] = useState<CoverToneId>("slate");
  const [highlightColor, setHighlightColor] = useState<HighlightColorId>("yellow");
  const [hoveredPanel, setHoveredPanel] = useState<PopoverPanelId>(null);
  const [pinnedPanel, setPinnedPanel] = useState<PopoverPanelId>(null);
  const [pdfTextSelection, setPdfTextSelection] = useState<PdfTextSelection | null>(null);
  /** Open note composer (driven by the "Add note" button on the floating toolbar or the notes panel). */
  const [composeNote, setComposeNote] = useState<{ page: number; preset: string } | null>(null);
  const [showFullscreenMenu, setShowFullscreenMenu] = useState(false);
  const [isTouchLikeInput, setIsTouchLikeInput] = useState(false);
  const [visiblePages, setVisiblePages] = useState<number[]>([]);
  const [bookmarkTargetPage, setBookmarkTargetPage] = useState<number | null>(null);
  const [viewerPdfSrc, setViewerPdfSrc] = useState("");
  const [fullscreenSearchDraft, setFullscreenSearchDraft] = useState("");
  /** Controlled draft for “go to page” (synced from `currentPage` when the viewer moves). */
  const [pageJumpDraft, setPageJumpDraft] = useState(String(initialPage));
  const viewerSectionRef = useRef<HTMLElement | null>(null);
  const lastTapTimeRef = useRef(0);
  const hideFullscreenMenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFullscreen = isNativeFullscreen || isPseudoFullscreen;

  /** Continues the "picking up the book and opening it" motion from the shelf into this page. */
  const [pageMounted, setPageMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setPageMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const entranceStyle = !isFullscreen
    ? {
        opacity: pageMounted ? 1 : 0,
        /* "none" (not an identity transform) once mounted — a non-none transform here would
           create a CSS containing block and break the DocumentChatWidget's fixed positioning
           (it would clip to this section instead of floating relative to the viewport). */
        transform: pageMounted ? "none" : "translateY(16px) scale(0.985)",
        transition: "opacity 380ms ease-out, transform 380ms ease-out",
      }
    : undefined;

  const [fileFetchProgress, setFileFetchProgress] = useState<{ loaded: number; total: number | null } | null>(null);

  /**
   * Multiplier applied as `transform: scale(...)` to the fullscreen overlay chrome
   * (search popup, page badge, bookmark, exit-fullscreen) so the bar stays a stable
   * on-screen size regardless of pinch-zoom or desktop Ctrl + / − browser zoom.
   */
  const fixedChromeInverseScale = useFixedChromeInverseScale();

  const fileQuery = useQuery({
    queryKey: ["file", fileId],
    queryFn: async ({ signal }) => {
      setFileFetchProgress({ loaded: 0, total: null });
      const { data } = await api.get<FileDetails>(`/files/${fileId}`, {
        signal,
        onDownloadProgress: (evt) => {
          const total = evt.total && evt.total > 0 ? evt.total : null;
          setFileFetchProgress({ loaded: evt.loaded, total });
        },
      });
      setFileFetchProgress((prev) =>
        prev?.total ? { loaded: prev.total, total: prev.total } : { loaded: 1, total: 1 },
      );
      return data;
    },
    enabled: Boolean(fileId),
  });

  useEffect(() => {
    setFileFetchProgress(null);
  }, [fileId]);

  /**
   * Resolve the presigned S3 URL from EC2 and hand the string straight to `PDFViewer`. PDF.js
   * fetches the bytes itself (range requests included), so the bucket's CORS for this origin must
   * allow `GET` plus the `Range` request header. `<PDFViewer key={viewerPdfSrc}>` remounts only
   * when the URL actually changes, so re-renders here do not retrigger downloads.
   */
  useEffect(() => {
    if (!fileId) {
      return;
    }
    const ctrl = new AbortController();
    let cancelled = false;
    setViewerPdfSrc("");
    void (async () => {
      try {
        const { url } = await getPdfViewerPresignedUrl(fileId, ctrl.signal);
        if (!cancelled) {
          setViewerPdfSrc(url);
        }
      } catch (e) {
        if (cancelled || ctrl.signal.aborted) {
          return;
        }
        const err = e instanceof Error ? e : new Error(String(e));
        if (axios.isCancel(e) || err.name === "AbortError" || err.name === "CanceledError") {
          return;
        }
        console.error(`[pdf-viewer] presign failed: ${err.message}`);
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [fileId]);

  const bookmarksQuery = useQuery({
    queryKey: ["bookmarks", fileId],
    queryFn: async () => getBookmarks(fileId),
    enabled: Boolean(fileId),
  });

  const createBookmarkMutation = useMutation({
    mutationFn: createBookmark,
  });

  const deleteBookmarkMutation = useMutation({
    mutationFn: deleteBookmark,
  });

  const highlightsQuery = useQuery({
    queryKey: ["highlights", fileId],
    queryFn: async () => getHighlights(fileId),
    enabled: Boolean(fileId),
  });

  const createHighlightMutation = useMutation({
    mutationFn: createHighlight,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["highlights", fileId] });
    },
  });

  const updateHighlightColorMutation = useMutation({
    mutationFn: async (input: { id: string; color: HighlightColorId }) =>
      updateHighlightColor(input.id, input.color),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["highlights", fileId] });
    },
  });

  const deleteHighlightMutation = useMutation({
    mutationFn: async (id: string) => deleteHighlight(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["highlights", fileId] });
    },
  });

  const notesQuery = useQuery({
    queryKey: ["notes", fileId],
    queryFn: async () => getNotes(fileId),
    enabled: Boolean(fileId),
  });

  const createNoteMutation = useMutation({
    mutationFn: createNote,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notes", fileId] });
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: async (input: { id: string; body: string; page: number }) =>
      updateNote(fileId, input.id, { body: input.body, page: input.page }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notes", fileId] });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (id: string) => deleteNote(fileId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notes", fileId] });
    },
  });

  useEffect(() => {
    setCurrentPage(initialPage);
  }, [initialPage]);

  useEffect(() => {
    setPageJumpDraft(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    if (!bookmarksQuery.data) {
      return;
    }
    const normalized = bookmarksQuery.data
      .map((item) => item.page)
      .filter((item) => Number.isFinite(item) && item > 0)
      .sort((a, b) => a - b);
    setBookmarkedPages(Array.from(new Set(normalized)));
  }, [bookmarksQuery.data]);

  useEffect(() => {
    const storedColor = window.localStorage.getItem(getBookmarkColorStorageKey(fileId));
    if (!storedColor || !isBookmarkColorId(storedColor)) {
      setBookmarkColor("silver");
      return;
    }
    setBookmarkColor(storedColor);
  }, [fileId]);

  useEffect(() => {
    window.localStorage.setItem(getBookmarkColorStorageKey(fileId), bookmarkColor);
  }, [bookmarkColor, fileId]);

  useEffect(() => {
    const storedPageTone = window.localStorage.getItem(getPageToneStorageKey(fileId));
    if (!storedPageTone || !isPageToneId(storedPageTone)) {
      setPageTone("white");
      return;
    }
    setPageTone(storedPageTone);
  }, [fileId]);

  useEffect(() => {
    window.localStorage.setItem(getPageToneStorageKey(fileId), pageTone);
  }, [fileId, pageTone]);

  useEffect(() => {
    const storedCoverTone = window.localStorage.getItem(getCoverToneStorageKey(fileId));
    if (!storedCoverTone || !isCoverToneId(storedCoverTone)) {
      setCoverTone("slate");
      return;
    }
    setCoverTone(storedCoverTone);
  }, [fileId]);

  useEffect(() => {
    window.localStorage.setItem(getCoverToneStorageKey(fileId), coverTone);
  }, [coverTone, fileId]);

  useEffect(() => {
    const storedHighlightColor = window.localStorage.getItem(getHighlightColorStorageKey(fileId));
    if (!storedHighlightColor || !isHighlightColorId(storedHighlightColor)) {
      setHighlightColor("yellow");
      return;
    }
    setHighlightColor(storedHighlightColor);
  }, [fileId]);

  useEffect(() => {
    window.localStorage.setItem(getHighlightColorStorageKey(fileId), highlightColor);
  }, [fileId, highlightColor]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const inFullscreen = document.fullscreenElement === viewerSectionRef.current;
      setIsNativeFullscreen(inFullscreen);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (isPseudoFullscreen) {
        setIsPseudoFullscreen(false);
        return;
      }
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPseudoFullscreen]);

  useEffect(() => {
    if (!isPseudoFullscreen) {
      return;
    }
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
    };
  }, [isPseudoFullscreen]);

  useEffect(() => {
    if (!visiblePages.length) {
      setBookmarkTargetPage(null);
      return;
    }

    setBookmarkTargetPage((previous) => {
      if (previous && visiblePages.includes(previous)) {
        return previous;
      }
      return visiblePages[0];
    });
  }, [visiblePages]);

  useEffect(() => {
    setHoveredPanel(null);
    setShowFullscreenMenu(false);
  }, [isFullscreen]);

  useEffect(() => {
    setIsTouchLikeInput(window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0);
  }, []);

  useEffect(() => {
    return () => {
      if (hideFullscreenMenuTimerRef.current) {
        clearTimeout(hideFullscreenMenuTimerRef.current);
      }
    };
  }, []);

  /** Full filename with extension — used for the actual download, which needs a real `.pdf` name. */
  const displayFilename = useMemo(
    () => fileQuery.data?.filename?.trim() || `file-${fileId}.pdf`,
    [fileQuery.data?.filename, fileId]
  );
  /** Same name without the `.pdf` tail, for on-screen display only. */
  const displayTitle = useMemo(() => displayFilename.replace(/\.pdf$/i, ""), [displayFilename]);

  const highlights = useMemo<HighlightItem[]>(() => highlightsQuery.data ?? [], [highlightsQuery.data]);
  const notes = useMemo<NoteItem[]>(() => notesQuery.data ?? [], [notesQuery.data]);
  /** Project highlights into the viewer's lightweight `PdfPageHighlight` shape (resolves color id → CSS swatch). */
  const projectedPageHighlights = useMemo<PdfPageHighlight[]>(
    () =>
      highlights.map((entry) => ({
        id: entry.id,
        page: entry.page,
        text: entry.text,
        color: getHighlightSwatch(resolveHighlightColorId(entry.color)),
      })),
    [highlights]
  );
  const returnToHref = useMemo(() => normalizeReturnToHref(returnToParam), [returnToParam]);
  const keywordHits = useMemo(
    () => collectKeywordHitsByPage(fileQuery.data?.content ?? [], keyword),
    [fileQuery.data?.content, keyword]
  );
  const totalKeywordHits = keywordHits.length;
  const currentKeywordHit = totalKeywordHits > 0 ? activeKeywordHitIndex + 1 : 0;
  const activeKeywordTarget = totalKeywordHits > 0 ? keywordHits[activeKeywordHitIndex] ?? null : null;

  useEffect(() => {
    setFullscreenSearchDraft(keyword);
  }, [keyword]);

  const applyKeywordToUrl = useCallback(
    (nextKeyword: string) => {
      const q = new URLSearchParams(searchParams.toString());
      const trimmed = nextKeyword.trim();
      if (trimmed) {
        q.set("keyword", trimmed);
      } else {
        q.delete("keyword");
      }
      router.replace(`${pathname}?${q.toString()}`);
    },
    [pathname, router, searchParams]
  );

  const applyPageToUrl = useCallback(
    (nextPage: number) => {
      const q = new URLSearchParams(searchParams.toString());
      if (nextPage <= 1) {
        q.delete("page");
      } else {
        q.set("page", String(nextPage));
      }
      const qs = q.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (!keywordHits.length) {
      setActiveKeywordHitIndex(0);
      return;
    }

    setActiveKeywordHitIndex(findNearestKeywordHitIndex(keywordHits, currentPage));
  }, [currentPage, keywordHits]);

  const fileMetadataOverallPercent =
    fileFetchProgress?.total != null && fileFetchProgress.total > 0
      ? Math.min(100, Math.round((fileFetchProgress.loaded / fileFetchProgress.total) * 100))
      : null;

  if (fileQuery.isLoading) {
    return (
      <section className="mx-auto w-full max-w-2xl py-8" style={entranceStyle}>
        <PdfViewerPageLoading
          fileMetadataLoaded={false}
          pdfBytesFetched={false}
          overallPercent={fileMetadataOverallPercent}
        />
      </section>
    );
  }

  if (fileQuery.error || !fileQuery.data) {
    const backendError = extractBackendError(fileQuery.error);
    return (
      <section className="mx-auto max-w-3xl rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-orange-50 p-7 shadow-sm">
        <p className="mb-2 inline-flex rounded-full border border-rose-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700">
          Unable to open PDF
        </p>
        <h1 className="text-xl font-semibold text-slate-900">File viewer failed to load</h1>
        <p className="mt-3 rounded-xl border border-rose-100 bg-white/80 p-4 text-sm leading-6 text-slate-700">
          {backendError || "The backend did not return a readable error message. Please try again."}
        </p>
        <div className="mt-5 flex items-center gap-3">
          <Link href="/" className="ui-btn-back">
            Back to library
          </Link>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  if (!viewerPdfSrc) {
    return (
      <section className="mx-auto w-full max-w-2xl py-8" style={entranceStyle}>
        <PdfViewerPageLoading
          fileMetadataLoaded
          pdfBytesFetched={false}
          overallPercent={fileMetadataOverallPercent ?? 99}
          filename={fileQuery.data?.filename ? displayTitle : undefined}
        />
      </section>
    );
  }

  const onDownload = async () => {
    try {
      await triggerDirectDownload(fileId, displayFilename);
    } catch (error: unknown) {
      window.alert(extractBackendError(error));
    }
  };

  const toggleBookmark = (page: number) => {
    setBookmarkedPages((prev) => {
      if (prev.includes(page)) {
        deleteBookmarkMutation.mutate({ fileId, page });
        return prev.filter((item) => item !== page);
      }
      createBookmarkMutation.mutate({ fileId, page, color: bookmarkColor });
      return [...prev, page].sort((a, b) => a - b);
    });
  };

  /**
   * Save the current PDF text selection as a highlight, then clear the browser selection so the
   * floating toolbar dismisses. Color is the user's currently-selected swatch (`highlightColor`),
   * persisted per-file in localStorage. Offsets fall back to `null` until we wire the precise
   * page-text positions through PDF.js getTextContent in a follow-up.
   */
  const saveHighlightFromSelection = (selection: PdfTextSelection) => {
    const trimmed = selection.text.trim();
    if (!trimmed) {
      return;
    }
    createHighlightMutation.mutate({
      fileId,
      page: selection.page,
      text: trimmed,
      color: highlightColor,
      startOffset: null,
      endOffset: null,
    });
    if (typeof window !== "undefined") {
      window.getSelection()?.removeAllRanges();
    }
    setPdfTextSelection(null);
  };

  const openNoteComposerFromSelection = (selection: PdfTextSelection) => {
    setComposeNote({
      page: selection.page,
      preset: selection.text.trim() ? `> ${selection.text.trim()}\n\n` : "",
    });
    if (typeof window !== "undefined") {
      window.getSelection()?.removeAllRanges();
    }
    setPdfTextSelection(null);
  };

  const submitNoteFromComposer = (body: string) => {
    if (!composeNote) {
      return;
    }
    const trimmed = body.trim();
    if (!trimmed) {
      setComposeNote(null);
      return;
    }
    createNoteMutation.mutate({ fileId, page: composeNote.page, body: trimmed });
    setComposeNote(null);
  };

  const toggleFullscreen = async () => {
    if (!viewerSectionRef.current) {
      return;
    }
    if (isPseudoFullscreen) {
      setIsPseudoFullscreen(false);
      return;
    }
    if (document.fullscreenElement === viewerSectionRef.current) {
      await document.exitFullscreen();
      return;
    }
    const canUseNativeFullscreen =
      typeof viewerSectionRef.current.requestFullscreen === "function" && typeof document.exitFullscreen === "function";
    if (canUseNativeFullscreen) {
      try {
        await viewerSectionRef.current.requestFullscreen({ navigationUI: "hide" });
        return;
      } catch {
        // Fall back to pseudo fullscreen for browsers like iPhone Safari.
      }
    }
    setIsPseudoFullscreen(true);
  };

  const selectedBookmarkPage = bookmarkTargetPage ?? currentPage;
  const isSelectedPageBookmarked = bookmarkedPages.includes(selectedBookmarkPage);
  const canChooseBookmarkPage = visiblePages.length > 0;
  const bookmarkButtonLabel = "Bookmark";
  const bookmarkButtonStyle = getBookmarkButtonStyle(bookmarkColor, isSelectedPageBookmarked);
  /** Pinned only — avoids hover + dropdown gap closing the picker; closes when Bookmark is clicked again. */
  const showBookmarkPagePicker = pinnedPanel === "bookmark" && canChooseBookmarkPage;
  const showBookmarkSettings = hoveredPanel === "settings" || pinnedPanel === "settings";

  const onBookmarkPrimaryAction = () => {
    setPinnedPanel((previous) => (previous === "bookmark" ? null : "bookmark"));
  };

  const onChooseBookmarkPage = (pageNumber: number) => {
    setBookmarkTargetPage(pageNumber);
    toggleBookmark(pageNumber);
  };

  const onToggleSettings = () => {
    setPinnedPanel((previous) => (previous === "settings" ? null : "settings"));
  };

  const revealFullscreenMenuTemporarily = () => {
    setShowFullscreenMenu(true);
    if (hideFullscreenMenuTimerRef.current) {
      clearTimeout(hideFullscreenMenuTimerRef.current);
    }
    hideFullscreenMenuTimerRef.current = setTimeout(() => {
      setShowFullscreenMenu(false);
    }, 3200);
  };

  const submitPageJump = (fromFullscreen: boolean) => {
    const raw = pageJumpDraft.trim();
    if (!raw) return;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return;
    const upper = totalPages > 0 ? totalPages : n;
    const clamped = Math.min(Math.max(1, n), upper);
    setCurrentPage(clamped);
    setPageJumpDraft(String(clamped));
    applyPageToUrl(clamped);
    if (fromFullscreen) {
      revealFullscreenMenuTemporarily();
    }
  };

  const onFullscreenSurfaceDoubleActivate = () => {
    if (!isFullscreen) {
      return;
    }
    revealFullscreenMenuTemporarily();
  };

  const onFullscreenTouchEndCapture = () => {
    if (!isFullscreen || !isTouchLikeInput) {
      return;
    }

    const now = Date.now();
    if (now - lastTapTimeRef.current < 320) {
      lastTapTimeRef.current = 0;
      onFullscreenSurfaceDoubleActivate();
      return;
    }
    lastTapTimeRef.current = now;
  };

  const navigateKeywordHit = (direction: "previous" | "next") => {
    if (!keywordHits.length) {
      return;
    }

    setActiveKeywordHitIndex((previous) => {
      const delta = direction === "previous" ? -1 : 1;
      const nextIndex = (previous + delta + keywordHits.length) % keywordHits.length;
      const nextHit = keywordHits[nextIndex];
      if (nextHit) {
        setCurrentPage(nextHit.page);
      }
      return nextIndex;
    });
  };

  return (
    <section
      ref={viewerSectionRef}
      onDoubleClick={onFullscreenSurfaceDoubleActivate}
      onTouchEndCapture={onFullscreenTouchEndCapture}
      style={entranceStyle}
      className={[
        "pdf-viewer-fullscreen-host",
        !isFullscreen ? "space-y-4" : "",
        isPseudoFullscreen
          ? "fixed inset-0 z-50 flex min-h-0 h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden bg-white text-slate-900"
          : "",
        isNativeFullscreen && !isPseudoFullscreen
          ? "flex min-h-0 h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden bg-white text-slate-900"
          : "",
      ].join(" ")}
    >
      <div
        className={[
          "min-w-0 max-w-full rounded-xl border p-3 shadow-sm sm:p-4",
          isFullscreen
            ? "relative flex min-h-0 flex-1 flex-col border-0 bg-white p-0 shadow-none"
            : "border-slate-200 bg-white",
        ].join(" ")}
      >
        {isFullscreen ? (
          <>
            <div className="peer absolute inset-x-0 top-0 z-20 h-12" />
            <div
              style={{
                transform: `translateX(-50%) scale(${fixedChromeInverseScale})`,
                transformOrigin: "top center",
              }}
              className={[
                "absolute left-1/2 top-1.5 z-30 flex w-max flex-col items-center gap-1.5 transition-opacity duration-200 peer-hover:pointer-events-auto peer-hover:opacity-100 hover:pointer-events-auto hover:opacity-100",
                showFullscreenMenu
                  ? "pointer-events-auto opacity-100"
                  : "pointer-events-none opacity-0",
              ].join(" ")}
            >
              <div className="flex max-w-[min(96vw,36rem)] flex-col items-stretch gap-1.5 rounded-lg border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur">
                <form
                  className="flex min-w-0 flex-wrap items-center gap-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    applyKeywordToUrl(fullscreenSearchDraft);
                    revealFullscreenMenuTemporarily();
                  }}
                >
                  <label className="sr-only" htmlFor="fullscreen-pdf-search">
                    Search text in PDF
                  </label>
                  <input
                    id="fullscreen-pdf-search"
                    type="text"
                    value={fullscreenSearchDraft}
                    onChange={(event) => setFullscreenSearchDraft(event.target.value)}
                    placeholder="Search in PDF…"
                    className="min-h-[26px] min-w-[min(100%,7.5rem)] flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs leading-snug text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/80"
                    autoComplete="off"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-slate-900 px-[9px] py-1 text-[11px] font-semibold text-white hover:bg-slate-800"
                  >
                    Find
                  </button>
                  {keyword ? (
                    <button
                      type="button"
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      onClick={() => {
                        setFullscreenSearchDraft("");
                        applyKeywordToUrl("");
                        revealFullscreenMenuTemporarily();
                      }}
                    >
                      Clear
                    </button>
                  ) : null}
                </form>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  <span className="rounded-full bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white">
                    Page {currentPage} / {totalPages || "—"}
                  </span>
                  <form
                    className="flex items-center gap-0.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitPageJump(true);
                    }}
                  >
                    <label htmlFor="fullscreen-pdf-page-jump" className="sr-only">
                      Go to page number
                    </label>
                    <input
                      id="fullscreen-pdf-page-jump"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={pageJumpDraft}
                      onChange={(event) => setPageJumpDraft(event.target.value.replace(/\D/g, ""))}
                      className="h-[26px] w-10 rounded-md border border-slate-300 bg-white px-1 text-center text-[11px] tabular-nums text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/80"
                      aria-label="Page number to open"
                    />
                    <button
                      type="submit"
                      className="rounded-md bg-slate-900 px-[7px] py-1 text-[11px] font-semibold text-white hover:bg-slate-800"
                    >
                      Go
                    </button>
                  </form>
                  {keyword ? (
                    <div className="flex items-center gap-0.5 rounded-md border border-slate-300 bg-white p-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          navigateKeywordHit("previous");
                          revealFullscreenMenuTemporarily();
                        }}
                        disabled={!totalKeywordHits}
                        className="rounded px-1.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Go to previous keyword match"
                        title="Previous keyword match"
                      >
                        ← Prev
                      </button>
                      <span className="min-w-[3.375rem] text-center text-[11px] font-medium text-slate-600">
                        {totalKeywordHits ? `${currentKeywordHit} / ${totalKeywordHits}` : "—"}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigateKeywordHit("next");
                          revealFullscreenMenuTemporarily();
                        }}
                        disabled={!totalKeywordHits}
                        className="rounded px-1.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Go to next keyword match"
                        title="Next keyword match"
                      >
                        Next →
                      </button>
                    </div>
                  ) : null}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={onBookmarkPrimaryAction}
                      className="rounded-md px-2 py-1 text-[11px] font-semibold transition"
                      style={bookmarkButtonStyle}
                    >
                      {bookmarkButtonLabel}
                    </button>
                    {showBookmarkPagePicker && canChooseBookmarkPage && (
                      <div className="absolute left-1/2 top-[calc(100%+6px)] z-40 flex max-w-[90vw] -translate-x-1/2 flex-wrap items-center justify-center gap-[3px] rounded-md border border-slate-200 bg-white p-1 shadow-xl">
                        {visiblePages.map((pageNumber) => {
                          const selected = selectedBookmarkPage === pageNumber;
                          const alreadyBookmarked = bookmarkedPages.includes(pageNumber);
                          return (
                            <button
                              key={`bookmark-target-fullscreen-${pageNumber}`}
                              type="button"
                              onClick={() => onChooseBookmarkPage(pageNumber)}
                              className={[
                                "rounded px-1.5 py-1 text-[11px] font-medium transition",
                                selected ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
                              ].join(" ")}
                            >
                              {alreadyBookmarked ? `Page ${pageNumber} ✓` : `Page ${pageNumber}`}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleFullscreen()}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                  >
                    Exit full screen
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/" className="ui-btn-back px-3 py-1.5">
                  Back to library
                </Link>
                {returnToHref && (
                  <button
                    type="button"
                    onClick={() => router.push(returnToHref)}
                    className="ui-btn-back px-3 py-1.5"
                  >
                    Back to search results
                  </button>
                )}
              </div>
              <h1 className="truncate break-keep text-base font-semibold text-slate-900 sm:text-lg">{displayTitle}</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Full screen
              </button>
              {canDownloadPdf && (
                <button
                  type="button"
                  onClick={() => void onDownload()}
                  className="rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700"
                >
                  Download PDF
                </button>
              )}
            </div>
          </div>
        )}
        {!isFullscreen && (
          <div
            className={[
              "mb-4 flex flex-col gap-3 rounded-xl border px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4",
              "border-slate-200 bg-gradient-to-r from-white to-slate-50",
            ].join(" ")}
          >
            <div className="flex flex-wrap items-center gap-2 text-sm sm:gap-3">
              <p className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                Page {currentPage} / {totalPages || "—"}
              </p>
              <form
                className="flex items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitPageJump(false);
                }}
              >
                <label htmlFor="pdf-page-jump" className="sr-only">
                  Go to page number
                </label>
                <input
                  id="pdf-page-jump"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pageJumpDraft}
                  onChange={(event) => setPageJumpDraft(event.target.value.replace(/\D/g, ""))}
                  className="h-7 w-11 rounded-md border border-slate-300 bg-white px-1 text-center text-xs tabular-nums text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/80"
                  aria-label="Page number to open"
                />
                <button
                  type="submit"
                  className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-semibold text-white hover:bg-slate-700"
                >
                  Go
                </button>
              </form>
              {keyword && (
                <p className="rounded-full border border-yellow-200 bg-yellow-50 px-3 py-1 text-xs text-slate-700">
                  Keyword highlight: <span className="font-semibold">{keyword}</span>
                </p>
              )}
              {keyword && (
                <p className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-slate-700">
                  Matches in this file: <span className="font-semibold">{totalKeywordHits}</span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {keyword && (
                <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => navigateKeywordHit("previous")}
                    disabled={!totalKeywordHits}
                    className="rounded-md px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Go to previous keyword match"
                    title="Previous keyword match"
                  >
                    ← Prev hit
                  </button>
                  <p className="min-w-[72px] text-center text-xs font-medium text-slate-700">
                    {totalKeywordHits ? `${currentKeywordHit} / ${totalKeywordHits}` : "0 / 0"}
                  </p>
                  <button
                    type="button"
                    onClick={() => navigateKeywordHit("next")}
                    disabled={!totalKeywordHits}
                    className="rounded-md px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Go to next keyword match"
                    title="Next keyword match"
                  >
                    Next hit →
                  </button>
                </div>
              )}
              <div className="relative">
                <button
                  type="button"
                  onClick={onBookmarkPrimaryAction}
                  className="rounded-lg px-3 py-2 text-xs font-semibold transition"
                  style={bookmarkButtonStyle}
                >
                  {bookmarkButtonLabel}
                </button>
                {showBookmarkPagePicker && canChooseBookmarkPage && (
                  <div className="absolute right-0 top-[calc(100%+8px)] z-20 flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-1 shadow-lg">
                    {visiblePages.map((pageNumber) => {
                      const selected = selectedBookmarkPage === pageNumber;
                      const alreadyBookmarked = bookmarkedPages.includes(pageNumber);
                      return (
                        <button
                          key={`bookmark-target-default-${pageNumber}`}
                          type="button"
                          onClick={() => onChooseBookmarkPage(pageNumber)}
                          className={[
                            "rounded-md px-2 py-1 text-xs font-medium transition",
                            selected ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
                          ].join(" ")}
                        >
                          {alreadyBookmarked ? `Page ${pageNumber} ✓` : `Page ${pageNumber}`}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div
                className="relative"
                onMouseEnter={() => setHoveredPanel("settings")}
                onMouseLeave={() => setHoveredPanel((previous) => (previous === "settings" ? null : previous))}
              >
                <button
                  type="button"
                  aria-label="Bookmark settings"
                  title="Bookmark settings"
                  onClick={onToggleSettings}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-base text-slate-700 transition hover:bg-slate-50"
                >
                  ⚙
                </button>
                {showBookmarkSettings && (
                  <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Bookmark color</p>
                    <div className="grid grid-cols-2 gap-2">
                      {BOOKMARK_COLOR_OPTIONS.map((option) => {
                        const selected = bookmarkColor === option.id;
                        return (
                          <button
                            key={`bookmark-color-default-${option.id}`}
                            type="button"
                            onClick={() => setBookmarkColor(option.id)}
                            className={[
                              "flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition",
                              selected
                                ? "border-blue-300 bg-blue-50 text-blue-700"
                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                            ].join(" ")}
                          >
                            <span className="inline-flex h-4 w-4 rounded-full border border-slate-300" style={{ backgroundColor: option.swatch }} />
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Highlight color</p>
                    <div className="grid grid-cols-2 gap-2">
                      {HIGHLIGHT_COLOR_OPTIONS.map((option) => {
                        const selected = highlightColor === option.id;
                        return (
                          <button
                            key={`highlight-color-default-${option.id}`}
                            type="button"
                            onClick={() => setHighlightColor(option.id)}
                            className={[
                              "flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition",
                              selected
                                ? "border-blue-300 bg-blue-50 text-blue-700"
                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                            ].join(" ")}
                          >
                            <span className="inline-flex h-4 w-4 rounded-sm border border-slate-300" style={{ backgroundColor: option.swatch }} />
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Page color</p>
                    <div className="grid grid-cols-3 gap-2">
                      {PAGE_TONE_OPTIONS.map((option) => {
                        const selected = pageTone === option.id;
                        return (
                          <button
                            key={`page-tone-default-${option.id}`}
                            type="button"
                            onClick={() => setPageTone(option.id)}
                            className={[
                              "flex items-center justify-center gap-2 rounded-md border px-2 py-1.5 text-[11px] transition",
                              selected
                                ? "border-blue-300 bg-blue-50 text-blue-700"
                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                            ].join(" ")}
                          >
                            <span className="inline-flex h-3.5 w-3.5 rounded-full border border-slate-300" style={{ backgroundColor: option.swatch }} />
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Book cover color</p>
                    <div className="grid grid-cols-3 gap-2">
                      {COVER_TONE_OPTIONS.map((option) => {
                        const selected = coverTone === option.id;
                        return (
                          <button
                            key={`cover-tone-default-${option.id}`}
                            type="button"
                            onClick={() => setCoverTone(option.id)}
                            className={[
                              "flex items-center justify-center gap-2 rounded-md border px-2 py-1.5 text-[11px] transition",
                              selected
                                ? "border-blue-300 bg-blue-50 text-blue-700"
                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                            ].join(" ")}
                          >
                            <span className="inline-flex h-3.5 w-3.5 rounded-full border border-slate-300" style={{ backgroundColor: option.swatch }} />
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {!isFullscreen && bookmarkedPages.length > 0 && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Bookmarks</p>
            <div className="flex flex-wrap gap-2">
              {bookmarkedPages.map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setCurrentPage(page)}
                  className="rounded-full border px-3 py-1 text-xs font-medium transition hover:brightness-95"
                  style={getBookmarkChipStyle(bookmarkColor, page === currentPage)}
                >
                  Page {page}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isFullscreen && (highlights.length > 0 || highlightsQuery.isLoading) && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Highlights ({highlights.length})
              </p>
              <p className="text-[11px] text-slate-500">Select text in the PDF to add</p>
            </div>
            <div className="flex flex-col gap-2">
              {highlights.map((highlight) => {
                const colorId = resolveHighlightColorId(highlight.color);
                const swatch = getHighlightSwatch(colorId);
                return (
                  <div
                    key={highlight.id}
                    className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2 text-xs"
                  >
                    <span
                      className="mt-1 inline-block h-3 w-3 shrink-0 rounded-sm border border-slate-300"
                      style={{ backgroundColor: swatch }}
                    />
                    <button
                      type="button"
                      onClick={() => setCurrentPage(highlight.page)}
                      className="flex-1 text-left"
                    >
                      <p className="font-medium text-slate-800">Page {highlight.page}</p>
                      <p className="mt-0.5 line-clamp-3 text-slate-600">“{highlight.text}”</p>
                    </button>
                    <div className="flex items-center gap-1">
                      <select
                        value={colorId}
                        onChange={(event) =>
                          updateHighlightColorMutation.mutate({
                            id: highlight.id,
                            color: event.target.value as HighlightColorId,
                          })
                        }
                        className="rounded-md border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-700"
                        aria-label="Change highlight color"
                      >
                        {HIGHLIGHT_COLOR_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => deleteHighlightMutation.mutate(highlight.id)}
                        className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50"
                        aria-label="Delete highlight"
                        title="Delete highlight"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!isFullscreen && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Notes ({notes.length})
              </p>
              <button
                type="button"
                onClick={() =>
                  setComposeNote({
                    page: visiblePages[0] ?? currentPage,
                    preset: "",
                  })
                }
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                + Add note for page {visiblePages[0] ?? currentPage}
              </button>
            </div>
            {notes.length === 0 ? (
              <p className="text-[11px] text-slate-500">No notes yet — select text in the PDF and choose “Add note”.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {notes.map((note) => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    onJumpToPage={() => setCurrentPage(note.page)}
                    onUpdate={(body, page) =>
                      updateNoteMutation.mutate({
                        id: note.id,
                        body,
                        page,
                      })
                    }
                    onDelete={() => deleteNoteMutation.mutate(note.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div
          className={[
            "min-w-0 max-w-full overflow-x-clip rounded-xl border border-slate-200 bg-slate-100 p-2 sm:p-4",
            isFullscreen
              ? "flex min-h-0 flex-1 flex-col rounded-none border-0 bg-white p-0"
              : "min-h-[58vh] sm:min-h-[70vh]",
          ].join(" ")}
        >
          <PDFViewer
            key={viewerPdfSrc}
            fileUrl={viewerPdfSrc}
            activePage={currentPage}
            keyword={keyword}
            activeKeywordHitPage={activeKeywordTarget?.page}
            activeKeywordHitOccurrenceInPage={activeKeywordTarget?.occurrenceInPage}
            bookmarkColor={bookmarkColor}
            pageTone={pageTone}
            coverTone={coverTone}
            isFullscreen={isFullscreen}
            previewMode={previewMode}
            readerFabSizeRem={isFullscreen ? READER_CHAT_ROOM.fabSizeRem * 0.5 : undefined}
            onCurrentPageChange={setCurrentPage}
            onNumPagesChange={setTotalPages}
            onVisiblePagesChange={setVisiblePages}
            onDocumentLoadError={(err) => {
              // Most common cause: S3 bucket CORS does not allow GET/Range from this origin
              // for the presigned URL, or the URL has expired (presign TTL elapsed).
              console.error(
                `[file-viewer] presigned PDF load failed for fileId=${fileId}: ${err.message}`,
              );
            }}
            bookmarkedPages={bookmarkedPages}
            pageHighlights={projectedPageHighlights}
            defaultHighlightColor={getHighlightSwatch(highlightColor)}
            onPdfTextSelected={setPdfTextSelection}
          />
        </div>
      </div>
      {/* Reader chat: `lib/reader-chat-room.ts` — fullscreen renders at full base size, non-fullscreen reader is halved. */}
      <DocumentChatWidget
        folderId={fileQuery.data.folderId}
        layout="reader"
        stackZClass={isFullscreen ? "z-[70]" : "z-40"}
        readerFullscreen={isFullscreen}
      />

      {pdfTextSelection ? (
        <SelectionToolbar
          selection={pdfTextSelection}
          highlightColor={getHighlightSwatch(highlightColor)}
          onHighlight={() => saveHighlightFromSelection(pdfTextSelection)}
          onAddNote={() => openNoteComposerFromSelection(pdfTextSelection)}
          onCopy={() => {
            if (typeof navigator !== "undefined" && navigator.clipboard) {
              void navigator.clipboard.writeText(pdfTextSelection.text);
            }
          }}
          onDismiss={() => {
            if (typeof window !== "undefined") {
              window.getSelection()?.removeAllRanges();
            }
            setPdfTextSelection(null);
          }}
        />
      ) : null}

      {composeNote ? (
        <NoteComposerDialog
          page={composeNote.page}
          initialBody={composeNote.preset}
          isSubmitting={createNoteMutation.isPending}
          onCancel={() => setComposeNote(null)}
          onSubmit={submitNoteFromComposer}
        />
      ) : null}
    </section>
  );
}

interface SelectionToolbarProps {
  selection: PdfTextSelection;
  highlightColor: string;
  onHighlight: () => void;
  onAddNote: () => void;
  onCopy: () => void;
  onDismiss: () => void;
}

/**
 * Floating toolbar anchored to the user's current PDF text selection. Lives in a `position:fixed`
 * container that follows the selection's bounding rect, so it survives scroll / fullscreen / pinch
 * zoom without manual positioning math.
 */
function SelectionToolbar({
  selection,
  highlightColor,
  onHighlight,
  onAddNote,
  onCopy,
  onDismiss,
}: SelectionToolbarProps) {
  const top = Math.max(8, selection.rect.top - 44);
  const left = Math.max(8, selection.rect.left + selection.rect.width / 2);
  return (
    <div
      role="toolbar"
      aria-label="PDF text selection actions"
      style={{
        position: "fixed",
        top,
        left,
        transform: "translateX(-50%)",
        zIndex: 80,
      }}
      className="flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-1 py-1 text-xs shadow-lg backdrop-blur"
      onMouseDown={(event) => {
        /** Prevent click on the toolbar from collapsing the underlying selection. */
        event.preventDefault();
      }}
    >
      <button
        type="button"
        onClick={onHighlight}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-800 transition hover:bg-slate-100"
        title={`Highlight ${selection.text.length > 18 ? `${selection.text.slice(0, 18)}…` : selection.text}`}
      >
        <span
          className="inline-block h-3 w-3 rounded-sm border border-slate-300"
          style={{ backgroundColor: highlightColor }}
        />
        Highlight
      </button>
      <button
        type="button"
        onClick={onCopy}
        className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100"
        title="Copy selected text"
      >
        Copy
      </button>
      <button
        type="button"
        onClick={onAddNote}
        className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100"
        title="Open the note composer with this text quoted"
      >
        Add note
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-full px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100"
        aria-label="Dismiss selection toolbar"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

interface NoteComposerDialogProps {
  page: number;
  initialBody: string;
  isSubmitting: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}

function NoteComposerDialog({
  page,
  initialBody,
  isSubmitting,
  onSubmit,
  onCancel,
}: NoteComposerDialogProps) {
  const [body, setBody] = useState(initialBody);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Add note for page ${page}`}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900">Note for page {page}</p>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100"
            aria-label="Close note composer"
          >
            ✕
          </button>
        </div>
        <textarea
          autoFocus
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write your note…"
          className="ui-input min-h-[140px] resize-y"
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!body.trim() || isSubmitting}
            onClick={() => onSubmit(body)}
            className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Saving…" : "Save note"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface NoteRowProps {
  note: NoteItem;
  onJumpToPage: () => void;
  onUpdate: (body: string, page: number) => void;
  onDelete: () => void;
}

function NoteRow({ note, onJumpToPage, onUpdate, onDelete }: NoteRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [pageDraft, setPageDraft] = useState(String(note.page));
  useEffect(() => {
    if (!editing) {
      setDraft(note.body);
      setPageDraft(String(note.page));
    }
  }, [editing, note.body, note.page]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onJumpToPage}
          className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800"
        >
          Page {note.page}
        </button>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => {
                  const p = Number.parseInt(pageDraft, 10);
                  const pageOk = Number.isFinite(p) && p >= 1 ? p : note.page;
                  const bodyChanged = draft !== note.body;
                  const pageChanged = pageOk !== note.page;
                  if (!bodyChanged && !pageChanged) {
                    setEditing(false);
                    return;
                  }
                  onUpdate(draft, pageOk);
                  setEditing(false);
                }}
                className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-slate-700"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                aria-label="Delete note"
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <label className="flex items-center gap-2 text-[11px] text-slate-600">
            <span className="shrink-0 font-medium">Page</span>
            <input
              type="text"
              inputMode="numeric"
              value={pageDraft}
              onChange={(event) => setPageDraft(event.target.value.replace(/\D/g, ""))}
              className="ui-input w-14 px-2 py-1 text-xs tabular-nums"
              aria-label="Note page number"
            />
          </label>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="ui-input min-h-[80px] resize-y text-xs"
          />
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-slate-700">{note.body}</p>
      )}
    </div>
  );
}

function extractBackendError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; error?: string } | string | undefined;
    if (typeof data === "string" && data.trim()) {
      return data;
    }
    if (data && typeof data === "object") {
      if (typeof data.message === "string" && data.message.trim()) {
        return data.message;
      }
      if (typeof data.error === "string" && data.error.trim()) {
        return data.error;
      }
    }
    return error.message || "Backend request failed.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error.";
}

function getBookmarkColorStorageKey(fileId: string): string {
  return `bookmarkColor:${fileId}`;
}

function getHighlightColorStorageKey(fileId: string): string {
  return `highlightColor:${fileId}`;
}

function getPageToneStorageKey(fileId: string): string {
  return `pageTone:${fileId}`;
}

function getCoverToneStorageKey(fileId: string): string {
  return `coverTone:${fileId}`;
}

function isBookmarkColorId(value: string): value is BookmarkColorId {
  return BOOKMARK_COLOR_OPTIONS.some((option) => option.id === value);
}

function isPageToneId(value: string): value is PageToneId {
  return PAGE_TONE_OPTIONS.some((option) => option.id === value);
}

function isCoverToneId(value: string): value is CoverToneId {
  return COVER_TONE_OPTIONS.some((option) => option.id === value);
}

function isHighlightColorId(value: string): value is HighlightColorId {
  return HIGHLIGHT_COLOR_OPTIONS.some((option) => option.id === value);
}

function getBookmarkButtonStyle(
  color: BookmarkColorId,
  isBookmarked: boolean
): { border: string; backgroundColor: string; color: string } {
  if (!isBookmarked) {
    return {
      border: "1px solid #cbd5e1",
      backgroundColor: "#ffffff",
      color: "#334155",
    };
  }

  const tone = {
    silver: { background: "#e2e3e6", text: "#3a4458", border: "#c5c8cf" },
    sand: { background: "#ece5db", text: "#6f5a43", border: "#d4c7b7" },
    ice: { background: "#dbe7ef", text: "#43627b", border: "#bfcfda" },
    sage: { background: "#e4e8df", text: "#476046", border: "#c8d0c3" },
  }[color];

  return {
    border: `1px solid ${tone.border}`,
    backgroundColor: tone.background,
    color: tone.text,
  };
}

function getBookmarkChipStyle(color: BookmarkColorId, isActive: boolean): {
  borderColor: string;
  backgroundColor: string;
  color: string;
} {
  const palette = {
    silver: { active: "#eef0f4", border: "#c5c8cf", text: "#3a4458" },
    sand: { active: "#f4eee6", border: "#d6cabd", text: "#6f5a43" },
    ice: { active: "#eaf2f7", border: "#bfd0dc", text: "#43627b" },
    sage: { active: "#edf2e9", border: "#c8d1c0", text: "#476046" },
  }[color];

  if (isActive) {
    return {
      borderColor: palette.border,
      backgroundColor: palette.active,
      color: palette.text,
    };
  }

  return {
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    color: "#334155",
  };
}

function collectKeywordHitsByPage(content: string[], keyword: string): Array<{ page: number; occurrenceInPage: number }> {
  const trimmedKeyword = keyword.trim().toLowerCase();
  if (!trimmedKeyword || !content.length) {
    return [];
  }

  const escaped = escapeRegExp(trimmedKeyword);
  const regex = new RegExp(escaped, "gi");
  const hits: Array<{ page: number; occurrenceInPage: number }> = [];

  content.forEach((rawText, index) => {
    const normalizedText = String(rawText ?? "").toLowerCase();
    const pageNumber = index + 1;
    const matchCount = (normalizedText.match(regex) ?? []).length;
    for (let i = 0; i < matchCount; i += 1) {
      hits.push({ page: pageNumber, occurrenceInPage: i + 1 });
    }
  });

  return hits;
}

function findNearestKeywordHitIndex(hits: Array<{ page: number }>, page: number): number {
  const samePageIndex = hits.findIndex((item) => item.page === page);
  if (samePageIndex >= 0) {
    return samePageIndex;
  }

  const nextPageIndex = hits.findIndex((item) => item.page > page);
  if (nextPageIndex >= 0) {
    return nextPageIndex;
  }

  return hits.length - 1;
}

function normalizeReturnToHref(rawHref: string | null): string | null {
  if (!rawHref) {
    return null;
  }
  try {
    const decodedHref = decodeURIComponent(rawHref);
    if (!decodedHref.startsWith("/") || decodedHref.startsWith("//")) {
      return null;
    }
    return decodedHref;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


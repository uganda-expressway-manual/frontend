"use client";

import Link from "next/link";
import {
  ChangeEvent,
  DragEvent,
  Fragment,
  type RefObject,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import axios from "axios";
import { DocumentChatWidget } from "@/components/document-chat-widget";
import { BookshelfView, ListView } from "@/components/folder-bookshelf";
import { isAdminUser } from "@/lib/auth-user";
import { api, getFolderRagStatus, patchFileFilename, patchFileOrder, uploadFileToRagStore } from "@/lib/api";
import { useAuth } from "@/lib/hooks/use-auth";
import { Folder, FolderFile } from "@/lib/types";

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  navy:    "#1a2744",
  gold:    "#c97c2a",
  paper:   "#faf8f3",
  border:  "#d0c4aa",
  muted:   "#8a7a60",
  textMid: "#6a5a40",
  bg:      "#f4f1ec",
};
const fontSerif   = "'Source Serif 4', Georgia, serif";
const fontDisplay = "'Playfair Display', 'Times New Roman', serif";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileVersionItem {
  id: string;
  filename: string;
  createdAt: string;
  content?: Array<{ page: number; content: string }>;
}

const PAGE_CHUNK_SIZE = 5;
type FileSortField = "filename" | "createdAt" | "number";
type SortDirection  = "desc" | "asc";
type UploadUiPhase  = "idle" | "uploading" | "processing" | "done" | "error";
type ViewMode       = "bookshelf" | "list";

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FolderPage() {
  const params       = useParams<{ folderId: string }>();
  const pathname     = usePathname();
  const router       = useRouter();
  const searchParams = useSearchParams();
  const folderId     = params.folderId;
  const { user }     = useAuth();
  const admin        = isAdminUser(user);
  const urlKeyword   = searchParams.get("keyword") ?? "";

  const [folderSearch,      setFolderSearch]      = useState(urlKeyword);
  const [dragging,          setDragging]          = useState(false);
  const [dragCounter,       setDragCounter]       = useState(0);
  const [orderedFiles,      setOrderedFiles]      = useState<FolderFile[]>([]);
  const [fileSortField,     setFileSortField]     = useState<FileSortField | null>(null);
  const [fileSortDirection, setFileSortDirection] = useState<SortDirection>("desc");
  const [viewMode,          setViewMode]          = useState<ViewMode>("bookshelf");
  /** Admin delete: confirm before removing a volume from the folder. */
  const [filePendingDelete, setFilePendingDelete] = useState<FolderFile | null>(null);
  /** Drives the "book opening into view" entrance transition once the folder data is ready. */
  const [contentSettled, setContentSettled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadUi, setUploadUi] = useState<{
    phase: UploadUiPhase; percent: number; indeterminate: boolean; fileCount: number;
    /** All bytes are on the wire but the server hasn't responded yet — never shown as "100%". */
    awaitingResponse: boolean;
  }>({ phase: "idle", percent: 0, indeterminate: false, fileCount: 0, awaitingResponse: false });
  /**
   * Upload animation stays in "processing" until every newly-uploaded volume's thumbnail has
   * actually rendered on the shelf (see Book3D/SmallThumb `onThumbSettled`), not just when the
   * HTTP request finishes — so the UI never claims "done" before there's something to see.
   */
  const [pendingThumbIds, setPendingThumbIds] = useState<Set<string>>(new Set());
  const preUploadFileIdsRef = useRef<Set<string>>(new Set());
  const awaitingThumbsRef = useRef(false);

  const [debouncedFolderSearch] = useDebounce(folderSearch, 300);

  // ── Data queries ──
  const folderQuery = useQuery({
    queryKey: ["folder", folderId],
    queryFn: async () => {
      try {
        return (await api.get<Folder>(`/folders/${folderId}`)).data;
      } catch {
        const folders = (await api.get<Folder[]>("/folders")).data;
        const matched  = folders.find((f) => f.id === folderId);
        if (!matched) throw new Error("Folder not found");
        return matched;
      }
    },
    enabled: Boolean(folderId),
  });

  /** Which files are already indexed in the folder's Gemini FileSearchStore — admin-only concern. */
  const ragStatusQuery = useQuery({
    queryKey: ["folder-rag-status", folderId],
    queryFn: async () => getFolderRagStatus(folderId),
    enabled: Boolean(folderId) && admin,
  });
  const ragUploadedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const status of ragStatusQuery.data ?? []) {
      if (status.ragUploaded) ids.add(status.id);
    }
    return ids;
  }, [ragStatusQuery.data]);

  const uploadToRagMutation = useMutation({
    mutationFn: async (fileId: string) => uploadFileToRagStore(fileId),
    onSuccess: () => {
      void ragStatusQuery.refetch();
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const formData = new FormData();
      files.forEach((f) => formData.append("pdf", f));
      await api.post(`/files/upload/${folderId}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (event) => {
          const total = event.total ?? 0;
          if (total <= 0) return;
          const rawPercent = Math.round((event.loaded / total) * 100);
          if (rawPercent >= 100) {
            // Every byte is sent, but the server is still parsing/saving the file — hold just
            // shy of 100% and switch to an indeterminate animation instead of looking "done".
            setUploadUi((prev) => ({ ...prev, phase: "uploading", percent: 96, indeterminate: true, awaitingResponse: true }));
          } else {
            setUploadUi((prev) => ({ ...prev, phase: "uploading", percent: Math.min(96, rawPercent), indeterminate: false, awaitingResponse: false }));
          }
        },
      });
    },
    onMutate: (files: File[]) => {
      preUploadFileIdsRef.current = new Set(orderedFiles.map((f) => f.id));
      setUploadUi({ phase: "uploading", percent: 0, indeterminate: true, fileCount: files.length, awaitingResponse: false });
    },
    onSuccess: async () => {
      // Upload request is done, but keep animating: wait for the new volume(s)' thumbnails
      // to actually render before declaring the upload "done".
      setUploadUi((prev) => ({ ...prev, phase: "processing", percent: 100, indeterminate: true }));
      void ragStatusQuery.refetch();
      const result = await folderQuery.refetch();
      const freshIds = result.data?.files.map((f) => f.id) ?? [];
      const newIds = freshIds.filter((id) => !preUploadFileIdsRef.current.has(id));
      if (newIds.length === 0) {
        setUploadUi((prev) => (prev.phase === "processing" ? { ...prev, phase: "done" } : prev));
        return;
      }
      awaitingThumbsRef.current = true;
      setPendingThumbIds(new Set(newIds));
    },
    onError: () => {
      setUploadUi((prev) => ({ ...prev, phase: "error", percent: 0, indeterminate: false }));
    },
  });

  const onThumbSettled = useCallback((fileId: string) => {
    setPendingThumbIds((prev) => {
      if (!prev.has(fileId)) return prev;
      const next = new Set(prev);
      next.delete(fileId);
      return next;
    });
  }, []);

  const deleteFileMutation = useMutation({
    mutationFn: async (fileId: string) => api.delete(`/files/${fileId}`),
    onSuccess: (_, deletedId) => {
      setOrderedFiles((prev) => prev.filter((f) => f.id !== deletedId));
      folderQuery.refetch();
    },
  });

  const renameFileMutation = useMutation({
    mutationFn: async ({ fileId, filename }: { fileId: string; filename: string }) =>
      patchFileFilename(fileId, filename),
    onSuccess: () => {
      void folderQuery.refetch();
    },
    onError: () => {
      void folderQuery.refetch();
    },
  });

  const reorderFilesMutation = useMutation({
    mutationFn: async (fileIds: string[]) => patchFileOrder(folderId, fileIds),
    onSuccess: () => {
      void folderQuery.refetch();
    },
    onError: () => {
      void folderQuery.refetch();
    },
  });

  const folderSearchQuery = useQuery({
    queryKey: ["folder-search", folderId, debouncedFolderSearch],
    queryFn: async () =>
      (await api.get<FileVersionItem[]>(`/folders/${folderId}/find`, {
        params: { keyword: debouncedFolderSearch },
      })).data,
    enabled: debouncedFolderSearch.trim().length > 0,
  });

  const folder = folderQuery.data;
  const fileOrderSignature =
    folder?.files.map((f) => `${f.id}:${f.sortOrder ?? ""}`).join("|") ?? "";

  const searchContextHref = (() => {
    const p = new URLSearchParams();
    const t = folderSearch.trim();
    if (t) p.set("keyword", t);
    const q = p.toString();
    return q ? `${pathname}?${q}` : pathname;
  })();

  useEffect(() => {
    if (folder) setOrderedFiles(folder.files);
  }, [fileOrderSignature, folder]);

  useEffect(() => { setFolderSearch(urlKeyword); }, [urlKeyword]);

  useEffect(() => {
    if (!folder) return;
    const raf = requestAnimationFrame(() => setContentSettled(true));
    return () => cancelAnimationFrame(raf);
  }, [folder]);

  useEffect(() => {
    if (uploadUi.phase !== "done") return;
    const t = window.setTimeout(() => {
      setUploadUi({ phase: "idle", percent: 0, indeterminate: false, fileCount: 0, awaitingResponse: false });
    }, 2800);
    return () => window.clearTimeout(t);
  }, [uploadUi.phase]);

  useEffect(() => {
    if (!awaitingThumbsRef.current) return;
    if (pendingThumbIds.size === 0) {
      awaitingThumbsRef.current = false;
      setUploadUi((prev) => (prev.phase === "processing" ? { ...prev, phase: "done", indeterminate: false } : prev));
    }
  }, [pendingThumbIds]);

  useEffect(() => {
    if (!awaitingThumbsRef.current) return;
    // Safety net: never leave the animation stuck if a thumbnail never settles
    // (e.g. the volume scrolled out and its row unmounted before loading).
    const t = window.setTimeout(() => {
      if (!awaitingThumbsRef.current) return;
      awaitingThumbsRef.current = false;
      setPendingThumbIds(new Set());
      setUploadUi((prev) => (prev.phase === "processing" ? { ...prev, phase: "done", indeterminate: false } : prev));
    }, 15000);
    return () => window.clearTimeout(t);
  }, [pendingThumbIds]);

  useEffect(() => {
    const p = new URLSearchParams(searchParams.toString());
    const t = debouncedFolderSearch.trim();
    if (t) { p.set("keyword", t); } else { p.delete("keyword"); }
    const nextQ = p.toString();
    if (searchParams.toString() === nextQ) return;
    router.replace(nextQ ? `${pathname}?${nextQ}` : pathname, { scroll: false });
  }, [debouncedFolderSearch, pathname, router, searchParams]);

  const visibleFiles = useMemo(() => {
    if (!fileSortField) return orderedFiles;
    const sorted = [...orderedFiles];
    sorted.sort((a, b) => {
      if (fileSortField === "number") {
        const c = compareVersionLikeFilename(a.filename, b.filename);
        return fileSortDirection === "desc" ? -c : c;
      }
      if (fileSortField === "filename") {
        const c = a.filename.localeCompare(b.filename, "en", { sensitivity: "base" });
        return fileSortDirection === "desc" ? -c : c;
      }
      const l = new Date(a.createdAt).getTime();
      const r = new Date(b.createdAt).getTime();
      return fileSortDirection === "desc" ? r - l : l - r;
    });
    return sorted;
  }, [fileSortDirection, fileSortField, orderedFiles]);

  // ── Early returns ──
  if (folderQuery.isLoading) {
    return (
      <div style={{
        minHeight: "60vh",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 14, padding: "48px 24px",
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: "50%",
          border: `2.5px solid ${C.border}`, borderTopColor: C.gold,
          animation: "folderSpinnerSpin 850ms linear infinite",
        }} />
        <p style={{ fontFamily: fontDisplay, fontSize: 15, fontStyle: "italic", color: C.muted }}>
          Opening folder…
        </p>
      </div>
    );
  }
  if (folderQuery.error || !folder) {
    return (
      <div style={{ padding: "48px 24px", fontFamily: fontSerif, color: "#c0392b", fontSize: 14 }}>
        Folder not found or unavailable.
      </div>
    );
  }

  const folderLocked = folder.lock === true;
  /** Locked folders block members only; admins can still upload/manage files. */
  const uploadBlockedForUser = folderLocked && !admin;

  const onDropped = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    setDragCounter(0);
    if (!admin || uploadBlockedForUser) return;
    const files = collectPdfFiles(event.dataTransfer.files);
    if (files.length) uploadMutation.mutate(files);
  };

  const onFilePick = (event: ChangeEvent<HTMLInputElement>) => {
    if (!admin || uploadBlockedForUser) return;
    const files = collectPdfFiles(event.target.files ?? []);
    if (files.length) uploadMutation.mutate(files);
    event.target.value = "";
  };

  const toggleFileSort = (field: FileSortField) => {
    if (fileSortField !== field) {
      setFileSortField(field);
      setFileSortDirection("desc");
      return;
    }
    setFileSortDirection((prev) => (prev === "desc" ? "asc" : "desc"));
  };

  const volumeLabel = visibleFiles.length === 1 ? "1 volume" : `${visibleFiles.length} volumes`;
  const canPersistFileOrder = admin && !uploadBlockedForUser && !folderSearch.trim() && !fileSortField;

  // ── Main render ──
  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Source+Serif+4:ital,wght@0,300;0,400;1,300&display=swap"
      />

      <section
        style={{
          background: C.bg,
          minHeight: "100vh",
          padding: "0 0 64px",
          position: "relative",
          opacity: contentSettled ? 1 : 0,
          /* "none" (not an identity transform like translateY(0)) once settled — any non-none
             transform on this ancestor would create a CSS containing block, breaking the fixed
             positioning of the DocumentChatWidget it wraps (bubble/panel would clip to this
             section's box instead of floating relative to the viewport, like on the dashboard). */
          transform: contentSettled ? "none" : "translateY(14px) scale(0.99)",
          transition: "opacity 380ms ease-out, transform 380ms ease-out",
        }}
        onDragOver={(e)  => { if (!admin || uploadBlockedForUser) return; e.preventDefault(); }}
        onDragEnter={(e) => {
          if (!admin || uploadBlockedForUser) return;
          e.preventDefault();
          setDragCounter((p) => p + 1);
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!admin || uploadBlockedForUser) return;
          e.preventDefault();
          setDragCounter((p) => {
            const n = Math.max(0, p - 1);
            if (n === 0) setDragging(false);
            return n;
          });
        }}
        onDrop={onDropped}
      >
        {/* Global drag-over banner */}
        {admin && !uploadBlockedForUser && dragging && (
          <div style={{
            position: "sticky", top: 80, zIndex: 50,
            background: C.paper, border: `1px solid ${C.gold}`,
            borderRadius: 4, padding: "10px 16px",
            fontFamily: fontSerif, fontSize: 13, color: C.navy,
            boxShadow: "0 2px 12px rgba(201,124,42,0.14)",
            margin: "0 24px",
          }}>
            Drop PDF files anywhere on this page to upload.
          </div>
        )}

        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>

          {/* ─────────────── Change 1 — Page header ─────────────── */}
          <div style={{ paddingTop: 24 }}>

            {/* Back */}
            <div style={{ marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  fontFamily: fontSerif, fontSize: 13, color: C.navy,
                  background: "#fff",
                  border: `1px solid ${C.border}`,
                  borderRadius: 4,
                  padding: "6px 14px",
                  cursor: "pointer",
                  transition: "border-color 150ms, box-shadow 150ms",
                }}
                aria-label="Back to dashboard"
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = C.gold;
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 2px 8px rgba(201,124,42,0.12)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = C.border;
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
                }}
              >
                <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>←</span>
                Back to dashboard
              </button>
            </div>

            {/* Title */}
            <h1 style={{
              fontFamily: fontDisplay, fontSize: 28, fontWeight: 700,
              color: C.navy, margin: 0, lineHeight: 1.15,
            }}>
              {folder.foldername}
            </h1>

            {/* Gold divider */}
            <div style={{
              width: 36, height: 1.5, background: C.gold,
              borderRadius: 1, margin: "10px 0 8px",
            }} />

            {/* Volume count */}
            <p style={{
              fontFamily: fontSerif, fontSize: 13, fontStyle: "italic",
              color: C.muted, margin: 0,
            }}>
              {visibleFiles.length === 0 ? "No volumes" : volumeLabel}
            </p>

            {folderLocked && !admin && (
              <p style={{
                fontFamily: fontSerif, fontSize: 13, color: C.muted,
                marginTop: 8, maxWidth: 520,
              }}>
                This manual is restricted. Only authorized accounts can browse these volumes.
              </p>
            )}
          </div>

          {/* ─────────────── Change 4 — Search bar ─────────────── */}
          <div style={{ marginTop: 28 }}>
            <div style={{ position: "relative", maxWidth: 480 }}>
              {/* Magnifier icon */}
              <svg
                viewBox="0 0 20 20"
                fill="none"
                style={{
                  position: "absolute", left: 10, top: "50%",
                  transform: "translateY(-50%)",
                  width: 16, height: 16, pointerEvents: "none",
                  color: C.navy,
                }}
                aria-hidden
              >
                <circle cx="8.5" cy="8.5" r="5.5" stroke={C.navy} strokeWidth="1.5" />
                <path d="M13 13l3.5 3.5" stroke={C.navy} strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                value={folderSearch}
                onChange={(e) => setFolderSearch(e.target.value)}
                placeholder="Search volumes in this folder…"
                style={{
                  width: "100%",
                  padding: "9px 12px 9px 34px",
                  fontFamily: fontSerif,
                  fontSize: 13,
                  fontStyle: "italic",
                  color: C.navy,
                  background: "#fff",
                  border: `1px solid ${C.border}`,
                  borderRadius: 4,
                  outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 150ms, box-shadow 150ms",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = C.gold;
                  e.currentTarget.style.boxShadow  = "0 0 0 3px rgba(201,124,42,0.10)";
                  e.currentTarget.style.fontStyle   = "normal";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = C.border;
                  e.currentTarget.style.boxShadow   = "none";
                  e.currentTarget.style.fontStyle    = "italic";
                }}
              />
            </div>

            {/* Inline search results */}
            {folderSearchQuery.data && (
              <div style={{
                marginTop: 8,
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                overflow: "hidden",
                maxWidth: 640,
                background: "#fff",
              }}>
                {folderSearchQuery.data.length === 0 ? (
                  <p style={{ fontFamily: fontSerif, fontSize: 12, color: C.muted, padding: "10px 14px" }}>
                    No matching files.
                  </p>
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {folderSearchQuery.data.map((item) => (
                      <FolderSearchItem
                        key={item.id}
                        item={item}
                        keyword={debouncedFolderSearch}
                        returnTo={encodeURIComponent(searchContextHref)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* ─────────────── Change 2 — Slim upload drop zone ─────────────── */}
          {admin && (
            <div style={{ marginTop: 24 }}>
              <SlimDropZone
                locked={uploadBlockedForUser}
                fileInputRef={fileInputRef}
                uploadPhase={uploadUi.phase}
                uploadPercent={uploadUi.percent}
                uploadAwaitingResponse={uploadUi.awaitingResponse}
                uploadFileCount={uploadUi.fileCount}
                onFilePick={onFilePick}
                onUploadFiles={(files) => uploadMutation.mutate(files)}
              />
            </div>
          )}

          {/* ─────────────── Change 5 — Sort + view controls ─────────────── */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "flex-end",
            gap: 16, marginTop: 24, marginBottom: 20,
          }}>
            {/* Sort dropdown */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: fontSerif, fontSize: 12, color: C.muted }}>
                Sort by:
              </span>
              <select
                value={fileSortField ?? "default"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "default") { setFileSortField(null); return; }
                  toggleFileSort(v as FileSortField);
                }}
                style={{
                  fontFamily: fontSerif, fontSize: 12,
                  color: C.navy, background: "#fff",
                  border: `1px solid ${C.border}`,
                  borderRadius: 3, padding: "4px 8px",
                  cursor: "pointer", outline: "none",
                  appearance: "none",
                  paddingRight: 24,
                  backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236a5a40' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 7px center",
                  backgroundSize: 10,
                }}
              >
                <option value="default">Default</option>
                <option value="filename">Title {fileSortField === "filename" ? (fileSortDirection === "desc" ? "↓" : "↑") : ""}</option>
                <option value="number">Number {fileSortField === "number" ? (fileSortDirection === "desc" ? "↓" : "↑") : ""}</option>
                <option value="createdAt">Date added {fileSortField === "createdAt" ? (fileSortDirection === "desc" ? "↓" : "↑") : ""}</option>
              </select>
            </div>

            {/* View toggle */}
            <div style={{ display: "flex", gap: 4 }}>
              {/* Bookshelf icon */}
              <button
                type="button"
                title="Bookshelf view"
                onClick={() => setViewMode("bookshelf")}
                style={{
                  width: 28, height: 28, padding: 0, border: "none",
                  borderRadius: 3, cursor: "pointer",
                  background: viewMode === "bookshelf" ? C.navy : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "background 150ms",
                }}
                aria-pressed={viewMode === "bookshelf"}
              >
                <svg viewBox="0 0 20 20" width="16" height="16" fill="none">
                  <rect x="2" y="13" width="4" height="5" rx="0.5"
                    fill={viewMode === "bookshelf" ? "#fff" : C.muted} />
                  <rect x="8" y="10" width="4" height="8" rx="0.5"
                    fill={viewMode === "bookshelf" ? "#fff" : C.muted} />
                  <rect x="14" y="7" width="4" height="11" rx="0.5"
                    fill={viewMode === "bookshelf" ? "#fff" : C.muted} />
                </svg>
              </button>
              {/* List icon */}
              <button
                type="button"
                title="List view"
                onClick={() => setViewMode("list")}
                style={{
                  width: 28, height: 28, padding: 0, border: "none",
                  borderRadius: 3, cursor: "pointer",
                  background: viewMode === "list" ? C.navy : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "background 150ms",
                }}
                aria-pressed={viewMode === "list"}>
                <svg viewBox="0 0 20 20" width="16" height="16" fill="none">
                  <rect x="2"  y="4"  width="16" height="2" rx="1" fill={viewMode === "list" ? "#fff" : C.muted} />
                  <rect x="2"  y="9"  width="16" height="2" rx="1" fill={viewMode === "list" ? "#fff" : C.muted} />
                  <rect x="2"  y="14" width="16" height="2" rx="1" fill={viewMode === "list" ? "#fff" : C.muted} />
                </svg>
              </button>
            </div>
          </div>

          {/* ─────────────── Change 3 — Bookshelf / List view ─────────────── */}
          {viewMode === "bookshelf" ? (
            <>
            <BookshelfView
              files={visibleFiles}
              isAdmin={admin}
              folderLocked={folderLocked}
              searchQuery={folderSearch}
              onDelete={(file) => setFilePendingDelete(file)}
              allowReorder={canPersistFileOrder}
              reorderSaving={reorderFilesMutation.isPending}
              onReorder={(next) => {
                setOrderedFiles(next);
                reorderFilesMutation.mutate(next.map((f) => f.id));
              }}
              newlyUploadedIds={pendingThumbIds}
              onThumbSettled={onThumbSettled}
              ragUploadedIds={admin ? ragUploadedIds : undefined}
              ragStatusLoading={admin && ragStatusQuery.isLoading}
              onUploadToRag={(file) => uploadToRagMutation.mutate(file.id)}
              ragUploadPendingId={uploadToRagMutation.isPending ? uploadToRagMutation.variables ?? null : null}
            />
            {(renameFileMutation.isError || reorderFilesMutation.isError) && (
              <p style={{ fontFamily: fontSerif, fontSize: 12, color: "#c0392b", marginTop: 12 }}>
                Could not save file name or order. Please try again.
              </p>
            )}
            </>
          ) : (
            <>
            <ListView
              files={visibleFiles}
              searchQuery={folderSearch}
              isAdmin={admin}
              folderLocked={folderLocked}
              onDelete={(file) => setFilePendingDelete(file)}
              allowReorder={canPersistFileOrder}
              reorderSaving={reorderFilesMutation.isPending}
              onReorder={(next) => {
                setOrderedFiles(next);
                reorderFilesMutation.mutate(next.map((f) => f.id));
              }}
              allowRename={admin && !uploadBlockedForUser}
              renamePendingId={renameFileMutation.isPending ? renameFileMutation.variables?.fileId ?? null : null}
              onRename={(fileId, filename) => renameFileMutation.mutate({ fileId, filename })}
              newlyUploadedIds={pendingThumbIds}
              onThumbSettled={onThumbSettled}
              ragUploadedIds={admin ? ragUploadedIds : undefined}
              ragStatusLoading={admin && ragStatusQuery.isLoading}
              onUploadToRag={(file) => uploadToRagMutation.mutate(file.id)}
              ragUploadPendingId={uploadToRagMutation.isPending ? uploadToRagMutation.variables ?? null : null}
            />
            {(renameFileMutation.isError || reorderFilesMutation.isError) && (
              <p style={{ fontFamily: fontSerif, fontSize: 12, color: "#c0392b", marginTop: 12 }}>
                Could not save file name or order. Please try again.
              </p>
            )}
            </>
          )}

        </div>

        {/* Chat widget */}
        <DocumentChatWidget folderId={folderId} contextLabel={folder.foldername} />
      </section>

      {filePendingDelete && (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="delete-volume-title"
          onClick={() => { if (!deleteFileMutation.isPending) setFilePendingDelete(null); }}
          style={{
            position: "fixed", inset: 0, zIndex: 960,
            background: "rgba(10,16,34,0.38)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 400, width: "100%",
              background: C.paper, border: `1px solid ${C.border}`,
              borderRadius: 6, padding: "20px 22px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.12)",
            }}
          >
            <h2 id="delete-volume-title" style={{
              fontFamily: fontDisplay, fontSize: 18, fontWeight: 700,
              color: C.navy, margin: 0,
            }}>
              Delete this volume?
            </h2>
            <p style={{
              fontFamily: fontSerif, fontSize: 13, color: C.textMid,
              marginTop: 10, lineHeight: 1.5, wordBreak: "break-word",
            }}>
              <strong>{filePendingDelete.filename}</strong> will be removed from this folder. This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 22 }}>
              <button
                type="button"
                disabled={deleteFileMutation.isPending}
                onClick={() => setFilePendingDelete(null)}
                style={{
                  fontFamily: fontSerif, fontSize: 13, padding: "8px 16px",
                  borderRadius: 4, border: `1px solid ${C.border}`,
                  background: "#fff", color: C.navy, cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteFileMutation.isPending}
                onClick={() => {
                  const id = filePendingDelete.id;
                  deleteFileMutation.mutate(id, {
                    onSettled: () => setFilePendingDelete(null),
                  });
                }}
                style={{
                  fontFamily: fontSerif, fontSize: 13, padding: "8px 16px",
                  borderRadius: 4, border: "none",
                  background: "#a53c2e", color: "#fff", cursor: "pointer",
                  opacity: deleteFileMutation.isPending ? 0.7 : 1,
                }}
              >
                {deleteFileMutation.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── SlimDropZone ─────────────────────────────────────────────────────────────

const UPLOAD_RING_SIZE = 34;
const UPLOAD_RING_STROKE = 3;
const UPLOAD_RING_RADIUS = (UPLOAD_RING_SIZE - UPLOAD_RING_STROKE) / 2;
const UPLOAD_RING_CIRCUMFERENCE = 2 * Math.PI * UPLOAD_RING_RADIUS;

/**
 * One persistent circular badge that morphs across every phase (idle icon → progress ring →
 * spinner → checkmark) instead of swapping in unrelated elements per phase — a single evolving
 * focal point reads as continuous, alive motion rather than a sequence of disjointed pop-ins.
 */
function UploadBadge({
  phase, percent, awaitingResponse,
}: { phase: UploadUiPhase; percent: number; awaitingResponse: boolean }) {
  if (phase === "done") {
    return (
      <span aria-hidden style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        width: UPLOAD_RING_SIZE, height: UPLOAD_RING_SIZE, borderRadius: "50%",
        background: "#2d6a3a",
        animation: "uploadCheckPop 420ms cubic-bezier(0.34,1.56,0.64,1) both",
      }}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M20 6L9 17l-5-5"
            pathLength={1}
            style={{ strokeDasharray: 1, strokeDashoffset: 1, animation: "uploadCheckDraw 380ms 120ms cubic-bezier(0.22,1,0.36,1) forwards" }}
          />
        </svg>
      </span>
    );
  }

  if (phase === "error") {
    return (
      <span aria-hidden style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        width: UPLOAD_RING_SIZE, height: UPLOAD_RING_SIZE, borderRadius: "50%",
        background: "#a53c2e", color: "#fff",
        fontFamily: fontSerif, fontSize: 15, fontWeight: 700, lineHeight: 1,
        animation: "uploadCheckPop 420ms cubic-bezier(0.34,1.56,0.64,1) both",
      }}>
        !
      </span>
    );
  }

  if (phase === "idle") {
    return (
      <span aria-hidden style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        width: UPLOAD_RING_SIZE, height: UPLOAD_RING_SIZE, borderRadius: "50%",
        border: `1.5px solid ${C.border}`, color: C.muted,
        transition: "border-color 250ms ease, color 250ms ease",
      }}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
          <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        </svg>
      </span>
    );
  }

  // uploading / processing — a determinate ring fills with real byte progress, then hands off
  // to a spinning arc once bytes are sent but the server hasn't answered yet.
  const determinate = phase === "uploading" && !awaitingResponse;
  return (
    <span style={{ width: UPLOAD_RING_SIZE, height: UPLOAD_RING_SIZE, flexShrink: 0, display: "inline-flex" }} aria-hidden>
      <svg
        width={UPLOAD_RING_SIZE} height={UPLOAD_RING_SIZE} viewBox={`0 0 ${UPLOAD_RING_SIZE} ${UPLOAD_RING_SIZE}`}
        style={{ transform: "rotate(-90deg)", animation: determinate ? undefined : "uploadRingSpin 900ms linear infinite" }}
      >
        <circle
          cx={UPLOAD_RING_SIZE / 2} cy={UPLOAD_RING_SIZE / 2} r={UPLOAD_RING_RADIUS}
          fill="none" stroke="#ece1cd" strokeWidth={UPLOAD_RING_STROKE}
        />
        <circle
          cx={UPLOAD_RING_SIZE / 2} cy={UPLOAD_RING_SIZE / 2} r={UPLOAD_RING_RADIUS}
          fill="none" stroke={C.gold} strokeWidth={UPLOAD_RING_STROKE} strokeLinecap="round"
          strokeDasharray={determinate ? UPLOAD_RING_CIRCUMFERENCE : `${UPLOAD_RING_CIRCUMFERENCE * 0.26} ${UPLOAD_RING_CIRCUMFERENCE * 0.74}`}
          strokeDashoffset={determinate ? UPLOAD_RING_CIRCUMFERENCE * (1 - percent / 100) : 0}
          style={{ transition: determinate ? "stroke-dashoffset 250ms ease" : undefined }}
        />
      </svg>
    </span>
  );
}

/**
 * Cycles through a fixed list of phrases while `active`, instead of one static line sitting there
 * for however long a wait takes — visible variety reads as ongoing progress, not a stuck UI.
 */
function useRotatingMessages(active: boolean, messages: readonly string[]): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) {
      setIndex(0);
      return;
    }
    if (messages.length <= 1) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % messages.length);
    }, 2600);
    return () => window.clearInterval(id);
  }, [active, messages]);
  return messages[index] ?? messages[0] ?? "";
}

function SlimDropZone({
  locked,
  fileInputRef,
  uploadPhase,
  uploadPercent,
  uploadAwaitingResponse,
  uploadFileCount,
  onFilePick,
  onUploadFiles,
}: {
  locked: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  uploadPhase: UploadUiPhase;
  uploadPercent: number;
  uploadAwaitingResponse: boolean;
  uploadFileCount: number;
  onFilePick: (event: ChangeEvent<HTMLInputElement>) => void;
  onUploadFiles: (files: File[]) => void;
}) {
  const [active, setActive] = useState(false);
  const isIdle = uploadPhase === "idle";

  const awaitingMessages = useMemo(() => [
    "Almost there — saving to your shelf…",
    "Just a moment, tidying the pages…",
    "Finding the perfect spot on the shelf…",
    "Wrapping up the last few details…",
  ], []);
  const processingMessages = useMemo(() => [
    `Preparing ${uploadFileCount > 0 ? uploadFileCountLabel(uploadFileCount) : "your file"} for the shelf…`,
    "Rendering the cover…",
    "Almost ready to read…",
    "Just a few more seconds…",
  ], [uploadFileCount]);
  const awaitingMessage = useRotatingMessages(uploadPhase === "uploading" && uploadAwaitingResponse, awaitingMessages);
  const processingMessage = useRotatingMessages(uploadPhase === "processing", processingMessages);

  if (locked) {
    return (
      <div style={{
        height: 52,
        display: "flex", alignItems: "center", justifyContent: "center",
        border: `1px dashed ${C.border}`,
        borderRadius: 4,
        fontFamily: fontSerif, fontSize: 13, fontStyle: "italic", color: C.muted,
      }}>
        Folder is locked — unlock it from the library to upload volumes.
      </div>
    );
  }

  const label = (() => {
    switch (uploadPhase) {
      case "uploading":
        return uploadAwaitingResponse
          ? awaitingMessage
          : `${uploadFileCount > 0 ? `Uploading ${uploadFileCountLabel(uploadFileCount)}` : "Uploading…"}${uploadPercent > 0 ? ` · ${uploadPercent}%` : ""}`;
      case "processing":
        return processingMessage;
      case "done":
        return `Added to your shelf${uploadFileCount > 0 ? ` · ${uploadFileCountLabel(uploadFileCount)}` : ""}`;
      case "error":
        return "Upload failed — please try again.";
      default:
        return active ? "Release to add this volume" : "Drop a PDF here to add a new volume";
    }
  })();

  const tone =
    uploadPhase === "done" ? { border: "rgba(45,106,58,0.35)", bg: "rgba(45,106,58,0.045)", text: "#2d6a3a" }
    : uploadPhase === "error" ? { border: "rgba(165,60,46,0.32)", bg: "rgba(165,60,46,0.04)", text: "#a53c2e" }
    : uploadPhase !== "idle" ? { border: "rgba(201,124,42,0.32)", bg: "rgba(201,124,42,0.035)", text: C.muted }
    : { border: active ? C.gold : C.border, bg: active ? "rgba(201,124,42,0.045)" : "#fff", text: C.muted };

  return (
    <div
      role={isIdle ? "button" : undefined}
      tabIndex={isIdle ? 0 : undefined}
      style={{
        minHeight: 60,
        display: "flex", alignItems: "center", gap: 14,
        padding: "0 18px",
        borderRadius: 14,
        border: `1.5px solid ${tone.border}`,
        background: tone.bg,
        transform: active ? "scale(1.008)" : "scale(1)",
        boxShadow: uploadPhase !== "idle" ? "0 2px 12px rgba(26,39,68,0.06)" : "none",
        transition: "border-color 320ms ease, background 320ms ease, transform 200ms ease, box-shadow 320ms ease",
        cursor: isIdle ? "pointer" : "default",
      }}
      onDragEnter={(e) => { if (!isIdle) return; e.preventDefault(); e.stopPropagation(); setActive(true); }}
      onDragOver={(e)  => { if (!isIdle) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={(e) => {
        e.preventDefault();
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(false);
      }}
      onDrop={(e) => {
        if (!isIdle) return;
        e.preventDefault(); e.stopPropagation();
        setActive(false);
        const files = collectPdfFiles(e.dataTransfer.files);
        if (files.length) onUploadFiles(files);
      }}
      onClick={() => { if (isIdle) fileInputRef.current?.click(); }}
      onKeyDown={(e) => {
        if (!isIdle) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); }
      }}
    >
      <UploadBadge phase={uploadPhase} percent={uploadPercent} awaitingResponse={uploadAwaitingResponse} />
      <p
        key={label}
        style={{
          flex: 1, minWidth: 0, margin: 0,
          fontFamily: fontSerif, fontSize: 13, fontStyle: isIdle ? "italic" : "normal",
          color: tone.text,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          animation: "chatWaitingFadeIn 260ms ease",
        }}
      >
        {label}
      </p>
      {isIdle && !active && (
        <span style={{
          flexShrink: 0, fontFamily: fontSerif, fontSize: 12, fontWeight: 600, color: C.gold,
          border: `1px solid ${C.gold}`, borderRadius: 999, padding: "5px 12px",
        }}>
          Browse
        </span>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        style={{ display: "none" }}
        onChange={onFilePick}
        disabled={!isIdle}
      />
    </div>
  );
}

// ─── Utility functions ────────────────────────────────────────────────────────

function uploadFileCountLabel(count: number): string {
  if (count <= 0) return "";
  return count === 1 ? "1 file" : `${count} files`;
}

function collectPdfFiles(source: FileList | File[] | null | undefined): File[] {
  if (!source) return [];
  return Array.from(source).filter(
    (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
  );
}

function compareVersionLikeFilename(a: string, b: string): number {
  const aT = extractLeadingNumberTokens(a);
  const bT = extractLeadingNumberTokens(b);
  const max = Math.max(aT.length, bT.length);
  for (let i = 0; i < max; i++) {
    const l = aT[i], r = bT[i];
    if (l === undefined && r === undefined) break;
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l !== r) return l - r;
  }
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

function extractLeadingNumberTokens(filename: string): number[] {
  const m = filename.trim().match(/^\d+(?:\.\d+)*/)?.[0];
  if (!m) return [];
  return m.split(".").map(Number).filter((n) => Number.isFinite(n));
}

// ─── FolderSearchItem (unchanged logic, restyled) ─────────────────────────────

function FolderSearchItem({ item, keyword, returnTo }: { item: FileVersionItem; keyword: string; returnTo: string }) {
  const [pageChunk, setPageChunk] = useState(0);
  const pageEntries = Array.from(
    new Map(
      (item.content ?? []).map((e) => [
        Math.max(1, e.page + 1),
        { page: Math.max(1, e.page + 1), snippet: extractSentencePreview(e.content, keyword) },
      ])
    ).values()
  ).sort((a, b) => a.page - b.page);

  const totalChunks  = Math.max(1, Math.ceil(pageEntries.length / PAGE_CHUNK_SIZE));
  const pagedEntries = pageEntries.slice(pageChunk * PAGE_CHUNK_SIZE, (pageChunk + 1) * PAGE_CHUNK_SIZE);

  return (
    <li style={{
      padding: "12px 14px",
      borderBottom: `1px solid ${C.border}`,
    }}>
      <Link
        href={`/files/${item.id}`}
        style={{
          fontFamily: fontSerif, fontSize: 15, fontWeight: 600,
          color: C.navy, textDecoration: "none",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
        onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
      >
        {item.filename}
      </Link>
      {pagedEntries.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {pagedEntries.map((entry) => (
              <li key={`${item.id}-${entry.page}`}>
                <Link
                  href={`/files/${item.id}?page=${entry.page}&keyword=${encodeURIComponent(keyword)}&returnTo=${returnTo}`}
                  style={{
                    display: "block",
                    border: `1px solid ${C.border}`,
                    borderRadius: 3,
                    padding: "8px 10px",
                    textDecoration: "none",
                    transition: "border-color 120ms, box-shadow 120ms",
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLAnchorElement;
                    el.style.borderColor = C.gold;
                    el.style.boxShadow   = "0 2px 8px rgba(201,124,42,0.10)";
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLAnchorElement;
                    el.style.borderColor = C.border;
                    el.style.boxShadow   = "none";
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontFamily: fontSerif, fontSize: 13, fontWeight: 600, color: C.navy }}>
                      Page {entry.page}
                    </span>
                    <span style={{ fontFamily: fontSerif, fontSize: 11, color: C.muted }}>Open →</span>
                  </div>
                  <p style={{
                    fontFamily: fontSerif, fontSize: 12, color: C.textMid,
                    lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {highlightKeyword(entry.snippet, keyword)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          {pageEntries.length > PAGE_CHUNK_SIZE && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setPageChunk((p) => Math.max(0, p - 1))}
                disabled={pageChunk === 0}
                style={{
                  fontFamily: fontSerif, fontSize: 12, color: C.navy,
                  border: `1px solid ${C.border}`, borderRadius: 3,
                  padding: "3px 8px", cursor: "pointer", background: "#fff",
                }}
              >
                ← Prev
              </button>
              <span style={{ fontFamily: fontSerif, fontSize: 12, color: C.muted }}>
                {pageChunk + 1} / {totalChunks}
              </span>
              <button
                type="button"
                onClick={() => setPageChunk((p) => Math.min(totalChunks - 1, p + 1))}
                disabled={pageChunk >= totalChunks - 1}
                style={{
                  fontFamily: fontSerif, fontSize: 12, color: C.navy,
                  border: `1px solid ${C.border}`, borderRadius: 3,
                  padding: "3px 8px", cursor: "pointer", background: "#fff",
                }}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function highlightKeyword(text: string, keyword: string): ReactNode {
  const k = keyword.trim();
  if (!k) return text;
  const esc  = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const segs = text.split(new RegExp(`(${esc})`, "gi"));
  return segs.map((seg, i) =>
    seg.toLowerCase() === k.toLowerCase() ? (
      <mark key={i} style={{ background: "rgba(201,124,42,0.22)", borderRadius: 2, padding: "0 1px" }}>
        {seg}
      </mark>
    ) : (
      <Fragment key={i}>{seg}</Fragment>
    )
  );
}

function extractSentencePreview(content: string, keyword: string): string {
  const n = normalizePreviewText(content);
  if (!n) return "...";
  const lk = keyword.trim().toLowerCase();
  const maxLength = 220, contextRadius = 110;
  if (!lk) return n.length > maxLength ? `${n.slice(0, maxLength)}...` : n;
  const idx = n.toLowerCase().indexOf(lk);
  if (idx < 0) return n.length > maxLength ? `${n.slice(0, maxLength)}...` : n;
  const start  = Math.max(0, idx - contextRadius);
  const end    = Math.min(n.length, idx + lk.length + contextRadius);
  return `${start > 0 ? "..." : ""}${n.slice(start, end)}${end < n.length ? "..." : ""}`;
}

function normalizePreviewText(content: string): string {
  return content
    .replace(/\s+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z0-9])([^\x00-\x7F])/g, "$1 $2")
    .replace(/([^\x00-\x7F])([A-Za-z0-9])/g, "$1 $2")
    .replace(/([,.;:!?])(?=\S)/g, "$1 ")
    .trim();
}

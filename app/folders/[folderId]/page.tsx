"use client";

import Link from "next/link";
import {
  ChangeEvent,
  DragEvent,
  Fragment,
  type RefObject,
  ReactNode,
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
import { api, patchFileFilename, patchFileOrder } from "@/lib/api";
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
type UploadUiPhase  = "idle" | "uploading" | "done" | "error";
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadUi, setUploadUi] = useState<{
    phase: UploadUiPhase; percent: number; indeterminate: boolean; fileCount: number;
  }>({ phase: "idle", percent: 0, indeterminate: false, fileCount: 0 });

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

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const formData = new FormData();
      files.forEach((f) => formData.append("pdf", f));
      await api.post(`/files/upload/${folderId}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (event) => {
          const total = event.total ?? 0;
          if (total > 0) {
            const percent = Math.min(100, Math.round((event.loaded / total) * 100));
            setUploadUi((prev) => ({ ...prev, phase: "uploading", percent, indeterminate: false }));
          }
        },
      });
    },
    onMutate: (files: File[]) => {
      setUploadUi({ phase: "uploading", percent: 0, indeterminate: true, fileCount: files.length });
    },
    onSuccess: () => {
      setUploadUi((prev) => ({ ...prev, phase: "done", percent: 100, indeterminate: false }));
      void folderQuery.refetch();
    },
    onError: () => {
      setUploadUi((prev) => ({ ...prev, phase: "error", percent: 0, indeterminate: false }));
    },
  });

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
    if (uploadUi.phase !== "done") return;
    const t = window.setTimeout(() => {
      setUploadUi({ phase: "idle", percent: 0, indeterminate: false, fileCount: 0 });
    }, 2800);
    return () => window.clearTimeout(t);
  }, [uploadUi.phase]);

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
      <div style={{ padding: "48px 24px", fontFamily: fontSerif, color: C.muted, fontSize: 14 }}>
        Loading folder…
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
                uploadIndeterminate={uploadUi.indeterminate}
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
            <BookshelfView
              files={visibleFiles}
              isAdmin={admin}
              folderLocked={folderLocked}
              searchQuery={folderSearch}
              onDelete={(file) => setFilePendingDelete(file)}
            />
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

function SlimDropZone({
  locked,
  fileInputRef,
  uploadPhase,
  uploadPercent,
  uploadIndeterminate,
  uploadFileCount,
  onFilePick,
  onUploadFiles,
}: {
  locked: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  uploadPhase: UploadUiPhase;
  uploadPercent: number;
  uploadIndeterminate: boolean;
  uploadFileCount: number;
  onFilePick: (event: ChangeEvent<HTMLInputElement>) => void;
  onUploadFiles: (files: File[]) => void;
}) {
  const [active, setActive] = useState(false);
  const isUploading = uploadPhase === "uploading";

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

  // Progress / result states
  if (uploadPhase === "uploading") {
    return (
      <div style={{
        height: 52, border: `1px dashed ${C.border}`, borderRadius: 4,
        display: "flex", alignItems: "center", gap: 12, padding: "0 16px",
      }}>
        <div style={{ flex: 1, height: 4, background: "#e8e0d0", borderRadius: 2, overflow: "hidden" }}>
          {uploadIndeterminate ? (
            <div style={{
              height: "100%", width: "38%", background: C.gold, borderRadius: 2,
              animation: "slimBarSlide 1.15s ease-in-out infinite",
            }} />
          ) : (
            <div style={{
              height: "100%", background: C.gold, borderRadius: 2,
              width: `${Math.max(2, uploadPercent)}%`,
              transition: "width 200ms ease",
            }} />
          )}
        </div>
        <span style={{ fontFamily: fontSerif, fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>
          {uploadFileCount > 0 ? `Uploading ${uploadFileCountLabel(uploadFileCount)}` : "Uploading…"}
          {!uploadIndeterminate && uploadPercent > 0 ? ` · ${uploadPercent}%` : ""}
        </span>
      </div>
    );
  }

  if (uploadPhase === "done") {
    return (
      <div style={{
        height: 52, border: `1px solid rgba(22,163,74,0.4)`,
        background: "rgba(22,163,74,0.04)",
        borderRadius: 4,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        fontFamily: fontSerif, fontSize: 13, color: "#15803d",
      }}>
        <span style={{
          display: "inline-flex", width: 18, height: 18, borderRadius: "50%",
          background: "#16a34a", color: "#fff",
          alignItems: "center", justifyContent: "center", fontSize: 11,
        }}>✓</span>
        Upload complete
        {uploadFileCount > 0 && ` · ${uploadFileCountLabel(uploadFileCount)}`}
      </div>
    );
  }

  if (uploadPhase === "error") {
    return (
      <div style={{
        height: 52, border: `1px solid rgba(220,38,38,0.3)`,
        background: "rgba(220,38,38,0.03)",
        borderRadius: 4,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: fontSerif, fontSize: 13, color: "#b91c1c",
      }}>
        Upload failed. Please try again.
      </div>
    );
  }

  // Idle state
  return (
    <div
      style={{
        height: 52,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        border: `1px dashed ${active ? C.gold : C.border}`,
        borderRadius: 4,
        background: active ? "rgba(201,124,42,0.04)" : "transparent",
        transform: active ? "scale(1.01)" : "scale(1)",
        transition: "border-color 150ms, background 150ms, transform 150ms",
        cursor: "pointer",
      }}
      onDragEnter={(e) => { if (isUploading) return; e.preventDefault(); e.stopPropagation(); setActive(true); }}
      onDragOver={(e)  => { if (isUploading) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={(e) => {
        e.preventDefault();
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(false);
      }}
      onDrop={(e) => {
        if (isUploading) return;
        e.preventDefault(); e.stopPropagation();
        setActive(false);
        const files = collectPdfFiles(e.dataTransfer.files);
        if (files.length) onUploadFiles(files);
      }}
      onClick={() => fileInputRef.current?.click()}
    >
      <span style={{ fontSize: 15, lineHeight: 1 }}>📄</span>
      <span style={{ fontFamily: fontSerif, fontSize: 13, fontStyle: "italic", color: C.muted }}>
        {active
          ? "Release to add this volume"
          : "Drop a PDF here to add a new volume  ·  or "}
      </span>
      {!active && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          style={{
            fontFamily: fontSerif, fontSize: 13, color: C.gold,
            background: "none", border: "none", padding: 0, cursor: "pointer",
            textDecoration: "none",
            transition: "text-decoration 120ms",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
        >
          Browse files
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        style={{ display: "none" }}
        onChange={onFilePick}
        disabled={isUploading}
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

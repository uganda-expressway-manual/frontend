"use client";

import Link from "next/link";
import { Fragment, ReactNode, useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { DragEvent, MutableRefObject } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDebounce } from "use-debounce";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAdminUser } from "@/lib/auth-user";
import { api } from "@/lib/api";
import { DocumentChatWidget } from "@/components/document-chat-widget";
import { useAuth } from "@/lib/hooks/use-auth";
import { LOCKED_SPINE_COLOR, pickRandomSpineColor } from "@/lib/folder-spine-color";
import { Folder } from "@/lib/types";

/* ── Design tokens (matches BookHomepage.jsx) ── */
const fontSerif = "'Playfair Display', Georgia, serif";
const fontBody = "'Source Serif 4', Georgia, serif";
const C = {
  navy: "#1a2744",
  gold: "#c97c2a",
  paper: "#faf8f3",
  bg: "#f4f1ec",
  border: "#d0c4aa",
  muted: "#a07848",
  spine: "#f0e8d8", // page-edge cream
};

const BOOKS_PER_SHELF = 5;
const PAGE_CHUNK_SIZE = 5;
/** Pick-up + open exit animation before navigating into a folder (see BookSpine `transform`/`opacity`). */
const FOLDER_OPEN_MS = 420;

/** Same idea as folder interior: dim spines that do not match the search string (folder name or any PDF filename). */
function folderMatchesFileNameFilter(folder: Folder, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (folder.foldername.toLowerCase().includes(q)) return true;
  return folder.files.some((f) => f.filename.toLowerCase().includes(q));
}

interface GlobalFindItem {
  id: string;
  filename: string;
  content?: Array<{ page: number; content: string }>;
}

/* ═══════════════════════════════════════════════════════════════
   FolderBrowser (top-level export — data & state unchanged)
═══════════════════════════════════════════════════════════════ */

/** Keeps a panel mounted through its fade-out so closing animates instead of vanishing instantly. */
function useFadeMount(visible: boolean, durationMs = 180): { mounted: boolean; entered: boolean } {
  const [mounted, setMounted] = useState(visible);
  const [entered, setEntered] = useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    setEntered(false);
    const t = window.setTimeout(() => setMounted(false), durationMs);
    return () => window.clearTimeout(t);
  }, [visible, durationMs]);
  return { mounted, entered };
}

/** Shared backdrop + dialog wrapper: fades in on open, fades out on close instead of snapping. */
function FadeOverlay({
  open, onClose, zIndex = 1000, backdrop = "rgba(10,16,34,0.45)", ariaLabel, children,
}: {
  open: boolean;
  onClose: () => void;
  zIndex?: number;
  backdrop?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const { mounted, entered } = useFadeMount(open);
  if (!mounted) return null;
  return (
    <div
      role="dialog"
      aria-modal
      aria-label={ariaLabel}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex,
        background: backdrop,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
        opacity: entered ? 1 : 0,
        transition: "opacity 180ms ease",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          transform: entered ? "translateY(0) scale(1)" : "translateY(8px) scale(0.98)",
          transition: "transform 180ms ease",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function FolderBrowser() {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const admin = isAdminUser(user);
  const urlKeyword = searchParams.get("keyword") ?? "";

  const [globalSearch, setGlobalSearch] = useState(urlKeyword);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderLock, setNewFolderLock] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const createFolderFade = useFadeMount(showCreateFolder);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const [folderLockDraft, setFolderLockDraft] = useState(false);
  const [orderedFolders, setOrderedFolders] = useState<Folder[]>([]);
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [lockedModal, setLockedModal] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const orderedFoldersRef = useRef<Folder[]>([]);
  const folderDragGhostRef = useRef<HTMLDivElement | null>(null);
  const folderDragPointerOffsetRef = useRef({ x: 0, y: 0 });

  const [debouncedGlobalSearch] = useDebounce(globalSearch, 300);

  const foldersQuery = useQuery({
    queryKey: ["folders"],
    queryFn: async () => (await api.get<Folder[]>("/folders")).data,
  });
  const globalSearchQuery = useQuery({
    queryKey: ["global-file-search", debouncedGlobalSearch],
    queryFn: async () =>
      (await api.get<GlobalFindItem[]>("/files/find", { params: { keyword: debouncedGlobalSearch } })).data,
    enabled: debouncedGlobalSearch.trim().length > 0,
  });

  const createFolderMutation = useMutation({
    mutationFn: async ({ foldername, lock, order }: { foldername: string; lock: boolean; order: number }) =>
      api.post("/folders", { foldername, lock, order, spineColor: pickRandomSpineColor() }),
    onSuccess: () => {
      setNewFolderName(""); setNewFolderLock(false);
      queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
  });
  const renameFolderMutation = useMutation({
    mutationFn: async ({ folderId, foldername, lock }: { folderId: string; foldername: string; lock: boolean }) =>
      api.patch(`/folders/${folderId}`, { foldername, lock }),
    onSuccess: () => {
      setEditingFolderId(null); setFolderNameDraft(""); setFolderLockDraft(false);
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      queryClient.invalidateQueries({ queryKey: ["folder"] });
    },
  });
  const deleteFolderMutation = useMutation({
    mutationFn: async (folderId: string) => api.delete(`/folders/${folderId}`),
    onSuccess: () => {
      setEditingFolderId(null); setFolderNameDraft(""); setFolderLockDraft(false);
      queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
  });
  const saveFolderOrdersMutation = useMutation({
    mutationFn: async (orders: { folderId: string; order: number }[]) =>
      api.patch("/folders/order", { orders }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["folders"] }); },
    onError: () => { void queryClient.invalidateQueries({ queryKey: ["folders"] }); },
  });

  const serverFolderListSignature = useMemo(
    () => (foldersQuery.data ?? []).map((f) => `${f.id}:${f.order ?? f.sortOrder ?? 0}`).join("|"),
    [foldersQuery.data]
  );
  const searchContextHref = useMemo(() => {
    const params = new URLSearchParams();
    const t = globalSearch.trim();
    if (t) params.set("keyword", t);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [globalSearch, pathname]);

  useEffect(() => { setGlobalSearch(urlKeyword); }, [urlKeyword]);
  useEffect(() => { orderedFoldersRef.current = orderedFolders; }, [orderedFolders]);
  useEffect(() => () => { folderDragGhostRef.current?.remove(); folderDragGhostRef.current = null; }, []);
  useEffect(() => {
    const data = foldersQuery.data;
    if (!data) { setOrderedFolders([]); return; }
    setOrderedFolders(sortFoldersByOrder([...data]));
  }, [serverFolderListSignature, foldersQuery.data]);
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const t = debouncedGlobalSearch.trim();
    if (t) params.set("keyword", t); else params.delete("keyword");
    const currentQ = searchParams.toString();
    const nextQ = params.toString();
    if (currentQ !== nextQ) {
      router.replace(nextQ ? `${pathname}?${nextQ}` : pathname, { scroll: false });
    }
  }, [debouncedGlobalSearch, pathname, router, searchParams]);

  const onFolderDrop = (event: DragEvent<HTMLElement>, targetFolderId: string) => {
    event.preventDefault();
    if (!admin || !draggedFolderId || draggedFolderId === targetFolderId) {
      setDragOverFolderId(null); return;
    }
    const next = trySwapFolderList(orderedFoldersRef.current, draggedFolderId, targetFolderId);
    if (!next) { setDragOverFolderId(null); setDraggedFolderId(null); return; }
    setOrderedFolders(next);
    saveFolderOrdersMutation.mutate(next.map((f, i) => ({ folderId: f.id, order: i })));
    setDragOverFolderId(null); setDraggedFolderId(null);
  };

  /* split folders into shelves */
  const shelves: Folder[][] = [];
  for (let i = 0; i < orderedFolders.length; i += BOOKS_PER_SHELF) {
    shelves.push(orderedFolders.slice(i, i + BOOKS_PER_SHELF));
  }

  return (
    <section style={{ fontFamily: fontBody }}>

      {/* ── Search bar ── */}
      <div style={{
        background: C.paper, border: `1px solid ${C.border}`,
        borderRadius: 6, padding: "16px 20px", marginBottom: 28,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Search input */}
          <div style={{ position: "relative", flex: 1 }}>
            <span style={{
              position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
              pointerEvents: "none", color: C.navy, opacity: 0.5, display: "flex",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
            </span>
            <input
              id="globalSearch"
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              placeholder="Search manuals, chapters, keywords…"
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "9px 12px 9px 38px",
                fontFamily: fontBody, fontSize: 14, fontStyle: "italic",
                color: C.navy,
                background: "white",
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                outline: "none",
                transition: "border-color 200ms, box-shadow 200ms",
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = C.gold;
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(201,124,42,0.12)";
                e.currentTarget.style.fontStyle = "normal";
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = C.border;
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.fontStyle = globalSearch ? "normal" : "italic";
              }}
            />
          </div>

          {/* Admin: create folder button */}
          {admin && (
            <button
              type="button"
              onClick={() => setShowCreateFolder(v => !v)}
              title="New folder"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 14px",
                fontFamily: fontBody, fontSize: 13, color: C.navy,
                background: "transparent", border: `1px solid ${C.navy}`,
                borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap",
                transition: "background 200ms",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(26,39,68,0.06)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              + New Folder
            </button>
          )}
        </div>

        {/* Create folder panel */}
        {admin && createFolderFade.mounted && (
          <div style={{
            marginTop: 14, padding: "14px 16px",
            background: "#f0ebe0", border: `1px solid ${C.border}`,
            borderRadius: 4,
            opacity: createFolderFade.entered ? 1 : 0,
            transform: createFolderFade.entered ? "translateY(0)" : "translateY(-6px)",
            transition: "opacity 180ms ease, transform 180ms ease",
          }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <input
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                placeholder="Folder name"
                style={{
                  flex: 1, minWidth: 200,
                  padding: "8px 10px", fontFamily: fontBody, fontSize: 13,
                  border: `1px solid ${C.border}`, borderRadius: 4,
                  background: "white", color: C.navy, outline: "none",
                }}
              />
              <label style={{
                display: "flex", alignItems: "center", gap: 8,
                fontFamily: fontBody, fontSize: 13, color: C.navy, cursor: "pointer"
              }}>
                <input
                  type="checkbox" checked={newFolderLock}
                  onChange={e => setNewFolderLock(e.target.checked)}
                  style={{ width: 14, height: 14, accentColor: C.navy }}
                />
                Lock folder
              </label>
              <button
                type="button"
                disabled={!newFolderName.trim() || createFolderMutation.isPending}
                onClick={() => createFolderMutation.mutate({
                  foldername: newFolderName.trim(), lock: newFolderLock,
                  order: (foldersQuery.data?.length ?? 0) + 1,
                })}
                style={{
                  padding: "8px 16px", fontFamily: fontBody, fontSize: 13,
                  background: C.navy, color: "white", border: "none",
                  borderRadius: 4, cursor: "pointer",
                  opacity: !newFolderName.trim() ? 0.5 : 1,
                  transition: "opacity 150ms",
                }}
              >
                {createFolderMutation.isPending ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        )}

        {/* Search results */}
        {globalSearchQuery.isLoading && (
          <p style={{ marginTop: 10, fontFamily: fontBody, fontSize: 12, color: C.muted }}>Searching…</p>
        )}
        {globalSearchQuery.data && (
          <ul style={{ marginTop: 14, listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {globalSearchQuery.data.map(item => (
              <GlobalSearchItem
                key={item.id} item={item}
                keyword={debouncedGlobalSearch}
                returnTo={encodeURIComponent(searchContextHref)}
              />
            ))}
            {!globalSearchQuery.data.length && (
              <li style={{ fontFamily: fontBody, fontSize: 13, color: C.muted }}>No matching files.</li>
            )}
          </ul>
        )}
      </div>

      {/* ── Loading / error states ── */}
      {foldersQuery.isLoading && (
        <p style={{ fontFamily: fontBody, fontSize: 14, color: C.muted }}>Loading library…</p>
      )}
      {foldersQuery.error && (
        <p style={{ fontFamily: fontBody, fontSize: 14, color: "#c0392b" }}>Could not load folders.</p>
      )}
      {admin && saveFolderOrdersMutation.isPending && (
        <p style={{ fontFamily: fontBody, fontSize: 12, color: C.muted, marginBottom: 8 }}>Saving order…</p>
      )}

      {/* ── Bookshelf ── */}
      {shelves.map((shelfFolders, shelfIndex) => (
        <Shelf
          key={shelfIndex}
          folders={shelfFolders}
          shelfIndex={shelfIndex}
          fileNameFilter={globalSearch}
          admin={admin}
          draggedFolderId={draggedFolderId}
          dragOverFolderId={dragOverFolderId}
          onOpenLocked={setLockedModal}
          onEditToggle={(id) => {
            setEditingFolderId((prev) => (prev === id ? null : id));
            const f = orderedFolders.find((x) => x.id === id);
            if (f) {
              setFolderNameDraft(f.foldername);
              setFolderLockDraft(!!f.lock);
            }
          }}
          onDragStart={(folderId, event, cardEl) => {
            setDraggedFolderId(folderId);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", folderId);
            beginFolderCardDragPreview(event, cardEl, folderDragGhostRef, folderDragPointerOffsetRef);
          }}
          onDrag={(event) => {
            const ghost = folderDragGhostRef.current;
            if (!ghost || (event.clientX === 0 && event.clientY === 0)) return;
            const { x, y } = folderDragPointerOffsetRef.current;
            ghost.style.left = `${event.clientX - x}px`;
            ghost.style.top = `${event.clientY - y}px`;
          }}
          onDragEnd={() => {
            folderDragGhostRef.current?.remove(); folderDragGhostRef.current = null;
            setDragOverFolderId(null); setDraggedFolderId(null);
          }}
          onDragOver={(folderId, event) => {
            event.preventDefault(); event.dataTransfer.dropEffect = "move";
            if (draggedFolderId && draggedFolderId !== folderId) setDragOverFolderId(folderId);
          }}
          onDragLeave={(folderId, event) => {
            const next = event.relatedTarget as Node | null;
            if (!event.currentTarget.contains(next)) {
              setDragOverFolderId(prev => prev === folderId ? null : prev);
            }
          }}
          onDrop={onFolderDrop}
          globalStartIndex={shelfIndex * BOOKS_PER_SHELF}
        />
      ))}

      {/* Admin: folder edit floats over shelf (layout does not shift) */}
      {admin && (
        <FadeOverlay
          open={!!editingFolderId}
          onClose={() => { setEditingFolderId(null); setFolderNameDraft(""); setFolderLockDraft(false); }}
          zIndex={940}
          backdrop="rgba(10,16,34,0.38)"
          ariaLabel="Edit folder"
        >
          <EditPanel
            nameDraft={folderNameDraft}
            lockDraft={folderLockDraft}
            onNameChange={setFolderNameDraft}
            onLockChange={setFolderLockDraft}
            onSave={() => {
              if (!editingFolderId) return;
              renameFolderMutation.mutate({
                folderId: editingFolderId,
                foldername: folderNameDraft.trim(),
                lock: folderLockDraft,
              });
            }}
            onCancel={() => { setEditingFolderId(null); setFolderNameDraft(""); setFolderLockDraft(false); }}
            onRequestDelete={() => {
              const f = orderedFolders.find((x) => x.id === editingFolderId);
              if (f) setDeleteConfirm({ id: f.id, name: f.foldername });
            }}
            renamePending={renameFolderMutation.isPending}
            deletePending={deleteFolderMutation.isPending}
          />
        </FadeOverlay>
      )}

      {/* ── Locked book modal ── */}
      <FadeOverlay open={!!lockedModal} onClose={() => setLockedModal(null)}>
        <div
          style={{
            background: C.paper, border: `1px solid ${C.border}`,
            borderRadius: 6, padding: "28px 32px", maxWidth: 360,
            boxShadow: "0 20px 60px rgba(0,0,0,0.20)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 14 }}>🔒</div>
          <h3 style={{ fontFamily: fontSerif, fontSize: 18, color: C.navy, marginBottom: 10 }}>
            Restricted Manual
          </h3>
          <p style={{ fontFamily: fontBody, fontSize: 13, color: C.muted, marginBottom: 16, lineHeight: 1.55 }}>
            This manual is restricted.
            <br />
            Contact{" "}
            <a href="mailto:kisong3007@kecbd.com" style={{ color: C.gold }}>
              kisong3007@kecbd.com
            </a>{" "}
            to request access.
          </p>
          <button
            type="button"
            onClick={() => setLockedModal(null)}
            style={{
              fontFamily: fontBody, fontSize: 13, color: C.navy,
              background: "transparent", border: `1px solid ${C.navy}`,
              borderRadius: 4, padding: "7px 20px", cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </FadeOverlay>

      {/* ── Confirm delete folder ── */}
      <FadeOverlay open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} ariaLabel="Delete folder?">
        <div
          style={{
            background: C.paper, border: `1px solid ${C.border}`,
            borderRadius: 6, padding: "26px 28px", maxWidth: 400, width: "100%",
            boxShadow: "0 20px 60px rgba(0,0,0,0.20)",
          }}
        >
          <h3 style={{
            fontFamily: fontSerif, fontSize: 18, color: C.navy, marginBottom: 12,
          }}>
            Delete folder?
          </h3>
          <p style={{ fontFamily: fontBody, fontSize: 14, color: C.muted, lineHeight: 1.55, marginBottom: 20 }}>
            This will permanently delete <strong style={{ color: C.navy }}>{deleteConfirm?.name}</strong>
            {" "}and remove its volumes from the library. This cannot be undone.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setDeleteConfirm(null)}
              style={{
                fontFamily: fontBody, fontSize: 13, color: C.navy,
                background: "white", border: `1px solid ${C.border}`,
                borderRadius: 4, padding: "8px 16px", cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleteFolderMutation.isPending}
              onClick={() => {
                if (!deleteConfirm) return;
                deleteFolderMutation.mutate(deleteConfirm.id, {
                  onSettled: () => setDeleteConfirm(null),
                });
              }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                fontFamily: fontBody, fontSize: 13, color: "white",
                background: "#c0392b", border: "none",
                borderRadius: 4, padding: "8px 16px", cursor: "pointer",
                opacity: deleteFolderMutation.isPending ? 0.7 : 1,
              }}
            >
              {deleteFolderMutation.isPending && (
                <span
                  aria-hidden
                  style={{
                    width: 13, height: 13, borderRadius: "50%",
                    border: "2px solid rgba(255,255,255,0.35)", borderTopColor: "#fff",
                    animation: "folderSpinnerSpin 700ms linear infinite",
                  }}
                />
              )}
              {deleteFolderMutation.isPending ? "Deleting…" : "Delete folder"}
            </button>
          </div>
        </div>
      </FadeOverlay>

      <DocumentChatWidget />
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Shelf — one row of books + wooden board
═══════════════════════════════════════════════════════════════ */
type ShelfProps = {
  folders: Folder[];
  shelfIndex: number;
  globalStartIndex: number;
  /** When non-empty, spines that do not match folder name or any file name are dimmed (see folder interior). */
  fileNameFilter: string;
  admin: boolean;
  draggedFolderId: string | null;
  dragOverFolderId: string | null;
  onOpenLocked: (id: string) => void;
  onEditToggle: (id: string) => void;
  onDragStart: (id: string, event: DragEvent<HTMLElement>, el: HTMLElement) => void;
  onDrag: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (id: string, event: DragEvent<HTMLElement>) => void;
  onDragLeave: (id: string, event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>, id: string) => void;
};

function Shelf({
  folders, shelfIndex, globalStartIndex, fileNameFilter, admin,
  draggedFolderId, dragOverFolderId,
  onOpenLocked, onEditToggle,
  onDragStart, onDrag, onDragEnd, onDragOver, onDragLeave, onDrop,
}: ShelfProps) {
  const router = useRouter();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pullingId, setPullingId] = useState<string | null>(null); // "pull off shelf" exit anim

  const handleBookClick = (folder: Folder) => {
    if (folder.lock && !admin) { onOpenLocked(folder.id); return; }
    setPullingId(folder.id);
    setTimeout(() => {
      router.push(`/folders/${folder.id}`);
    }, FOLDER_OPEN_MS);
  };

  return (
    <div style={{ marginBottom: 40 }}>
      {/* Wall behind books — subtle warm tone */}
      <div style={{
        background: C.bg,
        borderRadius: "6px 6px 0 0",
        padding: "24px 24px 0",
        display: "flex", alignItems: "flex-end", gap: 12,
        flexWrap: "wrap",
        minHeight: 520,
        position: "relative",
        /* vertical woodgrain */
        backgroundImage:
          "repeating-linear-gradient(90deg, transparent, transparent 48px, rgba(0,0,0,0.018) 48px, rgba(0,0,0,0.018) 49px)",
      }}>
        {folders.map((folder, idx) => {
          const absIdx = globalStartIndex + idx;
          const isLocked = !!folder.lock && !admin;
          const isHovered = hoveredId === folder.id && !pullingId;
          const isPulling = pullingId === folder.id;
          const isDragged = draggedFolderId === folder.id;
          const isDragOver = dragOverFolderId === folder.id;

          const fileFilterMatches = folderMatchesFileNameFilter(folder, fileNameFilter);

          const bookEl = (
            <BookSpine
              folder={folder}
              folderSealed={!!folder.lock}
              isLocked={isLocked}
              isHovered={isHovered}
              isPulling={isPulling}
              isDragged={isDragged}
              isDragOver={isDragOver}
              fileFilterMatches={fileFilterMatches}
              admin={admin}
              onHoverIn={() => setHoveredId(folder.id)}
              onHoverOut={() => setHoveredId(null)}
              onClick={() => handleBookClick(folder)}
              onEditToggle={() => onEditToggle(folder.id)}
            />
          );

          if (admin) {
            return (
              <div
                key={folder.id}
                draggable
                title="Drag to reorder"
                onDragStart={e => onDragStart(folder.id, e as unknown as DragEvent<HTMLElement>, e.currentTarget)}
                onDrag={e => onDrag(e as unknown as DragEvent<HTMLElement>)}
                onDragEnd={onDragEnd}
                onDragOver={e => onDragOver(folder.id, e as unknown as DragEvent<HTMLElement>)}
                onDragLeave={e => onDragLeave(folder.id, e as unknown as DragEvent<HTMLElement>)}
                onDrop={e => onDrop(e as unknown as DragEvent<HTMLElement>, folder.id)}
                style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
              >
                {bookEl}
              </div>
            );
          }

          return (
            <div key={folder.id} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              {bookEl}
            </div>
          );
        })}
      </div>

      {/* Wooden shelf board */}
      <div style={{
        height: 36, borderRadius: "0 0 4px 4px",
        background: "linear-gradient(180deg,#c8a87a 0%,#a07848 40%,#8a6030 100%)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.25), inset 0 -2px 4px rgba(0,0,0,0.15)",
      }} />
    </div>
  );
}

const BOOK_SPINE_MIN_W = 152;
const BOOK_SPINE_H = 440;
const BOOK_SPINE_TITLE_PAD = 140;
const SPINE_BRAND_LABEL = "Expressway";

/* ═══════════════════════════════════════════════════════════════
   BookSpine — single book on the shelf
═══════════════════════════════════════════════════════════════ */
type BookSpineProps = {
  folder: Folder;
  /** Locked at folder level — sealed leather-style spine vs open paper reference */
  folderSealed: boolean;
  isLocked: boolean;
  isHovered: boolean;
  isPulling: boolean;
  isDragged: boolean;
  isDragOver: boolean;
  /** False when the dashboard search box is non-empty and this folder/name does not match. */
  fileFilterMatches: boolean;
  admin: boolean;
  onHoverIn: () => void;
  onHoverOut: () => void;
  onClick: () => void;
  onEditToggle: () => void;
};

function BookSpine({
  folder, folderSealed, isLocked,
  isHovered, isPulling, isDragged, isDragOver, fileFilterMatches,
  admin, onHoverIn, onHoverOut, onClick, onEditToggle,
}: BookSpineProps) {
  /* Detect touch device to replace hover→tap scale */
  const [isTouch, setIsTouch] = useState(false);
  const [spineWidth, setSpineWidth] = useState(BOOK_SPINE_MIN_W);
  const titleMeasureRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setIsTouch(window.matchMedia("(hover: none)").matches); }, []);

  const titleFontSize = folder.foldername.length > 20 ? 20 : 24;
  const titleMaxAlong = BOOK_SPINE_H - BOOK_SPINE_TITLE_PAD;

  useLayoutEffect(() => {
    const el = titleMeasureRef.current;
    if (!el) return;
    const needed = Math.ceil(el.offsetHeight) + 32;
    setSpineWidth(Math.max(BOOK_SPINE_MIN_W, needed));
  }, [folder.foldername, titleFontSize, titleMaxAlong]);

  const W = spineWidth;
  const H = BOOK_SPINE_H;

  const transform =
    isPulling ? "translateY(-96px) scale(1.16)" :
      isHovered ? (isTouch ? "scale(1.03)" : "translateZ(20px) translateY(-20px)") :
        isDragOver ? "translateY(-12px)" :
          "none";
  const shadow =
    isPulling
      ? "-6px 22px 46px rgba(0,0,0,0.30), 0 0 44px 8px rgba(201,124,42,0.28)"
      : isHovered
        ? "-4px 10px 24px rgba(0,0,0,0.32), inset -4px 0 8px rgba(0,0,0,0.18)"
        : "-2px 4px 10px rgba(0,0,0,0.18), inset -4px 0 8px rgba(0,0,0,0.12)";

  const openReferenceSpine = !folderSealed;

  return (
    /* perspective per book so translateZ works */
    <div
      style={{
        perspective: 500,
        marginBottom: 2,
        opacity: fileFilterMatches ? 1 : 0.22,
        transform: fileFilterMatches ? "none" : "scale(0.96)",
        transition: "opacity 250ms ease, transform 250ms ease",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          cursor: isLocked && !admin ? "not-allowed" : "pointer",
          opacity: isPulling ? 0 : isDragged ? 0.35 : 1,
          transition: isPulling
            ? "transform 420ms cubic-bezier(0.22,0.61,0.36,1), opacity 420ms ease 140ms, box-shadow 300ms ease"
            : "transform 150ms ease-out, box-shadow 150ms, opacity 200ms",
          transform,
        }}
        onMouseEnter={onHoverIn}
        onMouseLeave={onHoverOut}
        onClick={onClick}
      >
        {/* Warm glow suggesting the folder opening as the book lifts off the shelf */}
        {isPulling && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: "-40px -30px",
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(201,124,42,0.35) 0%, rgba(201,124,42,0) 70%)",
              opacity: 1,
              animation: "libraryOpenGlow 420ms ease-out forwards",
              pointerEvents: "none",
              zIndex: -1,
            }}
          />
        )}
        {/* Main spine face — cream base is always present; the sealed/locked color wipes in
            over it (and back out) top-to-bottom instead of snapping instantly on lock toggle. */}
        <div
          style={{
            width: W, height: H,
            background: `linear-gradient(160deg,#faf8f3 0%,#ebe3d6 42%,#e0d4c8 100%)`,
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "24px 0 20px",
            boxShadow: shadow,
            borderRadius: 2,
            overflow: "visible",
            transition: "box-shadow 150ms, width 200ms ease, border-color 480ms ease",
            border: `1px solid ${openReferenceSpine ? "rgba(26,39,68,0.12)" : "rgba(0,0,0,0.18)"}`,
          }}
        >
          {/* Sealed/locked color — always the fixed LOCKED_SPINE_COLOR (#5a6570), never a
              per-folder color, since that's the one true "this folder is locked" color. It
              drops down from the top when locking, and lifts away upward from the bottom
              (same color, reverse motion) when unlocking. */}
          <div
            aria-hidden
            style={{
              position: "absolute", inset: 0, borderRadius: 2,
              background: LOCKED_SPINE_COLOR,
              transformOrigin: "top",
              transform: `scaleY(${openReferenceSpine ? 0 : 1})`,
              transition: "transform 480ms ease",
            }}
          />
          {/* Top cap — constant subtle strip, independent of lock state so it never flashes a second color */}
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 16,
            background: "rgba(0,0,0,0.12)",
          }} />

          {/* Brand label — parchment stamp, navy serif (matches spine typography) */}
          <div
            style={{
              position: "absolute",
              top: 18,
              left: 8,
              right: 8,
              zIndex: 2,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "5px 8px 7px",
              background: openReferenceSpine
                ? "rgba(250,248,243,0.72)"
                : "rgba(250,248,243,0.94)",
              border: `1px solid ${C.border}`,
              borderRadius: 2,
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.55), 0 1px 2px rgba(26,39,68,0.06)",
              transition: "background-color 480ms ease",
            }}
          >
            <span
              style={{
                fontFamily: fontSerif,
                fontSize: 12,
                fontWeight: 700,
                fontStyle: "italic",
                fontVariant: "small-caps",
                letterSpacing: "0.16em",
                color: C.navy,
                lineHeight: 1.15,
                whiteSpace: "nowrap",
              }}
            >
              {SPINE_BRAND_LABEL}
            </span>
            <div
              aria-hidden
              style={{
                width: "70%",
                height: 1,
                marginTop: 5,
                background: openReferenceSpine
                  ? `linear-gradient(90deg, transparent, ${C.gold}, transparent)`
                  : `linear-gradient(90deg, transparent, rgba(201,124,42,0.65), transparent)`,
                opacity: 0.85,
              }}
            />
          </div>

          {/* Hidden measurer — wrap width = length along spine; height → dynamic spine width */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: -10000,
              top: 0,
              visibility: "hidden",
              pointerEvents: "none",
              width: titleMaxAlong,
            }}
          >
            <div
              ref={titleMeasureRef}
              style={{
                fontFamily: fontSerif,
                fontSize: titleFontSize,
                fontWeight: 600,
                letterSpacing: "0.03em",
                lineHeight: 1.25,
                whiteSpace: "normal",
                wordBreak: "break-word",
                textAlign: "center",
                padding: "0 8px",
              }}
            >
              {folder.foldername}
            </div>
          </div>

          {/* Title — horizontal letters, wrapped, rotated along the spine */}
          <div style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "visible",
            padding: "16px 8px",
            minHeight: 0,
          }}>
            <div
              style={{
                width: titleMaxAlong,
                display: "flex",
                justifyContent: "center",
                transform: "rotate(-90deg)",
                transformOrigin: "center center",
              }}
            >
              <span style={{
                fontFamily: fontSerif,
                fontSize: titleFontSize,
                fontWeight: 600,
                color: openReferenceSpine ? C.navy : "rgba(255,255,255,0.92)",
                letterSpacing: "0.03em",
                lineHeight: 1.25,
                whiteSpace: "normal",
                wordBreak: "break-word",
                textAlign: "center",
                transition: "color 480ms ease",
              }}>
                {folder.foldername}
              </span>
            </div>
          </div>

          {/* Lock / file count / open label */}
          <div style={{
            fontFamily: fontBody, fontSize: 18,
            color: openReferenceSpine ? C.muted : "rgba(255,255,255,0.65)",
            letterSpacing: "0.04em",
            textAlign: "center",
            paddingBottom: 4,
            transition: "color 480ms ease",
          }}>
            {folder.lock ? "🔒" : `${folder.files.length} file${folder.files.length === 1 ? "" : "s"}`}
          </div>
        </div>

        {/* Hover tooltip */}
        {isHovered && !isPulling && (
          <div style={{
            position: "absolute",
            bottom: "calc(100% + 10px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: C.paper,
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            padding: "8px 12px",
            whiteSpace: "nowrap",
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            zIndex: 50,
            animation: "tooltipRise 150ms ease-out forwards",
            pointerEvents: "none",
          }}>
            <p style={{ fontFamily: fontSerif, fontSize: 24, color: C.navy, fontWeight: 600, marginBottom: 6 }}>
              {folder.foldername}
            </p>
            <p style={{ fontFamily: fontBody, fontSize: 22, color: C.muted }}>
              {folder.lock && !admin
                ? "Access restricted · Contact admin"
                : `${folder.files.length} file${folder.files.length === 1 ? "" : "s"} · Click to open`}
            </p>
          </div>
        )}
      </div>

      {/* Admin edit button beneath book */}
      {admin && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onEditToggle(); }}
          title="Edit folder"
          style={{
            marginTop: 8, fontFamily: fontBody, fontSize: 20,
            color: C.muted, background: "none", border: "none",
            cursor: "pointer", padding: "2px 6px", borderRadius: 3,
            opacity: isHovered ? 1 : 0.4,
            transition: "opacity 150ms",
          }}
        >
          ✏️ edit
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   EditPanel — admin folder edit form (mounted in fullscreen overlay)
═══════════════════════════════════════════════════════════════ */
function EditPanel({
  nameDraft, lockDraft,
  onNameChange, onLockChange, onSave, onCancel, onRequestDelete,
  renamePending, deletePending,
}: {
  nameDraft: string; lockDraft: boolean;
  onNameChange: (v: string) => void; onLockChange: (v: boolean) => void;
  onSave: () => void; onCancel: () => void; onRequestDelete: () => void;
  renamePending: boolean; deletePending: boolean;
}) {
  return (
    <div style={{
      padding: "14px",
      background: C.paper, border: `1px solid ${C.border}`,
      borderRadius: 8, width: 260,
      boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
    }}>
      <input
        value={nameDraft}
        onChange={e => onNameChange(e.target.value)}
        placeholder="Rename folder"
        style={{
          width: "100%", boxSizing: "border-box",
          padding: "6px 8px", fontFamily: fontBody, fontSize: 12,
          border: `1px solid ${C.border}`, borderRadius: 3,
          color: C.navy, background: "white", outline: "none", marginBottom: 8,
        }}
      />
      <label style={{
        display: "flex", gap: 6, alignItems: "center", marginBottom: 10,
        fontFamily: fontBody, fontSize: 12, color: C.navy, cursor: "pointer"
      }}>
        <input type="checkbox" checked={lockDraft} onChange={e => onLockChange(e.target.checked)}
          style={{ accentColor: C.navy }} />
        Lock folder
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={onSave}
            disabled={!nameDraft.trim() || renamePending}
            style={{
              flex: 1, padding: "5px 0",
              fontFamily: fontBody, fontSize: 11, color: "white",
              background: C.navy, border: "none", borderRadius: 3, cursor: "pointer",
              opacity: !nameDraft.trim() ? 0.5 : 1,
            }}>
            {renamePending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onCancel}
            style={{
              flex: 1, padding: "5px 0",
              fontFamily: fontBody, fontSize: 11, color: C.navy,
              background: "transparent", border: `1px solid ${C.border}`, borderRadius: 3, cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
        <button type="button" onClick={onRequestDelete} disabled={deletePending}
          style={{
            width: "100%", padding: "5px 0",
            fontFamily: fontBody, fontSize: 11, color: "white",
            background: "#c0392b", border: "none", borderRadius: 3, cursor: "pointer",
          }}>
          {deletePending ? "…" : "Delete folder"}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   GlobalSearchItem — unchanged logic, restyled
═══════════════════════════════════════════════════════════════ */
function GlobalSearchItem({ item, keyword, returnTo }: { item: GlobalFindItem; keyword: string; returnTo: string }) {
  const [pageChunk, setPageChunk] = useState(0);
  const pageEntries = useMemo(() =>
    Array.from(new Map(
      (item.content ?? []).map(entry => [
        Math.max(1, entry.page + 1),
        { page: Math.max(1, entry.page + 1), snippet: extractSentencePreview(entry.content, keyword) },
      ])
    ).values()).sort((a, b) => a.page - b.page),
    [item.content, keyword]
  );
  const totalChunks = Math.max(1, Math.ceil(pageEntries.length / PAGE_CHUNK_SIZE));
  const pageStart = pageChunk * PAGE_CHUNK_SIZE;
  const pagedEntries = pageEntries.slice(pageStart, pageStart + PAGE_CHUNK_SIZE);

  return (
    <li style={{
      background: "white", border: `1px solid ${C.border}`,
      borderRadius: 4, padding: "12px 14px",
      fontFamily: fontBody,
    }}>
      <Link href={`/files/${item.id}`}
        style={{ fontFamily: fontSerif, fontSize: 15, fontWeight: 600, color: C.navy, textDecoration: "none" }}>
        {item.filename.replace(/\.pdf$/i, "")}
      </Link>
      {pagedEntries.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {pagedEntries.map(entry => (
            <Link key={`${item.id}-${entry.page}`}
              href={`/files/${item.id}?page=${entry.page}&keyword=${encodeURIComponent(keyword)}&returnTo=${returnTo}`}
              style={{
                display: "block",
                border: `1px solid ${C.border}`, borderRadius: 3,
                padding: "8px 12px", textDecoration: "none",
                background: C.paper, transition: "border-color 150ms, box-shadow 150ms",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = C.gold;
                (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 2px 8px rgba(201,124,42,0.10)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = C.border;
                (e.currentTarget as HTMLAnchorElement).style.boxShadow = "none";
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontFamily: fontSerif, fontSize: 14, fontWeight: 700, color: C.navy }}>
                  Page {entry.page}
                </span>
                <span style={{ fontFamily: fontBody, fontSize: 11, color: C.muted }}>Open →</span>
              </div>
              <p style={{
                fontFamily: fontBody, fontSize: 12, color: "#444", lineHeight: 1.55,
                whiteSpace: "pre-wrap", wordBreak: "break-word"
              }}>
                {highlightKeyword(entry.snippet, keyword)}
              </p>
            </Link>
          ))}
          {pageEntries.length > PAGE_CHUNK_SIZE && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: fontBody, fontSize: 12 }}>
              <button onClick={() => setPageChunk(p => Math.max(0, p - 1))} disabled={pageChunk === 0}
                style={{
                  padding: "3px 10px", border: `1px solid ${C.border}`, borderRadius: 3, cursor: "pointer",
                  background: "white", color: C.navy, opacity: pageChunk === 0 ? 0.4 : 1
                }}>
                ‹ Prev
              </button>
              <span style={{ color: C.muted }}>{pageChunk + 1} / {totalChunks}</span>
              <button onClick={() => setPageChunk(p => Math.min(totalChunks - 1, p + 1))} disabled={pageChunk >= totalChunks - 1}
                style={{
                  padding: "3px 10px", border: `1px solid ${C.border}`, borderRadius: 3, cursor: "pointer",
                  background: "white", color: C.navy, opacity: pageChunk >= totalChunks - 1 ? 0.4 : 1
                }}>
                Next ›
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Pure utility functions (unchanged logic)
═══════════════════════════════════════════════════════════════ */
function sortFoldersByOrder(folders: Folder[]): Folder[] {
  return folders.sort((a, b) => {
    const ao = a.order ?? a.sortOrder ?? 0;
    const bo = b.order ?? b.sortOrder ?? 0;
    return ao !== bo ? ao - bo : a.foldername.localeCompare(b.foldername, "en", { sensitivity: "base" });
  });
}

function trySwapFolderList(folders: Folder[], draggedId: string, targetId: string): Folder[] | null {
  const i = folders.findIndex(f => f.id === draggedId);
  const j = folders.findIndex(f => f.id === targetId);
  if (i < 0 || j < 0 || i === j) return null;
  const next = [...folders];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

function beginFolderCardDragPreview(
  event: DragEvent<HTMLElement>,
  cardEl: HTMLElement,
  ghostRef: MutableRefObject<HTMLDivElement | null>,
  pointerOffsetRef: MutableRefObject<{ x: number; y: number }>,
) {
  ghostRef.current?.remove(); ghostRef.current = null;
  const rect = cardEl.getBoundingClientRect();
  pointerOffsetRef.current = {
    x: Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
    y: Math.max(0, Math.min(event.clientY - rect.top, rect.height)),
  };
  const canvas = document.createElement("canvas");
  canvas.width = 1; canvas.height = 1;
  event.dataTransfer.setDragImage(canvas, 0, 0);

  const ghost = cardEl.cloneNode(true) as HTMLDivElement;
  ghost.removeAttribute("id");
  ghost.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
  Object.assign(ghost.style, {
    position: "fixed", boxSizing: "border-box", margin: "0",
    left: `${event.clientX - pointerOffsetRef.current.x}px`,
    top: `${event.clientY - pointerOffsetRef.current.y}px`,
    width: `${rect.width}px`, pointerEvents: "none",
    zIndex: "2147483647", opacity: "1",
  });
  ghost.style.setProperty("box-shadow", "0 28px 55px rgba(15,23,42,0.28),0 0 0 1px rgba(15,23,42,0.08)");
  document.body.appendChild(ghost);
  ghostRef.current = ghost;
}

function highlightKeyword(text: string, keyword: string): ReactNode {
  const trimmed = keyword.trim();
  if (!trimmed) return text;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const segments = text.split(regex);
  return segments.map((seg, i) =>
    seg.toLowerCase() === trimmed.toLowerCase()
      ? <mark key={i} style={{ background: "rgba(201,124,42,0.25)", borderRadius: 2, padding: "0 1px" }}>{seg}</mark>
      : <Fragment key={i}>{seg}</Fragment>
  );
}

function extractSentencePreview(content: string, keyword: string): string {
  const normalized = normalizePreviewText(content);
  if (!normalized) return "...";
  const lowerKw = keyword.trim().toLowerCase();
  const max = 220, radius = 110;
  if (!lowerKw) return normalized.length > max ? normalized.slice(0, max) + "..." : normalized;
  const idx = normalized.toLowerCase().indexOf(lowerKw);
  if (idx < 0) return normalized.length > max ? normalized.slice(0, max) + "..." : normalized;
  const start = Math.max(0, idx - radius);
  const end = Math.min(normalized.length, idx + lowerKw.length + radius);
  return `${start > 0 ? "..." : ""}${normalized.slice(start, end)}${end < normalized.length ? "..." : ""}`;
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

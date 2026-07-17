"use client";

/**
 * 3D bookshelf components for the folder interior page.
 *
 * PDF thumbnails are rendered lazily via IntersectionObserver:
 *   1. Book enters viewport → fetch presigned URL → render first page with PDF.js
 *   2. Thumbnail is cached in sessionStorage keyed by file.id
 *   3. Placeholder cover (spine color + title text) shown while loading / on error
 */

import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { pdfjs } from "react-pdf";
import { getPdfViewerPresignedUrl } from "@/lib/api";
import type { FolderFile } from "@/lib/types";

// Same worker CDN already used in pdf-viewer.tsx
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  navy: "#1a2744",
  gold: "#c97c2a",
  paper: "#faf8f3",
  border: "#d0c4aa",
  muted: "#8a7a60",
  textMid: "#6a5a40",
  dark: "#3a3020",
};

const SPINE_COLORS = [
  "#1a2744", // navy
  "#2d4a3e", // forest
  "#4a2c2a", // burgundy
  "#3a2c1a", // dark umber
  "#1e3a5f", // deep blue
  "#2e3a28", // dark moss
];

const fontSerif = "'Source Serif 4', Georgia, serif";
const fontDisplay = "'Playfair Display', 'Times New Roman', serif";

const BOOKS_PER_SHELF = 5;
/** Pick-up + open exit animation before navigating into the PDF viewer (see Book3D `bookTransform`). */
const FILE_OPEN_MS = 380;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSpineColor(filename: string): string {
  let h = 0;
  for (let i = 0; i < filename.length; i++) {
    h = ((h << 5) - h) + filename.charCodeAt(i);
    h |= 0;
  }
  return SPINE_COLORS[Math.abs(h) % SPINE_COLORS.length];
}

function getVerticalJitter(filename: string): number {
  return (filename.charCodeAt(0) % 7) - 3; // –3 … +3 px, stable per filename
}

const BOOK_HEIGHT = 230;
const BOOK_COVER_WIDTH = 168;
const BOOK_SPINE_WIDTH = 26;

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch {
    return "";
  }
}

async function renderPdfThumbnail(pdfUrl: string, fileId: string): Promise<string> {
  const CACHE_KEY = `pdf-thumb-${fileId}`;
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) return cached;
  } catch { /* sessionStorage unavailable */ }

  const task = pdfjs.getDocument({ url: pdfUrl });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);

  const viewport = page.getViewport({ scale: 1 });
  const scale = 200 / viewport.width;
  const scaledViewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");

  await page.render({ canvas, canvasContext: ctx, viewport: scaledViewport }).promise;
  await pdf.destroy();

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  try { sessionStorage.setItem(CACHE_KEY, dataUrl); } catch { /* quota */ }
  return dataUrl;
}

// ─── Book3D ────────────────────────────────────────────────────────────────────

type ThumbState = { phase: "idle" | "loading" | "ready" | "error"; dataUrl?: string };

function Book3D({
  file,
  isAdmin,
  folderLocked,
  searchQuery,
  onDelete,
  adjacentShift = 0,
  allowReorder = false,
  isReorderDragged = false,
  isReorderDropTarget = false,
  onReorderDragStart,
  onReorderDragEnd,
  onReorderDragOver,
  onReorderDragLeave,
  onReorderDrop,
  isNewlyUploaded = false,
  onThumbSettled,
  ragUploaded,
  ragStatusLoading = false,
  onUploadToRag,
  ragUploadPending = false,
}: {
  file: FolderFile;
  isAdmin: boolean;
  folderLocked: boolean;
  searchQuery: string;
  onDelete: (file: FolderFile) => void;
  adjacentShift?: number;
  allowReorder?: boolean;
  isReorderDragged?: boolean;
  isReorderDropTarget?: boolean;
  onReorderDragStart?: (e: DragEvent<HTMLDivElement>) => void;
  onReorderDragEnd?: (e: DragEvent<HTMLDivElement>) => void;
  onReorderDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onReorderDragLeave?: (e: DragEvent<HTMLDivElement>) => void;
  onReorderDrop?: (e: DragEvent<HTMLDivElement>) => void;
  /** Just uploaded this session: skip lazy-load gating and show an "arriving" highlight until the thumbnail settles. */
  isNewlyUploaded?: boolean;
  /** Fired once when the thumbnail finishes loading (ready or error) — lets the caller end its upload animation. */
  onThumbSettled?: (fileId: string) => void;
  /** Undefined while rag status hasn't been fetched (e.g. non-admin viewer). */
  ragUploaded?: boolean;
  ragStatusLoading?: boolean;
  onUploadToRag?: (file: FolderFile) => void;
  ragUploadPending?: boolean;
}) {
  const router = useRouter();
  const bookRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settledNotifiedRef = useRef(false);

  const [thumb, setThumb] = useState<ThumbState>({ phase: "idle" });
  const [hovered, setHovered] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [departing, setDeparting] = useState(false);
  const [justArrived, setJustArrived] = useState(false);

  const spineColor = getSpineColor(file.filename);
  const jitter = getVerticalJitter(file.filename);
  const displayName = file.filename.replace(/\.pdf$/i, "");
  const openVolume = !folderLocked || isAdmin;
  const matches = !searchQuery.trim() ||
    file.filename.toLowerCase().includes(searchQuery.toLowerCase());

  const loadThumb = useCallback(async () => {
    if (thumb.phase !== "idle") return;
    setThumb({ phase: "loading" });
    try {
      const { url } = await getPdfViewerPresignedUrl(file.id);
      const dataUrl = await renderPdfThumbnail(url, file.id);
      setThumb({ phase: "ready", dataUrl });
    } catch {
      setThumb({ phase: "error" });
    }
  }, [file.id, thumb.phase]);

  // Lazy-load when book enters the viewport
  useEffect(() => {
    const el = bookRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadThumb();
          observer.disconnect();
        }
      },
      { rootMargin: "100px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadThumb]);

  // Newly uploaded volumes load their thumbnail immediately, even off-screen, so the
  // "uploading…" animation can resolve into an actual preview instead of stalling.
  useEffect(() => {
    if (isNewlyUploaded) void loadThumb();
  }, [isNewlyUploaded, loadThumb]);

  useEffect(() => {
    if (thumb.phase !== "ready" && thumb.phase !== "error") return;
    if (!settledNotifiedRef.current) {
      settledNotifiedRef.current = true;
      onThumbSettled?.(file.id);
    }
    if (isNewlyUploaded && thumb.phase === "ready") {
      setJustArrived(true);
      const t = setTimeout(() => setJustArrived(false), 900);
      return () => clearTimeout(t);
    }
  }, [thumb.phase, isNewlyUploaded, onThumbSettled, file.id]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleMouseEnter = () => {
    setHovered(true);
    timerRef.current = setTimeout(() => setShowTip(true), 400);
  };
  const handleMouseLeave = () => {
    setHovered(false);
    setShowTip(false);
    if (timerRef.current) clearTimeout(timerRef.current);
  };
  const handleClick = () => {
    if (departing) return;
    setDeparting(true);
    setTimeout(() => router.push(`/files/${file.id}`), FILE_OPEN_MS);
  };

  // ── Render ──
  const bookTransform = departing
    ? "translateY(-70px) scale(1.2)"
    : hovered
      ? "perspective(800px) rotateY(4deg) translateY(-12px) translateZ(16px)"
      : "perspective(800px) rotateY(8deg)";

  return (
    <div
      onDragOver={allowReorder ? onReorderDragOver : undefined}
      onDrop={allowReorder ? onReorderDrop : undefined}
      onDragLeave={allowReorder ? onReorderDragLeave : undefined}
      style={{
        position: "relative",
        opacity: matches ? 1 : 0.2,
        transform: `translateY(${jitter}px)${adjacentShift ? ` translateX(${adjacentShift}px)` : ""}${!matches ? " scale(0.95)" : ""}`,
        transition: "opacity 250ms ease, transform 250ms ease",
        outline: isReorderDropTarget ? `2px dashed ${C.gold}` : "none",
        outlineOffset: isReorderDropTarget ? 6 : 0,
        borderRadius: isReorderDropTarget ? 8 : undefined,
      }}
    >
      {/* ── Tooltip ── */}
      {showTip && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            bottom: "calc(100% + 12px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 100,
            background: C.paper,
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
            padding: "8px 12px",
            minWidth: 160,
            maxWidth: 220,
            pointerEvents: "none",
            animation: "bookTipIn 150ms ease forwards",
          }}
        >
          <p style={{
            fontFamily: fontSerif, fontSize: 13, color: C.navy,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            marginBottom: 3,
          }}>
            {displayName}
          </p>
          <p style={{ fontFamily: fontSerif, fontSize: 11, color: C.muted }}>
            {formatDate(file.createdAt) ? `Added: ${formatDate(file.createdAt)}  ·  ` : ""}
            Click to read
          </p>
        </div>
      )}

      {/* Warm glow suggesting the book opening as it lifts off the shelf */}
      {departing && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: "-50px -40px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(201,124,42,0.38) 0%, rgba(201,124,42,0) 70%)",
            animation: "libraryOpenGlow 380ms ease-out forwards",
            pointerEvents: "none",
            zIndex: -1,
          }}
        />
      )}

      {/* Breathing gold ring while a just-uploaded volume's thumbnail is still loading */}
      {isNewlyUploaded && (thumb.phase === "idle" || thumb.phase === "loading") && (
        <div
          aria-hidden
          style={{
            position: "absolute", inset: "-14px",
            borderRadius: 14,
            boxShadow: `0 0 0 2px ${C.gold}`,
            opacity: 0.65,
            animation: "newVolumePulse 1.3s ease-in-out infinite",
            pointerEvents: "none",
            zIndex: -1,
          }}
        />
      )}
      {/* Satisfying "arrived" burst the moment the thumbnail resolves */}
      {justArrived && (
        <div
          aria-hidden
          style={{
            position: "absolute", inset: "-30px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(201,124,42,0.40) 0%, rgba(201,124,42,0) 70%)",
            animation: "libraryOpenGlow 700ms ease-out forwards",
            pointerEvents: "none",
            zIndex: -1,
          }}
        />
      )}

      {/* ── 3D Book ── */}
      <div
        ref={bookRef}
        draggable={allowReorder}
        onDragStart={allowReorder ? onReorderDragStart : undefined}
        onDragEnd={allowReorder ? onReorderDragEnd : undefined}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        role="button"
        tabIndex={0}
        aria-label={allowReorder ? `Open or drag to reorder: ${file.filename}` : `Open ${file.filename}`}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } }}
        title={allowReorder ? "Drag to reorder on the shelf, or click to open" : undefined}
        style={{
          display: "flex",
          flexDirection: "row",
          cursor: allowReorder ? (isReorderDragged ? "grabbing" : "grab") : "pointer",
          userSelect: "none",
          transformStyle: "preserve-3d",
          transform: bookTransform,
          filter: hovered
            ? "drop-shadow(6px 20px 28px rgba(0,0,0,0.32))"
            : "drop-shadow(4px 8px 16px rgba(0,0,0,0.22))",
          opacity: departing ? 0 : isReorderDragged ? 0.42 : 1,
          transition: departing
            ? `transform ${FILE_OPEN_MS}ms cubic-bezier(0.22,0.61,0.36,1), opacity ${FILE_OPEN_MS}ms ease 120ms`
            : "transform 300ms cubic-bezier(0.25,0.46,0.45,0.94), filter 300ms ease, opacity 200ms ease",
        }}
      >
        {/* ── Spine ── */}
        <div style={{
          width: BOOK_SPINE_WIDTH, height: BOOK_HEIGHT,
          borderRadius: "3px 0 0 3px",
          background: openVolume
            ? "linear-gradient(145deg,#f2ebe0 0%,#e4d9c8 50%,#d8ccb8 100%)"
            : spineColor,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          position: "relative", flexShrink: 0,
          boxShadow: openVolume
            ? "inset -2px 0 6px rgba(26,39,68,0.08)"
            : "inset -2px 0 6px rgba(0,0,0,0.2)",
          border: openVolume ? `1px solid rgba(26,39,68,0.12)` : "none",
          borderRight: "none",
        }}>
          <div style={{
            position: "absolute", top: 18, left: 3, right: 3,
            height: 2,
            background: openVolume ? "rgba(201,124,42,0.45)" : C.gold,
            borderRadius: 1,
          }} />
          <span style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            fontFamily: fontDisplay,
            fontSize: 9,
            color: openVolume ? C.navy : "rgba(255,255,255,0.7)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            overflow: "hidden",
            maxHeight: 175,
            textOverflow: "ellipsis",
            padding: "0 3px",
            opacity: openVolume ? 0.85 : 1,
          }}>
            {displayName}
          </span>
        </div>

        {/* ── Cover face ── */}
        <div style={{
          width: BOOK_COVER_WIDTH, height: BOOK_HEIGHT,
          borderRadius: "0 3px 3px 0",
          overflow: "hidden",
          position: "relative",
          background: openVolume
            ? "linear-gradient(165deg,#faf8f3 0%,#efe6d8 55%,#e5dccf 100%)"
            : spineColor,
          flexShrink: 0,
          border: openVolume ? `1px solid rgba(26,39,68,0.1)` : "none",
          borderLeft: "none",
        }}>
          {/* Thumbnail */}
          {thumb.phase === "ready" && thumb.dataUrl ? (
            <img
              src={thumb.dataUrl}
              alt={file.filename}
              style={{
                position: "absolute", inset: 0,
                width: "100%", height: "100%",
                objectFit: "cover", objectPosition: "top center",
                display: "block",
              }}
            />
          ) : (
            <div style={{
              position: "absolute", inset: 0,
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              padding: "12px 10px",
              background: openVolume
                ? `repeating-linear-gradient(0deg,transparent,transparent 11px,rgba(180,160,120,0.07) 11px,rgba(180,160,120,0.07) 12px),
                   linear-gradient(165deg,#faf8f3 0%,#efe6d8 100%)`
                : spineColor,
              boxShadow: openVolume ? "inset 0 0 0 1px rgba(201,124,42,0.25)" : "none",
            }}>
              <div style={{
                width: 28, height: 1.5,
                background: openVolume ? C.gold : C.gold,
                marginBottom: 10, borderRadius: 1,
                opacity: openVolume ? 0.75 : 1,
              }} />
              <p style={{
                fontFamily: fontDisplay, fontSize: 12,
                color: openVolume ? C.dark : "rgba(255,255,255,0.82)",
                textAlign: "center", lineHeight: 1.45,
                letterSpacing: "0.04em", wordBreak: "break-word",
              }}>
                {displayName}
              </p>
            </div>
          )}

          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            padding: "28px 12px 10px",
            background: openVolume
              ? "linear-gradient(0deg, rgba(244,241,236,0.97) 0%, transparent 100%)"
              : "linear-gradient(0deg, rgba(10,18,40,0.88) 0%, transparent 100%)",
            pointerEvents: "none",
          }}>
            <p style={{
              fontFamily: fontSerif, fontSize: 11,
              color: openVolume ? C.dark : "rgba(255,255,255,0.85)",
              letterSpacing: "0.04em", lineHeight: 1.45,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              wordBreak: "break-word",
            }}>
              {displayName}
            </p>
          </div>

          {/* Stacked pages on right edge */}
          <div style={{
            position: "absolute", top: 0, right: 0, bottom: 0, width: 4,
            background: openVolume
              ? "repeating-linear-gradient(0deg,#f0e8da,#f0e8da 2px,#e2d6c4 2px,#e2d6c4 3px)"
              : "repeating-linear-gradient(0deg,#f0e8d8,#f0e8d8 2px,#e0d4c0 2px,#e0d4c0 3px)",
            pointerEvents: "none",
          }} />

          {/* Loading shimmer */}
          {thumb.phase === "loading" && (
            <div style={{
              position: "absolute", inset: 0, overflow: "hidden",
              pointerEvents: "none",
            }}>
              <div style={{
                position: "absolute", inset: 0,
                background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)",
                animation: "bookShimmer 1.5s infinite",
              }} />
            </div>
          )}

          {/* Admin RAG index status — indexed dot, or a click-to-add button when not indexed */}
          {isAdmin && !ragStatusLoading && ragUploaded === false && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onUploadToRag?.(file); }}
              disabled={ragUploadPending || !onUploadToRag}
              title="Not indexed for document search — click to add"
              style={{
                position: "absolute", top: 6, left: 6,
                fontFamily: fontSerif, fontSize: 9, whiteSpace: "nowrap",
                padding: "3px 6px", borderRadius: 3,
                border: `1px solid ${C.gold}`,
                background: ragUploadPending ? "rgba(201,124,42,0.14)" : "rgba(250,248,243,0.92)",
                color: C.gold, cursor: ragUploadPending ? "default" : "pointer",
                opacity: ragUploadPending ? 0.8 : hovered ? 1 : 0.85,
                zIndex: 10,
              }}
            >
              {ragUploadPending ? "Indexing…" : "Not indexed · Add"}
            </button>
          )}
          {isAdmin && !ragStatusLoading && ragUploaded === true && (
            <span
              aria-hidden
              title="Indexed for document search"
              style={{
                position: "absolute", top: 6, left: 6,
                width: 8, height: 8, borderRadius: "50%",
                background: "#16a34a",
                boxShadow: "0 0 0 2px rgba(250,248,243,0.9)",
                zIndex: 10,
              }}
            />
          )}

          {/* Admin delete × — allowed even when folder is locked */}
          {isAdmin && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(file); }}
              style={{
                position: "absolute", bottom: 6, right: 6,
                width: 20, height: 20,
                borderRadius: "50%",
                background: "rgba(0,0,0,0.4)",
                border: "none", color: "#fff",
                fontSize: 14, fontWeight: "bold",
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: hovered ? 1 : 0,
                transition: "opacity 150ms ease",
                lineHeight: 1, padding: 0,
                zIndex: 10,
              }}
              title="Delete file"
              aria-label={`Delete ${file.filename}`}
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ShelfRow ──────────────────────────────────────────────────────────────────

function ShelfRow({
  files,
  isAdmin,
  folderLocked,
  searchQuery,
  onDelete,
  allowReorder = false,
  draggingFileId,
  dragOverFileId,
  onBookDragStart,
  onBookDragEnd,
  onBookDragOver,
  onBookDragLeave,
  onBookDrop,
  newlyUploadedIds,
  onThumbSettled,
  ragUploadedIds,
  ragStatusLoading,
  onUploadToRag,
  ragUploadPendingId,
}: {
  files: FolderFile[];
  isAdmin: boolean;
  folderLocked: boolean;
  searchQuery: string;
  onDelete: (file: FolderFile) => void;
  allowReorder?: boolean;
  draggingFileId: string | null;
  dragOverFileId: string | null;
  onBookDragStart: (fileId: string, e: DragEvent<HTMLDivElement>) => void;
  onBookDragEnd: (e: DragEvent<HTMLDivElement>) => void;
  onBookDragOver: (fileId: string, e: DragEvent<HTMLDivElement>) => void;
  onBookDragLeave: (fileId: string, e: DragEvent<HTMLDivElement>) => void;
  onBookDrop: (fileId: string, e: DragEvent<HTMLDivElement>) => void;
  newlyUploadedIds?: Set<string>;
  onThumbSettled?: (fileId: string) => void;
  ragUploadedIds?: Set<string>;
  ragStatusLoading?: boolean;
  onUploadToRag?: (file: FolderFile) => void;
  ragUploadPendingId?: string | null;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div style={{ marginBottom: 48 }}>
      <div style={{
        display: "flex", flexDirection: "row",
        alignItems: "flex-end",
        gap: 20,
        paddingLeft: 12, paddingRight: 12, paddingBottom: 0,
      }}>
        {files.map((file, idx) => (
          <div
            key={file.id}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            <Book3D
              file={file}
              isAdmin={isAdmin}
              folderLocked={folderLocked}
              searchQuery={searchQuery}
              onDelete={onDelete}
              allowReorder={allowReorder}
              isReorderDragged={allowReorder && draggingFileId === file.id}
              isReorderDropTarget={allowReorder && dragOverFileId === file.id}
              onReorderDragStart={(e) => onBookDragStart(file.id, e)}
              onReorderDragEnd={onBookDragEnd}
              onReorderDragOver={(e) => onBookDragOver(file.id, e)}
              onReorderDragLeave={(e) => onBookDragLeave(file.id, e)}
              onReorderDrop={(e) => onBookDrop(file.id, e)}
              isNewlyUploaded={!!newlyUploadedIds?.has(file.id)}
              onThumbSettled={onThumbSettled}
              ragUploaded={ragUploadedIds?.has(file.id)}
              ragStatusLoading={ragStatusLoading}
              onUploadToRag={onUploadToRag}
              ragUploadPending={ragUploadPendingId === file.id}
              adjacentShift={
                hoveredIdx !== null
                  ? idx === hoveredIdx - 1 ? -6
                    : idx === hoveredIdx + 1 ? 6
                      : 0
                  : 0
              }
            />
          </div>
        ))}
      </div>
      {/* Wooden shelf board */}
      <div style={{
        height: 20,
        background: "linear-gradient(180deg, #c8a87a 0%, #a07848 40%, #8a6030 100%)",
        borderRadius: "0 0 6px 6px",
        boxShadow: "0 6px 18px rgba(0,0,0,0.28), inset 0 -3px 6px rgba(0,0,0,0.18), inset 0 2px 4px rgba(200,168,122,0.4)",
      }} />
    </div>
  );
}

// ─── EmptyShelf ────────────────────────────────────────────────────────────────

function EmptyShelf() {
  return (
    <div style={{ marginBottom: 48 }}>
      <div style={{
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        height: BOOK_HEIGHT, paddingBottom: 16,
      }}>
        <p style={{
          fontFamily: fontSerif, fontSize: 14,
          fontStyle: "italic", color: C.muted,
        }}>
          📖&ensp;No volumes yet. Drop a PDF above to add the first one.
        </p>
      </div>
      <div style={{
        height: 20,
        background: "linear-gradient(180deg, #c8a87a 0%, #a07848 40%, #8a6030 100%)",
        borderRadius: "0 0 6px 6px",
        boxShadow: "0 6px 18px rgba(0,0,0,0.28), inset 0 -3px 6px rgba(0,0,0,0.18), inset 0 2px 4px rgba(200,168,122,0.4)",
      }} />
    </div>
  );
}

// ─── SmallThumb ────────────────────────────────────────────────────────────────

function SmallThumb({
  file,
  folderLocked = true,
  isNewlyUploaded = false,
  onThumbSettled,
}: {
  file: FolderFile;
  folderLocked?: boolean;
  isNewlyUploaded?: boolean;
  onThumbSettled?: (fileId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<ThumbState>({ phase: "idle" });
  const settledNotifiedRef = useRef(false);

  const loadThumb = useCallback(async () => {
    if (thumb.phase !== "idle") return;
    setThumb({ phase: "loading" });
    try {
      const { url } = await getPdfViewerPresignedUrl(file.id);
      const dataUrl = await renderPdfThumbnail(url, file.id);
      setThumb({ phase: "ready", dataUrl });
    } catch {
      setThumb({ phase: "error" });
    }
  }, [file.id, thumb.phase]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) { void loadThumb(); observer.disconnect(); } },
      { rootMargin: "60px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadThumb]);

  useEffect(() => {
    if (isNewlyUploaded) void loadThumb();
  }, [isNewlyUploaded, loadThumb]);

  useEffect(() => {
    if (thumb.phase !== "ready" && thumb.phase !== "error") return;
    if (!settledNotifiedRef.current) {
      settledNotifiedRef.current = true;
      onThumbSettled?.(file.id);
    }
  }, [thumb.phase, onThumbSettled, file.id]);

  const spineColor = getSpineColor(file.filename);
  const openVolume = !folderLocked;

  return (
    <div
      ref={ref}
      style={{
        width: 32, height: 45,
        borderRadius: 2,
        overflow: "hidden",
        flexShrink: 0,
        background: openVolume
          ? "linear-gradient(145deg,#f2ebe0,#e4d9c8)"
          : spineColor,
        position: "relative",
        border: isNewlyUploaded && thumb.phase !== "ready"
          ? `1px solid ${C.gold}`
          : openVolume ? `1px solid rgba(26,39,68,0.12)` : "none",
        boxShadow: isNewlyUploaded && (thumb.phase === "idle" || thumb.phase === "loading")
          ? `0 0 0 2px rgba(201,124,42,0.35)`
          : "none",
        transition: "box-shadow 200ms ease, border-color 200ms ease",
      }}
    >
      {thumb.phase === "ready" && thumb.dataUrl ? (
        <img
          src={thumb.dataUrl}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block" }}
        />
      ) : (
        <div style={{
          width: "100%", height: "100%",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ width: 12, height: 1, background: C.gold, opacity: openVolume ? 0.65 : 1 }} />
        </div>
      )}
    </div>
  );
}

// ─── RagStatusControl ──────────────────────────────────────────────────────────
// Shows whether a file is indexed in the folder's Gemini FileSearchStore (used for
// document Q&A), with a one-click way to index it when it isn't yet.

function RagStatusControl({
  uploaded,
  loading,
  pending,
  onUpload,
}: {
  uploaded: boolean;
  loading?: boolean;
  pending?: boolean;
  onUpload?: (e: MouseEvent) => void;
}) {
  if (loading) {
    return (
      <span style={{ fontFamily: fontSerif, fontSize: 11, color: C.muted, flexShrink: 0 }}>
        Checking…
      </span>
    );
  }

  if (uploaded) {
    return (
      <span
        title="Indexed for document search"
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          fontFamily: fontSerif, fontSize: 11, color: "#15803d",
          flexShrink: 0, whiteSpace: "nowrap",
        }}
      >
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a" }} />
        Indexed
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onUpload}
      disabled={pending || !onUpload}
      title="Add this volume to the folder's search index so the chat assistant can find it"
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontFamily: fontSerif, fontSize: 11, whiteSpace: "nowrap",
        padding: "4px 8px", borderRadius: 3,
        border: `1px solid ${C.gold}`, background: pending ? "rgba(201,124,42,0.08)" : "transparent",
        color: C.gold, cursor: pending || !onUpload ? "default" : "pointer",
        opacity: pending ? 0.7 : 1, flexShrink: 0,
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", border: `1px solid ${C.gold}` }} />
      {pending ? "Indexing…" : "Not indexed · Add"}
    </button>
  );
}

function reorderFileList(list: FolderFile[], fromId: string, toId: string): FolderFile[] {
  const fromIdx = list.findIndex((f) => f.id === fromId);
  const toIdx = list.findIndex((f) => f.id === toId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return list;
  const next = [...list];
  const [removed] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, removed);
  return next;
}

// ─── ListView ──────────────────────────────────────────────────────────────────

export function ListView({
  files,
  searchQuery,
  isAdmin,
  folderLocked,
  onDelete,
  allowReorder = false,
  reorderSaving = false,
  onReorder,
  allowRename = false,
  onRename,
  renamePendingId = null,
  newlyUploadedIds,
  onThumbSettled,
  ragUploadedIds,
  ragStatusLoading = false,
  onUploadToRag,
  ragUploadPendingId = null,
}: {
  files: FolderFile[];
  searchQuery: string;
  isAdmin: boolean;
  folderLocked: boolean;
  onDelete: (file: FolderFile) => void;
  allowReorder?: boolean;
  reorderSaving?: boolean;
  onReorder?: (next: FolderFile[]) => void;
  allowRename?: boolean;
  onRename?: (fileId: string, filename: string) => void;
  renamePendingId?: string | null;
  newlyUploadedIds?: Set<string>;
  onThumbSettled?: (fileId: string) => void;
  /** File ids already indexed in the folder's search store. Omitted (not just empty) while status is unknown/not fetched. */
  ragUploadedIds?: Set<string>;
  ragStatusLoading?: boolean;
  onUploadToRag?: (file: FolderFile) => void;
  ragUploadPendingId?: string | null;
}) {
  const router = useRouter();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [draggingFileId, setDraggingFileId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);

  const openFile = (fileId: string) => {
    if (openingId) return;
    setOpeningId(fileId);
    setTimeout(() => router.push(`/files/${fileId}`), 260);
  };

  const filtered = files.filter(f =>
    !searchQuery.trim() || f.filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const commitRename = () => {
    if (!renamingId || !onRename) return;
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === files.find((f) => f.id === renamingId)?.filename) {
      setRenamingId(null);
      return;
    }
    onRename(renamingId, trimmed);
    setRenamingId(null);
  };

  const onRowDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!allowReorder || !onReorder) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const onRowDrop = (event: DragEvent<HTMLDivElement>, targetFile: FolderFile) => {
    if (!allowReorder || !onReorder) return;
    event.preventDefault();
    const fromId = event.dataTransfer.getData("text/plain") || draggingFileId;
    if (!fromId || fromId === targetFile.id) return;
    onReorder(reorderFileList(files, fromId, targetFile.id));
    setDraggingFileId(null);
  };

  if (filtered.length === 0) {
    return (
      <p style={{ fontFamily: fontSerif, fontSize: 14, fontStyle: "italic", color: C.muted, padding: "24px 0" }}>
        No volumes match your search.
      </p>
    );
  }

  return (
    <div>
      {allowReorder && (
        <p style={{ fontFamily: fontSerif, fontSize: 12, color: C.muted, marginBottom: 10, lineHeight: 1.45 }}>
          Drag the handle (☰) to reorder volumes. Order is saved for everyone.
          {reorderSaving ? " Saving…" : ""}
        </p>
      )}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden" }}>
        {filtered.map((file, idx) => (
          <div
            key={file.id}
            onMouseEnter={() => setHoveredId(file.id)}
            onMouseLeave={() => setHoveredId(null)}
            onDragOver={onRowDragOver}
            onDrop={(e) => onRowDrop(e, file)}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "12px 16px",
              borderBottom: idx < filtered.length - 1 ? `1px solid ${C.border}` : "none",
              background: openingId === file.id ? "rgba(201,124,42,0.10)" : hoveredId === file.id ? "rgba(201,124,42,0.04)" : "#fff",
              transform: openingId === file.id ? "scale(0.99)" : "scale(1)",
              transition: "background 150ms ease, transform 220ms ease, opacity 220ms ease",
              cursor: renamingId === file.id ? "default" : "pointer",
              opacity: draggingFileId === file.id ? 0.45 : openingId && openingId !== file.id ? 0.5 : 1,
            }}
            onClick={() => {
              if (renamingId === file.id) return;
              openFile(file.id);
            }}
          >
            {allowReorder && (
              <div
                draggable
                role="button"
                tabIndex={0}
                aria-label={`Drag to reorder ${file.filename}`}
                title="Drag to reorder"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") e.preventDefault();
                }}
                onDragStart={(e) => {
                  e.stopPropagation();
                  setDraggingFileId(file.id);
                  e.dataTransfer.setData("text/plain", file.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDraggingFileId(null)}
                style={{
                  cursor: "grab",
                  color: C.muted,
                  fontSize: 14,
                  userSelect: "none",
                  padding: "4px 2px",
                  flexShrink: 0,
                }}
              >
                ☰
              </div>
            )}
            <SmallThumb
              file={file}
              folderLocked={folderLocked && !isAdmin}
              isNewlyUploaded={!!newlyUploadedIds?.has(file.id)}
              onThumbSettled={onThumbSettled}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              {renamingId === file.id ? (
                <input
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  className="ui-input"
                  style={{
                    width: "100%",
                    fontFamily: fontSerif,
                    fontSize: 14,
                    padding: "6px 8px",
                    boxSizing: "border-box",
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename();
                    }
                    if (e.key === "Escape") {
                      setRenamingId(null);
                    }
                  }}
                />
              ) : (
                <p style={{
                  fontFamily: fontSerif, fontSize: 14, color: C.navy,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {file.filename.replace(/\.pdf$/i, "")}
                </p>
              )}
              <p style={{ fontFamily: fontSerif, fontSize: 11, color: C.muted, marginTop: 2 }}>
                {formatDate(file.createdAt)}
              </p>
            </div>
            {isAdmin && ragUploadedIds && (
              <RagStatusControl
                uploaded={ragUploadedIds.has(file.id)}
                loading={ragStatusLoading}
                pending={ragUploadPendingId === file.id}
                onUpload={onUploadToRag ? (e) => { e.stopPropagation(); onUploadToRag(file); } : undefined}
              />
            )}
            {isAdmin && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                {allowRename && onRename && renamingId === file.id ? (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        commitRename();
                      }}
                      disabled={renamePendingId === file.id}
                      style={{
                        fontFamily: fontSerif, fontSize: 11, padding: "4px 10px",
                        background: C.navy, color: "#fff", border: "none", borderRadius: 3, cursor: "pointer",
                        opacity: renamePendingId === file.id ? 0.6 : 1,
                      }}
                    >
                      {renamePendingId === file.id ? "…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(null);
                      }}
                      style={{
                        fontFamily: fontSerif, fontSize: 11, padding: "4px 10px",
                        background: "transparent", color: C.navy, border: `1px solid ${C.border}`, borderRadius: 3, cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    {allowRename && onRename && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(file.id);
                          setRenameDraft(file.filename);
                        }}
                        style={{
                          fontFamily: fontSerif, fontSize: 11, padding: "4px 8px",
                          background: hoveredId === file.id ? "rgba(0,0,0,0.06)" : "transparent",
                          border: `1px solid ${C.border}`, borderRadius: 3, color: C.navy, cursor: "pointer",
                          opacity: hoveredId === file.id ? 1 : 0,
                          transition: "opacity 150ms ease",
                        }}
                        title="Rename file"
                      >
                        Rename
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onDelete(file); }}
                      style={{
                        width: 24, height: 24, borderRadius: "50%",
                        background: hoveredId === file.id ? "rgba(0,0,0,0.08)" : "transparent",
                        border: "none", color: C.muted,
                        fontSize: 16, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "background 150ms ease",
                        opacity: hoveredId === file.id ? 1 : 0,
                      }}
                      title="Delete file"
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── BookshelfView (main export) ───────────────────────────────────────────────

export function BookshelfView({
  files,
  isAdmin,
  folderLocked,
  searchQuery,
  onDelete,
  allowReorder = false,
  reorderSaving = false,
  onReorder,
  newlyUploadedIds,
  onThumbSettled,
  ragUploadedIds,
  ragStatusLoading = false,
  onUploadToRag,
  ragUploadPendingId = null,
}: {
  files: FolderFile[];
  isAdmin: boolean;
  folderLocked: boolean;
  searchQuery: string;
  onDelete: (file: FolderFile) => void;
  allowReorder?: boolean;
  reorderSaving?: boolean;
  onReorder?: (next: FolderFile[]) => void;
  /** File ids uploaded this session whose thumbnail hasn't resolved yet — see Book3D. */
  newlyUploadedIds?: Set<string>;
  onThumbSettled?: (fileId: string) => void;
  /** File ids already indexed in the folder's search store. Omitted (not just empty) while status is unknown/not fetched. */
  ragUploadedIds?: Set<string>;
  ragStatusLoading?: boolean;
  onUploadToRag?: (file: FolderFile) => void;
  ragUploadPendingId?: string | null;
}) {
  const [draggingFileId, setDraggingFileId] = useState<string | null>(null);
  const [dragOverFileId, setDragOverFileId] = useState<string | null>(null);
  const dragSourceRef = useRef<string | null>(null);

  const reorderActive = allowReorder && !!onReorder;

  const onBookDragStart = useCallback((fileId: string, e: DragEvent<HTMLDivElement>) => {
    if (!reorderActive) return;
    dragSourceRef.current = fileId;
    setDraggingFileId(fileId);
    e.dataTransfer.setData("text/plain", fileId);
    e.dataTransfer.effectAllowed = "move";
  }, [reorderActive]);

  const onBookDragEnd = useCallback(() => {
    dragSourceRef.current = null;
    setDraggingFileId(null);
    setDragOverFileId(null);
  }, []);

  const onBookDragOver = useCallback((fileId: string, e: DragEvent<HTMLDivElement>) => {
    if (!reorderActive) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const from = dragSourceRef.current;
    if (from && from !== fileId) setDragOverFileId(fileId);
  }, [reorderActive]);

  const onBookDragLeave = useCallback((fileId: string, e: DragEvent<HTMLDivElement>) => {
    if (!reorderActive) return;
    const next = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(next)) {
      setDragOverFileId((prev) => (prev === fileId ? null : prev));
    }
  }, [reorderActive]);

  const onBookDrop = useCallback((fileId: string, e: DragEvent<HTMLDivElement>) => {
    if (!reorderActive || !onReorder) return;
    e.preventDefault();
    const fromId = e.dataTransfer.getData("text/plain") || dragSourceRef.current || draggingFileId;
    if (!fromId || fromId === fileId) {
      dragSourceRef.current = null;
      setDraggingFileId(null);
      setDragOverFileId(null);
      return;
    }
    dragSourceRef.current = null;
    onReorder(reorderFileList(files, fromId, fileId));
    setDraggingFileId(null);
    setDragOverFileId(null);
  }, [reorderActive, onReorder, files, draggingFileId]);

  const rows: FolderFile[][] = [];
  for (let i = 0; i < Math.max(files.length, 1); i += BOOKS_PER_SHELF) {
    rows.push(files.slice(i, i + BOOKS_PER_SHELF));
  }

  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Source+Serif+4:ital,wght@0,300;0,400;1,300&display=swap"
      />
      <div>
        {reorderActive && (
          <p style={{ fontFamily: fontSerif, fontSize: 12, color: C.muted, marginBottom: 14, lineHeight: 1.45 }}>
            Drag a volume to another spot on the shelf to reorder. Order is saved for everyone.
            {reorderSaving ? " Saving…" : ""}
          </p>
        )}
        {files.length === 0 ? (
          <EmptyShelf />
        ) : (
          rows.map((rowFiles, rowIdx) => (
            <ShelfRow
              key={rowIdx}
              files={rowFiles}
              isAdmin={isAdmin}
              folderLocked={folderLocked}
              searchQuery={searchQuery}
              onDelete={onDelete}
              allowReorder={reorderActive}
              draggingFileId={draggingFileId}
              dragOverFileId={dragOverFileId}
              newlyUploadedIds={newlyUploadedIds}
              onThumbSettled={onThumbSettled}
              ragUploadedIds={ragUploadedIds}
              ragStatusLoading={ragStatusLoading}
              onUploadToRag={onUploadToRag}
              ragUploadPendingId={ragUploadPendingId}
              onBookDragStart={onBookDragStart}
              onBookDragEnd={onBookDragEnd}
              onBookDragOver={onBookDragOver}
              onBookDragLeave={onBookDragLeave}
              onBookDrop={onBookDrop}
            />
          ))
        )}
      </div>
      <style>{`
        @keyframes bookTipIn {
          from { opacity: 0; transform: translateX(-50%) translateY(4px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0);   }
        }
        @keyframes bookShimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%);  }
        }
      `}</style>
    </>
  );
}

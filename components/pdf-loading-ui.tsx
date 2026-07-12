"use client";

/* ── Design tokens (matches folder-browser.tsx / pdf-viewer chrome) ── */
const fontSerif = "'Playfair Display', Georgia, serif";
const fontBody = "'Source Serif 4', Georgia, serif";
const C = {
  navy: "#1a2744",
  gold: "#c97c2a",
  paper: "#faf8f3",
  bg: "#f4f1ec",
  border: "#d0c4aa",
  muted: "#8a7a60",
  green: "#2d6a3a",
};

export function PdfViewerPageLoading(props: {
  fileMetadataLoaded: boolean;
  pdfBytesFetched: boolean;
  /** When known, drives the primary bar width and a numeric label (0–100). Null = indeterminate. */
  overallPercent: number | null;
  filename?: string;
}) {
  const { fileMetadataLoaded, pdfBytesFetched, overallPercent, filename } = props;

  const stillWorking = !fileMetadataLoaded || !pdfBytesFetched;
  const barIndeterminate = stillWorking && overallPercent === null;

  const detailLabel = !fileMetadataLoaded
    ? "Fetching file info…"
    : !pdfBytesFetched
      ? "Loading PDF through the app…"
      : " ";

  return (
    <section style={{ maxWidth: 420, margin: "0 auto", padding: "0 12px", fontFamily: fontBody }}>
      <div
        style={{
          borderRadius: 16,
          border: `1px solid ${C.border}`,
          background: `linear-gradient(180deg, #ffffff 0%, ${C.paper} 100%)`,
          padding: 28,
          boxShadow: "0 8px 28px rgba(26,39,68,0.08)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
          {/* Open-book badge with a gentle "page turn" animation */}
          <div
            aria-hidden
            style={{
              flexShrink: 0,
              width: 44,
              height: 44,
              borderRadius: 12,
              background: C.navy,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 0 0 3px rgba(201,124,42,0.16)`,
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 5.5c2.2-1 4.6-1 7 0v13c-2.4-1-4.8-1-7 0v-13Z" style={{ transformOrigin: "10px 12px", animation: "pdfLoadPageTurn 1.8s ease-in-out infinite" }} />
              <path d="M21 5.5c-2.2-1-4.6-1-7 0v13c2.4-1 4.8-1 7 0v-13Z" />
            </svg>
          </div>
          <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
            <p style={{ fontFamily: fontSerif, fontSize: 16, fontWeight: 700, color: C.navy }}>
              Opening your manual…
            </p>
            {filename ? (
              <p
                style={{
                  marginTop: 4, fontSize: 12, fontStyle: "italic", color: C.muted,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
                title={filename}
              >
                {filename}
              </p>
            ) : (
              <p style={{ marginTop: 4, fontSize: 12, color: C.muted }}>{detailLabel.trim() ? detailLabel : " "}</p>
            )}
          </div>
        </div>

        <dl style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
          <LoadingRow label="File details" ready={fileMetadataLoaded} />
          <LoadingRow label="PDF stream" ready={pdfBytesFetched} />
        </dl>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, fontSize: 11, color: C.muted }}>
          <span style={{ fontWeight: 600, color: C.navy, fontVariantNumeric: "tabular-nums" }}>
            {stillWorking ? (overallPercent !== null ? `${overallPercent}%` : "Loading…") : "100%"}
          </span>
        </div>
        <div
          role="progressbar"
          aria-busy={stillWorking}
          aria-label="Loading PDF viewer"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={overallPercent !== null ? overallPercent : stillWorking ? undefined : 100}
          aria-valuetext={overallPercent !== null ? `${overallPercent}%` : stillWorking ? "Loading progress unknown" : "100%"}
          style={{
            position: "relative", height: 8, width: "100%", overflow: "hidden", borderRadius: 999,
            background: "#ece3d3",
          }}
        >
          <div
            style={{
              height: "100%",
              borderRadius: 999,
              background: `linear-gradient(90deg, ${C.gold}, #dba15a)`,
              boxShadow: "0 1px 2px rgba(201,124,42,0.35)",
              transition: "width 150ms ease-out",
              width: barIndeterminate
                ? "38%"
                : overallPercent !== null
                  ? `${Math.min(100, Math.max(0, overallPercent))}%`
                  : stillWorking ? "0%" : "100%",
              animation: barIndeterminate ? "pdf-load-indeterminate-slide 1.25s ease-in-out infinite" : undefined,
            }}
          />
        </div>

        <p style={{ marginTop: 14, textAlign: "center", fontSize: 11, fontStyle: "italic", lineHeight: 1.6, color: C.muted }}>
          {stillWorking
            ? "The app loads storage on the server so the browser does not need direct access to S3."
            : " "}
        </p>

        <style jsx>{`
          @keyframes pdf-load-indeterminate-slide {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(350%); }
          }
          @keyframes pdfLoadPageTurn {
            0%, 100% { transform: rotateY(0deg); }
            50% { transform: rotateY(35deg); }
          }
        `}</style>
      </div>
    </section>
  );
}

function LoadingRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <dt style={{ fontWeight: 600, color: C.navy }}>{label}</dt>
      <dd style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {ready ? (
          <>
            <span
              style={{
                display: "inline-flex", width: 16, height: 16, borderRadius: "50%",
                alignItems: "center", justifyContent: "center",
                background: "rgba(45,106,58,0.14)", color: C.green, fontSize: 10, fontWeight: 700,
              }}
            >
              ✓
            </span>
            <span style={{ color: C.green }}>Ready</span>
          </>
        ) : (
          <>
            <span style={{ position: "relative", display: "flex", width: 8, height: 8 }}>
              <span
                style={{
                  position: "absolute", inset: 0, borderRadius: "50%",
                  background: C.gold, opacity: 0.55,
                  animation: "pdfLoadPing 1.4s cubic-bezier(0,0,0.2,1) infinite",
                }}
              />
              <span style={{ position: "relative", width: 8, height: 8, borderRadius: "50%", background: C.gold }} />
            </span>
            <span style={{ color: C.muted }}>Fetching…</span>
          </>
        )}
      </dd>
      <style jsx>{`
        @keyframes pdfLoadPing {
          75%, 100% { transform: scale(2.1); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) {
    return "0 B";
  }
  const u = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

/**
 * Single progress bar: network download (optional) then PDF.js parse, expressed as one 0–100 % when possible.
 */
export function PdfDocumentRenderLoading(props: {
  /** Bytes read from the HTTP response while building the Blob. */
  fetchLoaded?: number;
  fetchTotal?: number | null;
  /** PDF.js `onLoadProgress` while opening the document from the Blob. */
  parseLoaded?: number;
  parseTotal?: number;
  /** After `fetchTotal` is known, treat download as this share of 100% (rest reserved for parse). */
  fetchWeight?: number;
}) {
  const {
    fetchLoaded = 0,
    fetchTotal = null,
    parseLoaded = 0,
    parseTotal = 0,
    fetchWeight = 0.88,
  } = props;

  const w = Math.min(0.98, Math.max(0.5, fetchWeight));
  const parseWeight = 1 - w;

  const fetchHasTotal = typeof fetchTotal === "number" && fetchTotal > 0;
  const parseHasTotal = parseTotal > 0;

  let percent: number | null = null;
  let detail = "";

  if (fetchHasTotal) {
    const fetchPct = Math.min(1, fetchLoaded / fetchTotal) * w * 100;
    if (parseHasTotal) {
      percent = Math.min(100, Math.round(fetchPct + (parseLoaded / parseTotal) * parseWeight * 100));
      detail = "Downloading and opening the file…";
    } else {
      percent = Math.min(100, Math.round(fetchPct));
      detail = "Downloading…";
    }
  } else if (parseHasTotal) {
    percent = Math.min(100, Math.round((parseLoaded / parseTotal) * 100));
    detail = "Opening document…";
  } else if (fetchLoaded > 0) {
    detail = `Downloading… ${formatBytes(fetchLoaded)} (size unknown until complete)`;
  } else {
    detail = "Preparing…";
  }

  const barWidth = percent !== null ? Math.min(100, Math.max(0, percent)) : 8;

  return (
    <div
      style={{
        borderRadius: 12,
        border: `1px solid ${C.border}`,
        background: `linear-gradient(180deg, #ffffff 0%, ${C.paper} 100%)`,
        padding: 16,
        boxShadow: "0 4px 16px rgba(26,39,68,0.06)",
        fontFamily: fontBody,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span
          style={{
            width: 6, height: 6, borderRadius: "50%", background: C.gold,
            animation: "pdfDocLoadPulse 1.4s ease-in-out infinite",
          }}
        />
        <p style={{ fontFamily: fontSerif, fontSize: 13, fontWeight: 700, color: C.navy }}>Turning the page…</p>
      </div>
      <p style={{ marginBottom: 10, fontSize: 11, fontStyle: "italic", lineHeight: 1.6, color: C.muted }}>{detail}</p>
      <div style={{ marginBottom: 6, display: "flex", justifyContent: "flex-end", fontSize: 11, fontWeight: 600, color: C.muted, fontVariantNumeric: "tabular-nums" }}>
        <span aria-live="polite">{percent !== null ? `${percent}%` : formatBytes(fetchLoaded)}</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={percent !== null ? `${percent}%` : detail}
        aria-busy
        style={{ position: "relative", height: 6, width: "100%", overflow: "hidden", borderRadius: 999, background: "#ece3d3" }}
      >
        <div
          style={{
            height: "100%", borderRadius: 999,
            background: `linear-gradient(90deg, ${C.gold}, #dba15a)`,
            transition: "width 150ms ease-out",
            width: `${barWidth}%`,
          }}
        />
      </div>
      <style jsx>{`
        @keyframes pdfDocLoadPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
}

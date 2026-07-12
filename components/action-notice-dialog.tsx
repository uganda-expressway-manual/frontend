"use client";

import { useEffect } from "react";

const fontSerif = "'Playfair Display', Georgia, serif";
const fontBody = "'Source Serif 4', Georgia, serif";
const C = {
  navy: "#1a2744",
  gold: "#c97c2a",
  paper: "#faf8f3",
  border: "#d0c4aa",
  muted: "#8a7a60",
};

interface ActionNoticeDialogProps {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
}

/** Brief confirmation popup after a successful admin action. */
export function ActionNoticeDialog({ open, title, message, onClose }: ActionNoticeDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onClose}
        style={{
          position: "absolute", inset: 0, border: "none", cursor: "pointer",
          background: "rgba(26,39,68,0.42)", backdropFilter: "blur(2px)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-notice-title"
        style={{
          position: "relative", zIndex: 10, width: "100%", maxWidth: 400,
          borderRadius: 10, border: `1px solid ${C.border}`,
          background: C.paper, padding: 24,
          boxShadow: "0 16px 48px rgba(15,23,42,0.20)",
          fontFamily: fontBody,
        }}
      >
        <h2 id="action-notice-title" style={{ fontFamily: fontSerif, fontSize: 18, fontWeight: 700, color: C.navy }}>
          {title}
        </h2>
        <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.55, color: C.muted }}>{message}</p>
        <div style={{ marginTop: 22, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              borderRadius: 999, border: "none", background: C.navy,
              padding: "8px 20px", fontFamily: fontBody, fontSize: 13, fontWeight: 600, color: "#fff",
              cursor: "pointer", transition: "background 180ms",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = C.gold; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = C.navy; }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

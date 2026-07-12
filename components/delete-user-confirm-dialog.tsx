"use client";

import { useEffect } from "react";

const fontSerif = "'Playfair Display', Georgia, serif";
const fontBody = "'Source Serif 4', Georgia, serif";
const C = {
  navy: "#1a2744",
  paper: "#faf8f3",
  border: "#d0c4aa",
  muted: "#8a7a60",
  red: "#a53c2e",
};

interface DeleteUserConfirmDialogProps {
  open: boolean;
  /** Shown in the message body (email, @username, or id) */
  displayLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}

export function DeleteUserConfirmDialog({
  open,
  displayLabel,
  onCancel,
  onConfirm,
  pending,
}: DeleteUserConfirmDialogProps) {
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
      if (event.key === "Escape" && !pending) {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <button
        type="button"
        aria-label="Dismiss"
        disabled={pending}
        onClick={() => {
          if (!pending) {
            onCancel();
          }
        }}
        style={{
          position: "absolute", inset: 0, border: "none", cursor: pending ? "default" : "pointer",
          background: "rgba(26,39,68,0.42)", backdropFilter: "blur(2px)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-user-confirm-title"
        style={{
          position: "relative", zIndex: 10, width: "100%", maxWidth: 400,
          borderRadius: 10, border: `1px solid ${C.border}`,
          background: C.paper, padding: 24,
          boxShadow: "0 16px 48px rgba(15,23,42,0.20)",
          fontFamily: fontBody,
        }}
      >
        <h2 id="delete-user-confirm-title" style={{ fontFamily: fontSerif, fontSize: 18, fontWeight: 700, color: C.navy }}>
          Delete this user?
        </h2>
        <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.55, color: C.muted }}>
          This will permanently remove{" "}
          <span style={{ fontWeight: 600, color: C.navy }}>{displayLabel || "this account"}</span>. This cannot be undone.
        </p>
        <div style={{ marginTop: 22, display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 10 }}>
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            style={{
              borderRadius: 999, border: `1px solid ${C.border}`, background: "#fff",
              padding: "8px 18px", fontFamily: fontBody, fontSize: 13, fontWeight: 600, color: C.navy,
              cursor: pending ? "not-allowed" : "pointer", opacity: pending ? 0.6 : 1,
              transition: "background 150ms",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              borderRadius: 999, border: "none", background: C.red,
              padding: "8px 18px", fontFamily: fontBody, fontSize: 13, fontWeight: 700, color: "#fff",
              cursor: pending ? "not-allowed" : "pointer", opacity: pending ? 0.75 : 1,
              boxShadow: "0 2px 8px rgba(165,60,46,0.30)",
              transition: "opacity 150ms",
            }}
          >
            {pending && (
              <span
                aria-hidden
                style={{
                  width: 13, height: 13, borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.35)", borderTopColor: "#fff",
                  animation: "deleteUserSpin 700ms linear infinite",
                }}
              />
            )}
            {pending ? "Deleting…" : "Delete user"}
          </button>
        </div>
      </div>
      <style jsx>{`
        @keyframes deleteUserSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

const fontSerif = "'Playfair Display', Georgia, serif";
const fontBody = "'Source Serif 4', Georgia, serif";
const C = {
  navy: "#1a2744",
  gold: "#c97c2a",
  paper: "#faf8f3",
  border: "#d0c4aa",
  muted: "#8a7a60",
};

interface AdminActionLoadingOverlayProps {
  open: boolean;
  message: string;
}

/** Blocks the UI while an admin user-management mutation is in flight. */
export function AdminActionLoadingOverlay({ open, message }: AdminActionLoadingOverlayProps) {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    setEntered(false);
    const t = window.setTimeout(() => setMounted(false), 160);
    return () => window.clearTimeout(t);
  }, [open]);

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

  if (!mounted) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={message}
      style={{
        position: "fixed", inset: 0, zIndex: 110,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
        background: "rgba(26,39,68,0.45)",
        backdropFilter: "blur(3px)",
        opacity: entered ? 1 : 0,
        transition: "opacity 160ms ease",
      }}
    >
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
        width: "100%", maxWidth: 340,
        borderRadius: 14, border: `1px solid ${C.border}`,
        background: `linear-gradient(180deg, #ffffff 0%, ${C.paper} 100%)`,
        padding: "36px 30px",
        boxShadow: "0 20px 50px rgba(15,23,42,0.22)",
        transform: entered ? "scale(1)" : "scale(0.97)",
        transition: "transform 160ms ease",
      }}>
        <div
          aria-hidden
          style={{
            width: 42, height: 42, borderRadius: "50%",
            border: `3px solid ${C.border}`, borderTopColor: C.gold,
            animation: "adminOverlaySpin 750ms linear infinite",
          }}
        />
        <p style={{ fontFamily: fontSerif, fontSize: 16, fontWeight: 700, color: C.navy, textAlign: "center" }}>
          {message}
        </p>
        <p style={{ fontFamily: fontBody, fontSize: 12.5, fontStyle: "italic", color: C.muted, textAlign: "center" }}>
          Please wait…
        </p>
      </div>
      <style jsx>{`
        @keyframes adminOverlaySpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

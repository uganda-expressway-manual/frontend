"use client";

import { useEffect } from "react";

interface AdminActionLoadingOverlayProps {
  open: boolean;
  message: string;
}

/** Blocks the UI while an admin user-management mutation is in flight. */
export function AdminActionLoadingOverlay({ open, message }: AdminActionLoadingOverlayProps) {
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

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[3px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={message}
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-slate-200/90 bg-white px-8 py-10 shadow-[0_20px_50px_rgba(15,23,42,0.2)]">
        <div
          className="h-11 w-11 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-900"
          aria-hidden
        />
        <p className="text-center text-base font-medium text-slate-900">{message}</p>
        <p className="text-center text-sm text-slate-500">Please wait…</p>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/hooks/use-auth";
import { hasAuthSession } from "@/lib/auth-session";
import { isAdminUser } from "@/lib/auth-user";
import { IMME_TEAM_EMAILS } from "@/lib/imme/project";

const contactBtnClass =
  "inline-flex items-center justify-center rounded-full border border-imme-line bg-white px-3 py-1.5 text-xs font-semibold text-imme-navy transition hover:bg-imme-concrete sm:px-4 sm:text-[13px]";

const CONTACT_PANEL_FADE_MS = 200;

function ContactPopoverButton({ onNavigate }: { onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setPanelMounted(true);
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setPanelVisible(true));
      });
      return () => cancelAnimationFrame(raf);
    }
    setPanelVisible(false);
    const timer = window.setTimeout(() => setPanelMounted(false), CONTACT_PANEL_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        className={contactBtnClass}
        aria-expanded={open}
        aria-controls="site-header-contact-panel"
        id="site-header-contact-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        Contact
      </button>
      {panelMounted ? (
        <div
          id="site-header-contact-panel"
          role="region"
          aria-labelledby="site-header-contact-trigger"
          aria-hidden={!panelVisible}
          className={[
            "absolute right-0 top-full z-[60] mt-2 w-[min(calc(100vw-24px),18rem)] rounded-imme border border-imme-line bg-white px-3 py-3 text-left shadow-imme-card",
            "transition-opacity duration-200 ease-out",
            panelVisible ? "opacity-100" : "pointer-events-none opacity-0",
          ].join(" ")}
        >
          <p className="font-serif text-[12px] leading-relaxed text-imme-navy">
            <span className="font-semibold">{IMME_TEAM_EMAILS.developer.role}: </span>
            <a
              href={`mailto:${IMME_TEAM_EMAILS.developer.email}`}
              className="text-imme-navy underline decoration-imme-line underline-offset-2 hover:text-imme-navy-700"
              {...(onNavigate ? { onClick: onNavigate } : {})}
            >
              {IMME_TEAM_EMAILS.developer.email}
            </a>
          </p>
          <p className="mt-2 font-serif text-[12px] leading-relaxed text-imme-navy">
            <span className="font-semibold">{IMME_TEAM_EMAILS.projectManager.role}: </span>
            <a
              href={`mailto:${IMME_TEAM_EMAILS.projectManager.email}`}
              className="text-imme-navy underline decoration-imme-line underline-offset-2 hover:text-imme-navy-700"
              {...(onNavigate ? { onClick: onNavigate } : {})}
            >
              {IMME_TEAM_EMAILS.projectManager.email}
            </a>
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-imme-line bg-white/92 shadow-imme-card backdrop-blur-xl">
      <div className="imme-container-wide flex min-h-[60px] items-center justify-end py-2 sm:min-h-[68px]">
        <StaffAuthCluster className="flex items-center gap-2 sm:gap-2.5" />
      </div>
    </header>
  );
}

/**
 * Entry points to the staff workspace (PDF library, admin). Marketing pages intentionally omit
 * these from `IMME_NAV` — they live here so visitors can sign in while the public site stays
 * brochure-first.
 */
function StaffAuthCluster({
  className = "",
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const auth = useAuth();
  const loggedIn = hasAuthSession(auth);

  if (loggedIn) {
    return (
      <div className={["flex flex-wrap items-center gap-2", className].filter(Boolean).join(" ")}>
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="inline-flex items-center justify-center rounded-full border border-imme-line bg-white px-3 py-1.5 text-xs font-semibold text-imme-navy transition hover:bg-imme-concrete sm:px-4 sm:text-[13px]"
        >
          Folders
        </Link>
        {isAdminUser(auth.user) ? (
          <Link
            href="/users"
            onClick={onNavigate}
            className="inline-flex items-center justify-center rounded-full border border-imme-line bg-white px-3 py-1.5 text-xs font-semibold text-imme-ink transition hover:bg-imme-concrete sm:px-4 sm:text-[13px]"
          >
            Admin
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className={["flex flex-wrap items-center gap-2", className].filter(Boolean).join(" ")}>
      <ContactPopoverButton onNavigate={onNavigate} />
      <Link
        href="/login"
        onClick={onNavigate}
        className="inline-flex min-h-[36px] items-center justify-center rounded-full bg-imme-navy px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-imme-navy-700 sm:px-4 sm:text-[13px]"
      >
        Log in
      </Link>
      <Link
        href="/signup"
        onClick={onNavigate}
        className="inline-flex items-center justify-center rounded-full border border-imme-line bg-white px-3 py-1.5 text-xs font-semibold text-imme-navy transition hover:bg-imme-concrete sm:px-4 sm:text-[13px]"
      >
        Sign up
      </Link>
    </div>
  );
}

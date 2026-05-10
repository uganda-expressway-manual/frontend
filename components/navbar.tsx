"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { signOut } from "@/lib/api";
import { hasAuthSession } from "@/lib/auth-session";
import { isAdminUser } from "@/lib/auth-user";
import { useAuth } from "@/lib/hooks/use-auth";

const fontSerif = "'Playfair Display', Georgia, serif";
const fontBody  = "'Source Serif 4', 'Georgia', serif";

const C = {
  navy:   "#1a2744",
  gold:   "#c97c2a",
  paper:  "#faf8f3",
  border: "#d0c4aa",
  muted:  "#a07848",
};

export function Navbar() {
  const router          = useRouter();
  const auth            = useAuth();
  const { user }        = auth;
  const canManageUsers  = isAdminUser(user);
  const username        =
    user?.username?.trim() ||
    user?.email?.split("@")[0]?.trim() ||
    "User";

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const logoutMutation = useMutation({
    mutationFn: signOut,
    onSettled: () => router.replace("/"),
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!hasAuthSession(auth)) return null;

  return (
    <header
      style={{
        position: "sticky", top: 0, zIndex: 40,
        width: "100%", height: 64,
        background: C.paper,
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center",
      }}
    >
      <div
        style={{
          width: "100%", maxWidth: 1280,
          margin: "0 auto", padding: "0 24px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}
      >
        {/* ── Left: product title (links to folder dashboard) ── */}
        <Link href="/dashboard" style={{ textDecoration: "none" }}>
          <span style={{
            fontFamily: fontSerif, fontSize: 17, fontWeight: 700,
            color: C.navy, lineHeight: 1.2, letterSpacing: "-0.01em",
            maxWidth: 280,
          }}>
            Expressway Integrated Manual
          </span>
        </Link>

        {/* ── Right: dashboard + avatar menu ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>

          <Link
            href="/dashboard"
            style={{
              fontFamily: fontBody, fontSize: 13,
              color: C.navy, textDecoration: "none",
              padding: "6px 14px",
              border: `1px solid ${C.navy}`,
              borderRadius: 4,
              transition: "background 200ms, color 200ms",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = C.navy;
              (e.currentTarget as HTMLAnchorElement).style.color = "white";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
              (e.currentTarget as HTMLAnchorElement).style.color = C.navy;
            }}
          >
            Dashboard
          </Link>

          {/* Avatar pill with dropdown */}
          <div ref={dropdownRef} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setDropdownOpen(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                background: "white", border: `1px solid ${C.border}`,
                borderRadius: 999, padding: "5px 12px 5px 7px",
                cursor: "pointer", fontFamily: fontBody,
                fontSize: 13, color: C.navy, fontWeight: 500,
                transition: "border-color 150ms",
              }}
              aria-label="User menu"
              aria-expanded={dropdownOpen}
            >
              {/* Avatar circle */}
              <span style={{
                width: 24, height: 24, borderRadius: "50%",
                background: C.navy, color: "white",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, fontFamily: fontSerif,
                flexShrink: 0,
              }}>
                {username.charAt(0).toUpperCase()}
              </span>
              {username}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {/* Dropdown panel */}
            {dropdownOpen && (
              <div style={{
                position: "absolute", top: "calc(100% + 8px)", right: 0,
                background: C.paper, border: `1px solid ${C.border}`,
                borderRadius: 6, minWidth: 192,
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                zIndex: 100, overflow: "hidden",
              }}>
                {/* User info header */}
                <div style={{
                  padding: "10px 14px 8px",
                  borderBottom: `1px solid ${C.border}`,
                }}>
                  <p style={{
                    fontFamily: fontBody, fontSize: 10, color: C.muted,
                    letterSpacing: "0.07em", textTransform: "uppercase",
                    marginBottom: 3,
                  }}>
                    {canManageUsers ? "Administrator" : "Member"}
                  </p>
                  <p style={{
                    fontFamily: fontBody, fontSize: 12, color: C.navy,
                    wordBreak: "break-all",
                  }}>
                    {user?.email}
                  </p>
                </div>

                {/* Admin: Manage Users */}
                {canManageUsers && (
                  <DropdownLink href="/users" onClick={() => setDropdownOpen(false)}>
                    Manage Users
                  </DropdownLink>
                )}

                {/* Logout */}
                <button
                  type="button"
                  onClick={() => { setDropdownOpen(false); logoutMutation.mutate(); }}
                  style={{
                    width: "100%", textAlign: "left",
                    padding: "10px 14px", fontFamily: fontBody, fontSize: 13,
                    color: "#c0392b", background: "none", border: "none",
                    cursor: "pointer", transition: "background 150ms",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#fdf0ef"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function DropdownLink({
  href, onClick, children,
}: { href: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      style={{
        display: "block", padding: "10px 14px",
        fontFamily: "'Source Serif 4', Georgia, serif",
        fontSize: 13, color: "#1a2744",
        textDecoration: "none",
        borderBottom: "1px solid #d0c4aa",
        transition: "background 150ms",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = "#f0ebe0"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; }}
    >
      {children}
    </Link>
  );
}

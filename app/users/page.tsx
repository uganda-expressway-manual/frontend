"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminUsersPanel } from "@/components/admin-users-panel";
import { useAuth } from "@/lib/hooks/use-auth";
import { hasAuthSession } from "@/lib/auth-session";
import { isAdminUser } from "@/lib/auth-user";

/** Admin-only manage-users screen (`/users`). Folder library lives on `/dashboard`. */
export default function ManageUsersPage() {
  const router = useRouter();
  const auth = useAuth();
  const { user, token } = auth;

  useEffect(() => {
    if (!hasAuthSession(auth)) {
      return;
    }
    if (token && !user) {
      return;
    }
    if (user && !isAdminUser(user)) {
      router.replace("/dashboard");
    }
  }, [auth, router, token, user]);

  const loadingWrap = (message: string) => (
    <div style={{ padding: "48px 24px", fontFamily: "'Source Serif 4', Georgia, serif", fontStyle: "italic", color: "#8a7a60", fontSize: 14 }}>
      {message}
    </div>
  );

  if (hasAuthSession(auth) && token && !user) {
    return loadingWrap("Loading profile…");
  }

  if (!hasAuthSession(auth)) {
    return loadingWrap("Checking session…");
  }

  if (!user || !isAdminUser(user)) {
    return loadingWrap("Admin access required.");
  }

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 16px 0" }}>
      <Link
        href="/dashboard"
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          fontFamily: "'Source Serif 4', Georgia, serif", fontSize: 13, fontWeight: 600, color: "#1a2744",
          background: "#fff", border: "1px solid #d0c4aa", borderRadius: 999,
          padding: "8px 16px", marginBottom: 20, textDecoration: "none",
          boxShadow: "0 1px 3px rgba(26,39,68,0.06)", transition: "border-color 150ms, box-shadow 150ms",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.borderColor = "#c97c2a";
          (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 2px 8px rgba(201,124,42,0.14)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.borderColor = "#d0c4aa";
          (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 1px 3px rgba(26,39,68,0.06)";
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to dashboard
      </Link>
      <AdminUsersPanel />
    </div>
  );
}

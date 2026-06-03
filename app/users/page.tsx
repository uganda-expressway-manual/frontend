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

  if (hasAuthSession(auth) && token && !user) {
    return <p className="text-sm text-slate-600">Loading profile...</p>;
  }

  if (!hasAuthSession(auth)) {
    return <p className="text-sm text-slate-600">Checking session…</p>;
  }

  if (!user || !isAdminUser(user)) {
    return <p className="text-sm text-slate-600">Admin access required.</p>;
  }

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50"
      >
        <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to dashboard
      </Link>
      <AdminUsersPanel />
    </div>
  );
}

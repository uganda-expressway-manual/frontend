"use client";

import { CSSProperties, FocusEvent, FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getBackendErrorMessage } from "@/lib/api-errors";
import { isAdminUser } from "@/lib/auth-user";
import { api, patchUserPrivilege, patchUserStatus, signUpApplicantUser } from "@/lib/api";
import { APP_PUBLIC_BASE_URL, APP_USERS_PORTAL_URL } from "@/lib/app-site";
import { useAuth } from "@/lib/hooks/use-auth";
import { parseUserStatus } from "@/lib/user-status";
import { AppUser, UserRole, UserStatus } from "@/lib/types";
import { AdminActionLoadingOverlay } from "@/components/admin-action-loading-overlay";
import { ActionNoticeDialog } from "@/components/action-notice-dialog";
import { DeleteUserConfirmDialog } from "@/components/delete-user-confirm-dialog";

/* ── Design tokens (matches folder-browser.tsx / app/folders/[folderId]/page.tsx) ── */
const fontSerif = "'Playfair Display', Georgia, serif";
const fontBody = "'Source Serif 4', Georgia, serif";
const C = {
  navy: "#1a2744",
  gold: "#c97c2a",
  paper: "#faf8f3",
  bg: "#f4f1ec",
  border: "#d0c4aa",
  muted: "#8a7a60",
  red: "#a53c2e",
  green: "#2d6a3a",
};

function createUserPasswordChecks(pw: string) {
  return {
    lengthOk: pw.length >= 8,
    lowerOk: /[a-z]/.test(pw),
    upperOk: /[A-Z]/.test(pw),
    digitOk: /\d/.test(pw),
    specialOk: /[^A-Za-z0-9]/.test(pw),
  };
}

const CREATE_USER_PW_RULES = [
  { key: "lengthOk", label: "At least 8 characters" },
  { key: "lowerOk", label: "One lowercase letter (a–z)" },
  { key: "upperOk", label: "One uppercase letter (A–Z)" },
  { key: "digitOk", label: "At least one number (0–9)" },
  { key: "specialOk", label: "One special character (e.g. *&!)" },
] as const;

function ButtonSpinner() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block", width: 13, height: 13, borderRadius: "50%",
        border: "2px solid rgba(255,255,255,0.35)", borderTopColor: "#fff",
        animation: "adminSpin 700ms linear infinite",
      }}
    />
  );
}

/**
 * Administrator-only user management UI. Rendered on `/users`; folder library is on `/dashboard`.
 */
export function AdminUsersPanel() {
  const { user } = useAuth();
  const isAdmin = !!user && isAdminUser(user);

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isCreatePasswordHidden, setIsCreatePasswordHidden] = useState(true);
  const [visibleUserPasswords, setVisibleUserPasswords] = useState<Record<string, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<"ALL" | UserStatus>("ALL");
  const [userPendingDelete, setUserPendingDelete] = useState<AppUser | null>(null);
  const [actionNotice, setActionNotice] = useState<{ title: string; message: string } | null>(null);
  /** Briefly highlights the row for a user the admin just created. */
  const [highlightedUserId, setHighlightedUserId] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get<AppUser[]>("/users")).data,
    enabled: isAdmin,
  });

  const displayedUsers = useMemo(() => {
    const rows = usersQuery.data ?? [];
    if (statusFilter === "ALL") {
      return rows;
    }
    return rows.filter((row) => {
      const s = parseUserStatus(row.status) ?? "WAITING";
      return s === statusFilter;
    });
  }, [usersQuery.data, statusFilter]);

  const createUserMutation = useMutation({
    mutationFn: async () =>
      signUpApplicantUser({
        email,
        username: username.trim(),
        password,
        sendWelcomeEmail: true,
        appBaseUrl: APP_PUBLIC_BASE_URL,
        usersPortalUrl: APP_USERS_PORTAL_URL,
      }),
    onSuccess: async () => {
      const createdEmail = email.trim().toLowerCase();
      const label = email.trim() || username.trim() || "The account";
      setActionNotice({
        title: "User created",
        message: `${label} has been created and is awaiting approval before they can sign in.`,
      });
      setEmail("");
      setUsername("");
      setPassword("");
      const result = await usersQuery.refetch();
      const created = result.data?.find((row) => row.email?.trim().toLowerCase() === createdEmail);
      if (created) {
        setHighlightedUserId(created.id);
        window.setTimeout(() => {
          setHighlightedUserId((current) => (current === created.id ? null : current));
        }, 3000);
      }
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => api.delete(`/users/${userId}`),
    onSuccess: () => {
      void usersQuery.refetch();
      setUserPendingDelete(null);
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: UserStatus }) =>
      patchUserStatus(userId, status),
    onSuccess: (_data, variables) => {
      void usersQuery.refetch();
      const target = usersQuery.data?.find((row) => row.id === variables.userId);
      const label = target?.email?.trim() || target?.username?.trim() || "User";
      setActionNotice({
        title: "Status updated",
        message: `${label} is now ${variables.status}.`,
      });
    },
  });

  const updatePrivilegeMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: UserRole }) =>
      patchUserPrivilege(userId, role),
    onSuccess: (_data, variables) => {
      void usersQuery.refetch();
      const target = usersQuery.data?.find((row) => row.id === variables.userId);
      const label = target?.email?.trim() || target?.username?.trim() || "User";
      setActionNotice({
        title: "Role updated",
        message: `${label} is now ${variables.role}.`,
      });
    },
  });

  if (!isAdmin) {
    return null;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    createUserMutation.mutate();
  };

  const toggleUserPasswordVisibility = (userId: string) => {
    setVisibleUserPasswords((previous) => ({ ...previous, [userId]: !previous[userId] }));
  };

  const createUserErrorMessage = getBackendErrorMessage(createUserMutation.error, "Failed to create user.");

  const isUpdatingStatus = updateStatusMutation.isPending;
  const isUpdatingRole = updatePrivilegeMutation.isPending;
  const isUpdatingUserField = isUpdatingStatus || isUpdatingRole;
  const updatingUserId =
    updateStatusMutation.variables?.userId ?? updatePrivilegeMutation.variables?.userId ?? null;
  const updatingUserLabel = (() => {
    if (!updatingUserId) {
      return "";
    }
    const target = usersQuery.data?.find((row) => row.id === updatingUserId);
    return target?.email?.trim() || target?.username?.trim() || "this user";
  })();
  const loadingMessage = isUpdatingStatus
    ? `Updating status for ${updatingUserLabel || "user"}…`
    : `Updating role for ${updatingUserLabel || "user"}…`;

  const inputStyle: CSSProperties = {
    width: "100%", boxSizing: "border-box",
    padding: "9px 12px", fontFamily: fontBody, fontSize: 13.5,
    color: C.navy, background: "#fff",
    border: `1px solid ${C.border}`, borderRadius: 5,
    outline: "none", transition: "border-color 150ms, box-shadow 150ms",
  };
  const onInputFocus = (e: FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = C.gold;
    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(201,124,42,0.12)";
  };
  const onInputBlur = (e: FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = C.border;
    e.currentTarget.style.boxShadow = "none";
  };
  const selectStyle: CSSProperties = {
    fontFamily: fontBody, fontSize: 12.5,
    color: C.navy, background: "#fff",
    border: `1px solid ${C.border}`, borderRadius: 4,
    padding: "5px 9px", cursor: "pointer", outline: "none",
  };

  return (
    <section id="admin-users" style={{ maxWidth: 1080, margin: "0 auto", paddingBottom: 40, fontFamily: fontBody }}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Source+Serif+4:ital,wght@0,300;0,400;1,300&display=swap"
      />

      {/* Header */}
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12,
        background: C.paper, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: "16px 20px", marginBottom: 24,
      }}>
        <div>
          <h2 style={{ fontFamily: fontSerif, fontSize: 20, fontWeight: 700, color: C.navy }}>
            User management
          </h2>
          <p style={{ marginTop: 4, fontSize: 12.5, fontStyle: "italic", color: C.muted }}>
            Create accounts, approve status, change roles, remove users.
          </p>
        </div>
        <p style={{
          flexShrink: 0, fontFamily: fontBody, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
          textTransform: "uppercase", color: C.gold,
          border: `1px solid ${C.gold}`, borderRadius: 999, padding: "3px 12px",
          background: "rgba(201,124,42,0.08)",
        }}>
          Admin
        </p>
      </div>

      {/* Create user */}
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontFamily: fontSerif, fontSize: 17, fontWeight: 700, color: C.navy }}>Create user</h3>
        <p style={{ marginTop: 3, fontSize: 12.5, color: C.muted }}>Only admins can create new users.</p>
      </div>

      <form
        onSubmit={onSubmit}
        style={{
          display: "flex", flexDirection: "column", gap: 12,
          background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8,
          padding: 20, marginBottom: 8,
        }}
      >
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          type="email"
          required
          style={inputStyle}
          onFocus={onInputFocus}
          onBlur={onInputBlur}
        />
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Username"
          autoComplete="username"
          required
          minLength={2}
          maxLength={64}
          style={inputStyle}
          onFocus={onInputFocus}
          onBlur={onInputBlur}
        />
        <div style={{ position: "relative" }}>
          <input
            type={isCreatePasswordHidden ? "password" : "text"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="Password"
            required
            style={{ ...inputStyle, paddingRight: 40 }}
            onFocus={onInputFocus}
            onBlur={onInputBlur}
          />
          <button
            type="button"
            onClick={() => setIsCreatePasswordHidden((previous) => !previous)}
            aria-label={isCreatePasswordHidden ? "Show password" : "Hide password"}
            style={{
              position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 30, height: 30, background: "none", border: "none", cursor: "pointer",
              color: C.muted,
            }}
          >
            {isCreatePasswordHidden ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3l18 18" />
                <path d="M10.58 10.58a2 2 0 102.84 2.84" />
                <path d="M9.88 5.09A10.94 10.94 0 0112 5c5.05 0 9.27 3.11 10 7-.21 1.13-.73 2.2-1.5 3.11" />
                <path d="M6.61 6.61C4.62 7.9 3.26 9.82 3 12c.73 3.89 4.95 7 10 7 2.18 0 4.2-.58 5.9-1.59" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
        <ul
          aria-label="Password requirements"
          aria-live="polite"
          style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 6 }}
        >
          {CREATE_USER_PW_RULES.map(({ key, label }) => {
            const ok = createUserPasswordChecks(password)[key];
            return (
              <li key={key} style={{
                display: "flex", alignItems: "center", gap: 6,
                fontFamily: fontBody, fontSize: 11.5, whiteSpace: "nowrap",
                color: ok ? C.green : C.muted,
                transition: "color 200ms",
              }}>
                <span style={{
                  fontSize: 11, lineHeight: 1,
                  color: ok ? C.gold : "#ccc",
                  transition: "color 200ms", flexShrink: 0,
                }}>
                  {ok ? "✓" : "○"}
                </span>
                {label}
              </li>
            );
          })}
        </ul>

        <button
          disabled={createUserMutation.isPending}
          style={{
            alignSelf: "flex-start",
            display: "inline-flex", alignItems: "center", gap: 8,
            fontFamily: fontBody, fontSize: 13, letterSpacing: "0.03em", color: "#fff",
            background: C.navy, border: "none", borderRadius: 999,
            padding: "9px 20px", cursor: createUserMutation.isPending ? "not-allowed" : "pointer",
            opacity: createUserMutation.isPending ? 0.75 : 1,
            transition: "background 180ms, opacity 150ms",
          }}
          onMouseEnter={(e) => { if (!createUserMutation.isPending) (e.currentTarget as HTMLButtonElement).style.background = C.gold; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = C.navy; }}
        >
          {createUserMutation.isPending && <ButtonSpinner />}
          {createUserMutation.isPending ? "Creating…" : "Create user"}
        </button>
      </form>

      {createUserMutation.error && (
        <p style={{ fontSize: 12.5, color: C.red, marginBottom: 8 }}>{createUserErrorMessage}</p>
      )}

      {/* All users */}
      <section style={{
        background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8,
        padding: 20, marginTop: 20,
      }}>
        <div style={{
          display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between",
          gap: 12, marginBottom: 14,
        }}>
          <h3 style={{ fontFamily: fontSerif, fontSize: 16, fontWeight: 700, color: C.navy }}>All users</h3>
          {(usersQuery.data?.length ?? 0) > 0 && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.navy }}>
              <span style={{ flexShrink: 0 }}>Filter by status</span>
              <select
                style={{ ...selectStyle, maxWidth: "11rem" }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "ALL" | UserStatus)}
              >
                <option value="ALL">All statuses</option>
                <option value="WAITING">WAITING</option>
                <option value="APPROVED">APPROVED</option>
                <option value="REJECTED">REJECTED</option>
              </select>
            </label>
          )}
        </div>

        {usersQuery.isLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0" }}>
            <span style={{
              width: 16, height: 16, borderRadius: "50%",
              border: `2px solid ${C.border}`, borderTopColor: C.gold,
              animation: "adminSpin 700ms linear infinite",
            }} />
            <p style={{ fontSize: 13, fontStyle: "italic", color: C.muted }}>Loading users…</p>
          </div>
        )}
        {usersQuery.error && (
          <p style={{ fontSize: 12.5, color: C.red }}>{getBackendErrorMessage(usersQuery.error, "Failed to load users.")}</p>
        )}
        {(usersQuery.data?.length ?? 0) === 0 && !usersQuery.isLoading && (
          <p style={{ fontSize: 13, fontStyle: "italic", color: C.muted }}>No users found.</p>
        )}
        {(usersQuery.data?.length ?? 0) > 0 && displayedUsers.length === 0 && (
          <p style={{ fontSize: 13, fontStyle: "italic", color: C.muted }}>No users match this status filter.</p>
        )}

        {displayedUsers.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ minWidth: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {["Email", "Username", "Status", "Role", "Password", "Action"].map((h) => (
                    <th key={h} style={{
                      padding: "8px 10px", fontFamily: fontBody, fontSize: 11,
                      fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted,
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedUsers.map((listedUser) => {
                  const isHighlighted = listedUser.id === highlightedUserId;
                  return (
                  <tr
                    key={listedUser.id}
                    style={{
                      borderBottom: `1px solid #f0e8d8`,
                      background: isHighlighted ? "rgba(201,124,42,0.16)" : "transparent",
                      transition: "background 900ms ease",
                    }}
                    onMouseEnter={(e) => {
                      if (!isHighlighted) (e.currentTarget as HTMLTableRowElement).style.background = "rgba(201,124,42,0.04)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = isHighlighted ? "rgba(201,124,42,0.16)" : "transparent";
                    }}
                  >
                    <td style={{ padding: "9px 10px", color: C.navy }}>{listedUser.email || "-"}</td>
                    <td style={{ padding: "9px 10px", color: C.navy }}>{listedUser.username?.trim() || "-"}</td>
                    <td style={{ padding: "9px 10px" }}>
                      <select
                        style={selectStyle}
                        value={parseUserStatus(listedUser.status) ?? "WAITING"}
                        onChange={(event) =>
                          updateStatusMutation.mutate({
                            userId: listedUser.id,
                            status: event.target.value as UserStatus,
                          })
                        }
                        disabled={isUpdatingUserField}
                        aria-label={`Set status for ${listedUser.email}`}
                      >
                        <option value="WAITING">WAITING</option>
                        <option value="APPROVED">APPROVED</option>
                        <option value="REJECTED">REJECTED</option>
                      </select>
                    </td>
                    <td style={{ padding: "9px 10px" }}>
                      <select
                        style={selectStyle}
                        value={listedUser.role ?? "USER"}
                        onChange={(event) =>
                          updatePrivilegeMutation.mutate({
                            userId: listedUser.id,
                            role: event.target.value as UserRole,
                          })
                        }
                        disabled={isUpdatingUserField}
                        aria-label={`Set role for ${listedUser.email}`}
                      >
                        <option value="USER">USER</option>
                        <option value="VIEWER">VIEWER</option>
                      </select>
                    </td>
                    <td style={{ padding: "9px 10px" }}>
                      {(() => {
                        const userPassword = listedUser.password ?? listedUser.passwordHash ?? "";
                        if (!userPassword) {
                          return <span style={{ color: C.muted }}>-</span>;
                        }

                        const isPasswordVisible = !!visibleUserPasswords[listedUser.id];
                        return (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <span style={{ color: C.navy, fontVariantNumeric: "tabular-nums" }}>
                              {isPasswordVisible ? userPassword : "*".repeat(Math.max(userPassword.length, 8))}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleUserPasswordVisibility(listedUser.id)}
                              aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                              style={{
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                width: 26, height: 26, borderRadius: 5,
                                color: C.muted, background: "none", border: "none", cursor: "pointer",
                                transition: "background 150ms, color 150ms",
                              }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = "rgba(201,124,42,0.10)";
                                (e.currentTarget as HTMLButtonElement).style.color = C.navy;
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = "none";
                                (e.currentTarget as HTMLButtonElement).style.color = C.muted;
                              }}
                            >
                              {isPasswordVisible ? (
                                <svg viewBox="0 0 24 24" aria-hidden="true" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" aria-hidden="true" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M3 3l18 18" />
                                  <path d="M10.58 10.58a2 2 0 102.84 2.84" />
                                  <path d="M9.88 5.09A10.94 10.94 0 0112 5c5.05 0 9.27 3.11 10 7-.21 1.13-.73 2.2-1.5 3.11" />
                                  <path d="M6.61 6.61C4.62 7.9 3.26 9.82 3 12c.73 3.89 4.95 7 10 7 2.18 0 4.2-.58 5.9-1.59" />
                                </svg>
                              )}
                            </button>
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ padding: "9px 10px" }}>
                      <button
                        type="button"
                        onClick={() => setUserPendingDelete(listedUser)}
                        aria-label={`Delete user ${listedUser.email ?? listedUser.id}`}
                        title="Delete user"
                        disabled={deleteUserMutation.isPending}
                        style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          width: 30, height: 30, borderRadius: 6,
                          color: C.red, background: "none", border: "none",
                          cursor: deleteUserMutation.isPending ? "not-allowed" : "pointer",
                          opacity: deleteUserMutation.isPending ? 0.5 : 1,
                          transition: "background 150ms",
                        }}
                        onMouseEnter={(e) => { if (!deleteUserMutation.isPending) (e.currentTarget as HTMLButtonElement).style.background = "rgba(165,60,46,0.10)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {deleteUserMutation.error && (
          <p style={{ fontSize: 12.5, color: C.red, marginTop: 10 }}>
            {getBackendErrorMessage(deleteUserMutation.error, "Failed to delete user.")}
          </p>
        )}

        <DeleteUserConfirmDialog
          open={userPendingDelete !== null}
          displayLabel={
            userPendingDelete?.email?.trim() ||
            (userPendingDelete?.username?.trim() ? `@${userPendingDelete.username.trim()}` : "") ||
            userPendingDelete?.id ||
            ""
          }
          onCancel={() => setUserPendingDelete(null)}
          onConfirm={() => {
            if (!userPendingDelete) {
              return;
            }
            deleteUserMutation.mutate(userPendingDelete.id);
          }}
          pending={deleteUserMutation.isPending}
        />
        {updateStatusMutation.error && (
          <p style={{ fontSize: 12.5, color: C.red, marginTop: 10 }}>
            {getBackendErrorMessage(updateStatusMutation.error, "Failed to update status.")}
          </p>
        )}
        {updatePrivilegeMutation.error && (
          <p style={{ fontSize: 12.5, color: C.red, marginTop: 10 }}>
            {getBackendErrorMessage(updatePrivilegeMutation.error, "Failed to update role.")}
          </p>
        )}
        <AdminActionLoadingOverlay open={isUpdatingUserField} message={loadingMessage} />
        <ActionNoticeDialog
          open={actionNotice !== null}
          title={actionNotice?.title ?? ""}
          message={actionNotice?.message ?? ""}
          onClose={() => setActionNotice(null)}
        />
      </section>

      <style jsx global>{`
        @keyframes adminSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </section>
  );
}

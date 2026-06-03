"use client";

import { FormEvent, useMemo, useState } from "react";
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
    onSuccess: () => {
      setEmail("");
      setUsername("");
      setPassword("");
      void usersQuery.refetch();
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

  return (
    <section id="admin-users" className="mx-auto max-w-6xl space-y-5 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-sm sm:px-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">User management</h2>
          <p className="text-xs text-slate-600">Create accounts, approve status, change roles, remove users.</p>
        </div>
        <p className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
          Admin
        </p>
      </div>

      <div>
        <h3 className="text-xl font-semibold tracking-tight">Create User</h3>
        <p className="mt-1 text-sm text-slate-600">Only admins can create new users.</p>
      </div>

      <form onSubmit={onSubmit} className="ui-card space-y-3 p-5">
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          className="ui-input"
          required
        />
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Username"
          className="ui-input"
          autoComplete="username"
          required
          minLength={2}
          maxLength={64}
        />
        <div className="relative">
          <input
            type={isCreatePasswordHidden ? "password" : "text"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            className="ui-input pr-10"
            required
          />
          <button
            type="button"
            onClick={() => setIsCreatePasswordHidden((previous) => !previous)}
            aria-label={isCreatePasswordHidden ? "Show password" : "Hide password"}
            className="absolute inset-y-0 right-0 inline-flex items-center justify-center px-3 text-slate-500 hover:text-slate-700"
          >
            {isCreatePasswordHidden ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3l18 18" />
                <path d="M10.58 10.58a2 2 0 102.84 2.84" />
                <path d="M9.88 5.09A10.94 10.94 0 0112 5c5.05 0 9.27 3.11 10 7-.21 1.13-.73 2.2-1.5 3.11" />
                <path d="M6.61 6.61C4.62 7.9 3.26 9.82 3 12c.73 3.89 4.95 7 10 7 2.18 0 4.2-.58 5.9-1.59" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
        <p className="text-xs text-slate-600">
          Password must be at least 8 characters and include one uppercase letter, one lowercase letter, one number, and
          a special character (e.g. *&!).
        </p>

        <button disabled={createUserMutation.isPending} className="ui-btn-primary">
          {createUserMutation.isPending ? "Creating..." : "Create User"}
        </button>
      </form>

      {createUserMutation.isSuccess && <p className="text-sm text-green-700">User created successfully.</p>}
      {createUserMutation.error && <p className="text-sm text-red-600">{createUserErrorMessage}</p>}

      <section className="ui-card space-y-3 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-base font-semibold text-slate-900">All Users</h3>
          {(usersQuery.data?.length ?? 0) > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <span className="shrink-0">Filter by status</span>
              <select
                className="ui-input max-w-[11rem] py-1.5 text-sm"
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
        {usersQuery.isLoading && <p className="text-sm text-slate-600">Loading users...</p>}
        {usersQuery.error && <p className="text-sm text-red-600">{getBackendErrorMessage(usersQuery.error, "Failed to load users.")}</p>}
        {(usersQuery.data?.length ?? 0) === 0 && !usersQuery.isLoading && (
          <p className="text-sm text-slate-600">No users found.</p>
        )}
        {(usersQuery.data?.length ?? 0) > 0 && displayedUsers.length === 0 && (
          <p className="text-sm text-slate-600">No users match this status filter.</p>
        )}
        {displayedUsers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-700">
                  <th className="px-2 py-2 font-semibold">Email</th>
                  <th className="px-2 py-2 font-semibold">Username</th>
                  <th className="px-2 py-2 font-semibold">Status</th>
                  <th className="px-2 py-2 font-semibold">Role</th>
                  <th className="px-2 py-2 font-semibold">Password</th>
                  <th className="px-2 py-2 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {displayedUsers.map((listedUser) => (
                  <tr key={listedUser.id} className="border-b border-slate-100 text-slate-700">
                    <td className="px-2 py-2">{listedUser.email || "-"}</td>
                    <td className="px-2 py-2">{listedUser.username?.trim() || "-"}</td>
                    <td className="px-2 py-2">
                      <select
                        className="ui-input max-w-[11rem] py-1.5 text-xs"
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
                    <td className="px-2 py-2">
                      <select
                        className="ui-input max-w-[11rem] py-1.5 text-xs"
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
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      {(() => {
                        const userPassword = listedUser.password ?? listedUser.passwordHash ?? "";
                        if (!userPassword) {
                          return <span>-</span>;
                        }

                        const isPasswordVisible = !!visibleUserPasswords[listedUser.id];
                        return (
                          <div className="inline-flex items-center gap-2">
                            <span>{isPasswordVisible ? userPassword : "*".repeat(Math.max(userPassword.length, 8))}</span>
                            <button
                              type="button"
                              onClick={() => toggleUserPasswordVisibility(listedUser.id)}
                              aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                            >
                              {isPasswordVisible ? (
                                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
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
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => setUserPendingDelete(listedUser)}
                        aria-label={`Delete user ${listedUser.email ?? listedUser.id}`}
                        title="Delete user"
                        disabled={deleteUserMutation.isPending}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {deleteUserMutation.error && (
          <p className="text-sm text-red-600">{getBackendErrorMessage(deleteUserMutation.error, "Failed to delete user.")}</p>
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
          <p className="text-sm text-red-600">{getBackendErrorMessage(updateStatusMutation.error, "Failed to update status.")}</p>
        )}
        {updatePrivilegeMutation.error && (
          <p className="text-sm text-red-600">{getBackendErrorMessage(updatePrivilegeMutation.error, "Failed to update role.")}</p>
        )}
        <AdminActionLoadingOverlay open={isUpdatingUserField} message={loadingMessage} />
        <ActionNoticeDialog
          open={actionNotice !== null}
          title={actionNotice?.title ?? ""}
          message={actionNotice?.message ?? ""}
          onClose={() => setActionNotice(null)}
        />
      </section>
    </section>
  );
}

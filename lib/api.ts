import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { getBrowserCookie } from "@/lib/auth-cookies";
import { resolveAuthUserFromCredentialResponse } from "@/lib/auth-user";
import { SignInBlockedByAccountStatusError } from "@/lib/sign-in-errors";
import {
  isLoginBlockedAccountStatus,
  parseAccountStatusFromAuthPayload,
  parseUserStatus,
} from "@/lib/user-status";
import { authStore } from "@/lib/auth-store";
import {
  BookmarkItem,
  HighlightItem,
  NoteItem,
  PdfPresignedUrlResponse,
  SignInResponse,
  UserRole,
  UserStatus,
} from "@/lib/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_EXPRESS_SERVER_URL ?? "http://localhost:4000";
const AUTH_SIGN_OUT_ENDPOINT = process.env.NEXT_PUBLIC_AUTH_SIGNOUT_ENDPOINT?.trim() ?? "";
const AUTH_SIGN_OUT_METHOD = (process.env.NEXT_PUBLIC_AUTH_SIGNOUT_METHOD ?? "delete").toLowerCase();

/** Express auth routes — keep aligned with backend. */
export const AUTH_ROUTES = {
  signIn: "/auth/signin",
  signUp: "/auth/signup",
  refresh: "/auth/refresh",
  /** POST `{ email }` → `{ message, status }` when registered (`checkEmailForLogin` accepts several `message` phrasings). */
  checkEmail: "/auth/check-email",
} as const;

export const USERS_SIGNUP_ROUTES = {
  user: "/users/signup/user",
  admin: "/users/signup/admin",
} as const;

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

let refreshPromise: Promise<boolean> | null = null;
/** Credential-exchange routes must not trigger refresh-token retry on 401. */
const AUTH_ENDPOINTS = [
  AUTH_ROUTES.signIn,
  AUTH_ROUTES.signUp,
  AUTH_ROUTES.refresh,
  AUTH_ROUTES.checkEmail,
  "/auth/signOut",
  "/auth/signout",
];

function isAuthEndpoint(url?: string): boolean {
  if (!url) {
    return false;
  }
  return AUTH_ENDPOINTS.some((endpoint) => url.includes(endpoint)) || Boolean(AUTH_SIGN_OUT_ENDPOINT && url.includes(AUTH_SIGN_OUT_ENDPOINT));
}

function attachAuthHeaders(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  if (isAuthEndpoint(config.url)) {
    return config;
  }
  const token = authStore.getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}

api.interceptors.request.use(attachAuthHeaders);

function pickAccessTokenFromBody(data: unknown): string | undefined {
  if (data == null || typeof data !== "object") {
    return undefined;
  }
  const r = data as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined);

  const direct =
    str(r.accessToken) ?? str(r.newAccessToken) ?? str(r.token) ?? str(r.jwt) ?? str(r.access_token);
  if (direct) {
    return direct;
  }

  if (r.data != null && typeof r.data === "object") {
    const d = r.data as Record<string, unknown>;
    const nested = str(d.accessToken) ?? str(d.newAccessToken) ?? str(d.token);
    if (nested) {
      return nested;
    }
  }

  if (r.tokens != null && typeof r.tokens === "object") {
    const t = r.tokens as Record<string, unknown>;
    const nested = str(t.accessToken) ?? str(t.newAccessToken);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function pickRefreshTokenFromBody(data: unknown): string | undefined {
  if (data == null || typeof data !== "object") {
    return undefined;
  }
  const r = data as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined);

  const direct =
    str(r.refreshToken) ??
    str(r.newRefreshToken) ??
    str(r.refresh_token) ??
    str(r.refresh_token_hint);
  if (direct) {
    return direct;
  }

  if (r.data != null && typeof r.data === "object") {
    const d = r.data as Record<string, unknown>;
    const nested = str(d.refreshToken) ?? str(d.newRefreshToken);
    if (nested) {
      return nested;
    }
  }

  if (r.tokens != null && typeof r.tokens === "object") {
    const t = r.tokens as Record<string, unknown>;
    const nested = str(t.refreshToken) ?? str(t.newRefreshToken);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function syncCsrfFromDocumentCookie(): void {
  const v = getBrowserCookie("csrfValue");
  if (v) {
    authStore.setCsrfToken(v);
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;

    if (
      !originalRequest ||
      originalRequest._retry ||
      error.response?.status !== 401 ||
      isAuthEndpoint(originalRequest.url)
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    if (!refreshPromise) {
      refreshPromise = refreshAccessToken();
    }

    const refreshedOk = await refreshPromise.finally(() => {
      refreshPromise = null;
    });

    if (!refreshedOk) {
      authStore.clear();
      return Promise.reject(error);
    }

    const token = authStore.getAccessToken();
    if (token) {
      originalRequest.headers.Authorization = `Bearer ${token}`;
    }
    return api.request(originalRequest);
  }
);

export async function signUp(email: string, password: string, username: string): Promise<void> {
  await api.post(AUTH_ROUTES.signUp, { email, password, username: username.trim() });
}

export type CheckEmailLoginResult =
  | { registered: false }
  /** Account exists; gate password step on `status === "APPROVED"`. */
  | { registered: true; status: UserStatus };

function isAccountExistsMessage(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  const tail = trimmed.includes(".") ? (trimmed.split(".").pop() ?? trimmed) : trimmed;
  if (tail.trim().toUpperCase() === "ACCOUNT_EXISTS") {
    return true;
  }
  const normalized = trimmed.toLowerCase();
  return (
    normalized.includes("account already exists") ||
    normalized.includes("already have an account")
  );
}

function parseCheckEmailLoginBody(data: unknown): CheckEmailLoginResult {
  if (data == null || typeof data !== "object") {
    throw new Error("Invalid check-email response");
  }
  const r = data as Record<string, unknown>;

  if (r.exists === false || r.registered === false) {
    return { registered: false };
  }

  const status = parseUserStatus(r.status ?? r.userStatus ?? r.accountStatus);
  const accountExistsMessage = isAccountExistsMessage(r.message);

  if (accountExistsMessage && status) {
    return { registered: true, status };
  }

  if (typeof r.exists === "boolean" && r.exists) {
    return { registered: true, status: status ?? "APPROVED" };
  }
  if (typeof r.registered === "boolean" && r.registered) {
    return { registered: true, status: status ?? "APPROVED" };
  }

  throw new Error("Unrecognized check-email response shape");
}

/**
 * POST `/auth/check-email` with `{ email }`.
 *
 * When the email is registered the backend responds with a message indicating the account exists
 * (e.g. `message: "ACCOUNT_EXISTS"` or `'Account already exists.'`) plus `status` (`UserStatus`).
 * prompt signup.
 *
 * Override path with `NEXT_PUBLIC_AUTH_CHECK_EMAIL_PATH`. Set `NEXT_PUBLIC_AUTH_CHECK_EMAIL_DISABLED=true`
 * to skip the request (login goes straight to the password step — dev only).
 */
export async function checkEmailForLogin(email: string): Promise<CheckEmailLoginResult> {
  const path = process.env.NEXT_PUBLIC_AUTH_CHECK_EMAIL_PATH?.trim() ?? AUTH_ROUTES.checkEmail;
  try {
    const { data } = await api.post(path, {
      email: email.trim().toLowerCase(),
    });
    return parseCheckEmailLoginBody(data);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return { registered: false };
    }
    throw error;
  }
}

/** @deprecated Use `checkEmailForLogin`, which validates account status before the password step. */
export async function checkEmailRegisteredForLogin(email: string): Promise<boolean> {
  const r = await checkEmailForLogin(email);
  return r.registered && r.status === "APPROVED";
}

export type ApplicantSignUpPayload = {
  email: string;
  password: string;
  username: string;
  sendWelcomeEmail?: boolean;
  appBaseUrl?: string;
  usersPortalUrl?: string;
};

export async function signUpApplicantUser(payload: ApplicantSignUpPayload): Promise<void> {
  await api.post(USERS_SIGNUP_ROUTES.user, payload);
}

export async function signUpApplicantAdmin(payload: ApplicantSignUpPayload): Promise<void> {
  await api.post(USERS_SIGNUP_ROUTES.admin, payload);
}

/** PATCH `/users/:userId/status` — e.g. `{ status: "APPROVED" }`. */
export async function patchUserStatus(userId: string, status: UserStatus): Promise<void> {
  await api.patch(`/users/${userId}/status`, { status });
}

/** PATCH `/users/:userId/privilege` — e.g. `{ role: "VIEWER" }`. */
export async function patchUserPrivilege(userId: string, role: UserRole): Promise<void> {
  await api.patch(`/users/${userId}/privilege`, { role });
}

function collectBackendAuthErrorText(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  if (!data || typeof data !== "object") {
    return "";
  }
  const o = data as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["message", "error", "detail", "description", "reason"] as const) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) {
      parts.push(v);
    }
  }
  const nested = o.errors ?? o.validationErrors;
  if (Array.isArray(nested)) {
    for (const item of nested) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (item && typeof item === "object") {
        const m = (item as Record<string, unknown>).message ?? (item as Record<string, unknown>).msg;
        if (typeof m === "string") {
          parts.push(m);
        }
      }
    }
  }
  return parts.join(" ").trim();
}

/** Backend rejected login because the account is not verified / not approved (HTTP error body). */
function signInBlockedFromAuthHttpError(error: unknown): SignInBlockedByAccountStatusError | undefined {
  if (!axios.isAxiosError(error) || error.response == null) {
    return undefined;
  }
  const { data } = error.response;
  const blob = collectBackendAuthErrorText(data).toLowerCase();

  const statusFromBody = parseAccountStatusFromAuthPayload(data);
  if (statusFromBody && isLoginBlockedAccountStatus(statusFromBody)) {
    return new SignInBlockedByAccountStatusError(statusFromBody);
  }

  if (data && typeof data === "object") {
    const code = String((data as Record<string, unknown>).code ?? "").toUpperCase();
    if (
      code === "USER_NOT_VERIFIED" ||
      code === "EMAIL_NOT_VERIFIED" ||
      code === "ACCOUNT_NOT_VERIFIED" ||
      code === "ACCOUNT_PENDING" ||
      code === "NOT_APPROVED" ||
      code === "ACCOUNT_NOT_APPROVED"
    ) {
      return new SignInBlockedByAccountStatusError("WAITING");
    }
    if (code === "ACCOUNT_REJECTED") {
      return new SignInBlockedByAccountStatusError("REJECTED");
    }
  }

  if (/rejected|your account has been rejected/i.test(blob)) {
    return new SignInBlockedByAccountStatusError("REJECTED");
  }

  const pendingHints =
    /not verified|user not verified|email not verified|account not verified|unverified|pending approval|awaiting approval|not activated|account not approved|waiting for approval|administrator approval|pending verification|verify your email|must be verified|approval required|account is pending|pending admin/i;

  if (pendingHints.test(blob)) {
    return new SignInBlockedByAccountStatusError("WAITING");
  }

  return undefined;
}

/** True when JSON explicitly marks the user as unverified (email/account) and we should not open a session. */
function payloadIndicatesUnverifiedAccount(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const falsy = (v: unknown) =>
    v === false || (typeof v === "string" && v.trim().toLowerCase() === "false");

  const scan = (o: Record<string, unknown>) =>
    falsy(o.verified) || falsy(o.isVerified) || falsy(o.emailVerified) || falsy(o.userVerified);

  const r = payload as Record<string, unknown>;
  if (scan(r)) {
    return true;
  }
  const user = r.user;
  return Boolean(user && typeof user === "object" && scan(user as Record<string, unknown>));
}

export async function signIn(email: string, password: string): Promise<SignInResponse> {
  try {
    const response = await api.post<SignInResponse>(AUTH_ROUTES.signIn, { email, password });
    const payload = response.data as SignInResponse & Record<string, unknown>;

    syncCsrfFromDocumentCookie();

    /** Tokens may already be set as HttpOnly cookies — evaluate approval before storing session. */
    const accessToken = pickAccessTokenFromBody(payload);
    const refreshToken = pickRefreshTokenFromBody(payload);

    const resolvedUser = resolveAuthUserFromCredentialResponse(payload, email);
    const effectiveStatus =
      parseAccountStatusFromAuthPayload(payload) ?? resolvedUser.status;

    if (isLoginBlockedAccountStatus(effectiveStatus)) {
      authStore.clear();
      await signOut();
      throw new SignInBlockedByAccountStatusError(effectiveStatus as UserStatus);
    }

    if (effectiveStatus !== "APPROVED" && payloadIndicatesUnverifiedAccount(payload)) {
      authStore.clear();
      await signOut();
      throw new SignInBlockedByAccountStatusError("WAITING");
    }

    authStore.setRefreshToken(refreshToken ?? null);
    authStore.setAccessToken(accessToken ?? null);

    authStore.setUser(resolvedUser);

    return {
      ...payload,
      ...(typeof accessToken === "string" ? { accessToken } : {}),
      user: resolvedUser,
      role: resolvedUser.role,
    };
  } catch (error) {
    if (error instanceof SignInBlockedByAccountStatusError) {
      throw error;
    }
    const blocked = signInBlockedFromAuthHttpError(error);
    if (blocked) {
      authStore.clear();
      await signOut();
      throw blocked;
    }
    if (axios.isAxiosError<{ message?: string }>(error)) {
      const apiMessage = error.response?.data?.message ?? error.message;
      throw new Error(apiMessage || "Login failed. Check credentials and try again.");
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Login failed. Check credentials and try again.");
  }
}

export async function signOut(): Promise<void> {
  if (AUTH_SIGN_OUT_ENDPOINT) {
    try {
      if (AUTH_SIGN_OUT_METHOD === "post") {
        await api.post(AUTH_SIGN_OUT_ENDPOINT);
      } else if (AUTH_SIGN_OUT_METHOD === "patch") {
        await api.patch(AUTH_SIGN_OUT_ENDPOINT);
      } else {
        await api.delete(AUTH_SIGN_OUT_ENDPOINT);
      }
    } catch {
      // Logout should still complete client-side even if server revoke fails.
    }
  }
  authStore.clear();
}

export async function refreshAccessToken(): Promise<boolean> {
  try {
    const csrfValue = authStore.getCsrfToken() ?? getBrowserCookie("csrfValue");
    const response = await api.patch<unknown>(AUTH_ROUTES.refresh, {}, {
      headers: { "x-csrf-value": csrfValue ?? "" },
    });

    syncCsrfFromDocumentCookie();

    const payload = response.data;
    const accessToken = pickAccessTokenFromBody(payload);
    const refreshToken = pickRefreshTokenFromBody(payload);

    const fallbackEmail = authStore.getUser()?.email ?? "";
    const resolvedUser = resolveAuthUserFromCredentialResponse(
      payload,
      fallbackEmail || "user@session.local",
    );
    const effectiveStatus =
      parseAccountStatusFromAuthPayload(payload) ?? resolvedUser.status;

    if (isLoginBlockedAccountStatus(effectiveStatus)) {
      authStore.clear();
      await signOut();
      return false;
    }

    authStore.setAccessToken(accessToken ?? null);
    authStore.setRefreshToken(refreshToken ?? null);

    authStore.setUser(resolvedUser);

    return true;
  } catch {
    return false;
  }
}

function parsePdfPresignedUrlPayload(data: unknown): PdfPresignedUrlResponse {
  if (data == null || typeof data !== "object") {
    throw new Error("PDF presign response was not JSON");
  }
  const r = data as Record<string, unknown>;
  const url = typeof r.url === "string" ? r.url.trim() : "";
  if (!url) {
    throw new Error('PDF presign response missing "url"');
  }
  const filename =
    typeof r.filename === "string" && r.filename.trim().length > 0 ? r.filename.trim() : undefined;
  let expiresIn: number | undefined;
  if (typeof r.expiresIn === "number" && Number.isFinite(r.expiresIn) && r.expiresIn > 0) {
    expiresIn = r.expiresIn;
  }
  return { url, ...(filename ? { filename } : {}), ...(expiresIn != null ? { expiresIn } : {}) };
}

/** GET `/files/pdf/:fileId` — JSON with S3 presigned `url`; no binary body. */
export async function getPdfViewerPresignedUrl(fileId: string, signal?: AbortSignal): Promise<PdfPresignedUrlResponse> {
  const { data } = await api.get<unknown>(`/files/pdf/${encodeURIComponent(fileId)}`, { signal });
  return parsePdfPresignedUrlPayload(data);
}

export async function getBookmarks(fileId: string): Promise<BookmarkItem[]> {
  return (await api.get<BookmarkItem[]>("/bookmarks", { params: { fileId } })).data;
}

export async function createBookmark(payload: {
  fileId: string;
  page: number;
  color?: string;
}): Promise<BookmarkItem> {
  return (await api.post<BookmarkItem>("/bookmarks", payload)).data;
}

export async function deleteBookmark(payload: { fileId: string; page: number }): Promise<void> {
  await api.delete("/bookmarks", { data: payload });
}

/* ------------------------------------------------------------------ */
/* Highlights                                                         */
/* ------------------------------------------------------------------ */

/** GET `/highlights?fileId=:fileId` — current user's highlights for the file, ordered by page asc, createdAt asc. */
export async function getHighlights(fileId: string): Promise<HighlightItem[]> {
  return (await api.get<HighlightItem[]>("/highlights", { params: { fileId } })).data;
}

export interface CreateHighlightPayload {
  fileId: string;
  page: number;
  text: string;
  color?: string;
  /** Offsets within the page's plain text — backend stores as nullable Int. */
  startOffset?: number | null;
  endOffset?: number | null;
}

export async function createHighlight(payload: CreateHighlightPayload): Promise<HighlightItem> {
  return (await api.post<HighlightItem>("/highlights", payload)).data;
}

export async function updateHighlightColor(highlightId: string, color: string): Promise<HighlightItem> {
  return (await api.patch<HighlightItem>(`/highlights/${encodeURIComponent(highlightId)}`, { color })).data;
}

export async function deleteHighlight(highlightId: string): Promise<void> {
  await api.delete(`/highlights/${encodeURIComponent(highlightId)}`);
}

/* ------------------------------------------------------------------ */
/* Files — rename, order                                              */
/* ------------------------------------------------------------------ */

export async function patchFileFilename(fileId: string, filename: string): Promise<void> {
  await api.patch(`/files/${encodeURIComponent(fileId)}`, { filename });
}

export async function patchFileOrder(folderId: string, fileIds: string[]): Promise<void> {
  await api.patch(`/files/order/${encodeURIComponent(folderId)}`, { fileIds });
}

/**
 * Page notes — `GET|POST|PATCH|DELETE` under `/notes/:fileId` (Express, no `/api` prefix).
 *
 * - Auth: cookie session via axios `withCredentials: true` (Bearer may also be attached by interceptor).
 * - Wire JSON uses **1-based** `page` (same as the PDF viewer).
 * - List: `GET /notes/{fileId}` → array. One: `GET /notes/{fileId}/{noteId}`.
 * - Create: `POST /notes/{fileId}` body `{ page, body }` → 201 + note.
 * - Update: `PATCH /notes/{fileId}/{noteId}` with at least one of `page` | `body`.
 * - Delete: `DELETE /notes/{fileId}/{noteId}`.
 */
function notesPath(fileId: string, noteId?: string): string {
  const base = `/notes/${encodeURIComponent(fileId)}`;
  return noteId ? `${base}/${encodeURIComponent(noteId)}` : base;
}

export async function getNotes(fileId: string): Promise<NoteItem[]> {
  const { data } = await api.get<NoteItem[]>(notesPath(fileId));
  return data;
}

/** Single note (e.g. after a refetch by id). */
export async function getPageNote(fileId: string, noteId: string): Promise<NoteItem> {
  const { data } = await api.get<NoteItem>(notesPath(fileId, noteId));
  return data;
}

export interface CreateNotePayload {
  fileId: string;
  /** 1-based PDF page in the UI. */
  page: number;
  body: string;
}

export async function createNote(payload: CreateNotePayload): Promise<NoteItem> {
  const { data } = await api.post<NoteItem>(
    notesPath(payload.fileId),
    { page: payload.page, body: payload.body }
  );
  return data;
}

/**
 * Partial update (`PATCH`). Refetch notes or merge locally after success if the server returns 204.
 */
export async function updateNote(
  fileId: string,
  noteId: string,
  input: { body?: string; page?: number }
): Promise<void> {
  const patchBody: { body?: string; page?: number } = {};
  if (input.body !== undefined) patchBody.body = input.body;
  if (input.page !== undefined) patchBody.page = input.page;
  if (Object.keys(patchBody).length === 0) {
    throw new Error("updateNote: provide at least one of page or body");
  }
  await api.patch(notesPath(fileId, noteId), patchBody);
}

export async function deleteNote(fileId: string, noteId: string): Promise<void> {
  await api.delete(notesPath(fileId, noteId));
}

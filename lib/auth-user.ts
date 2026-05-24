import type { AuthUser, UserRole } from "@/lib/types";
import { parseUserStatus } from "@/lib/user-status";

type LooseUser = Record<string, unknown>;

function normalizeRole(value: unknown): UserRole {
  if (Array.isArray(value) && value.length > 0) {
    return normalizeRole(value[0]);
  }
  if (typeof value === "string") {
    const raw = value.trim();
    const r = (raw.includes(".") ? raw.split(".").pop() : raw)?.trim().toUpperCase() ?? "";
    if (r === "ADMIN" || r === "ADMINISTRATOR" || r === "SUPERADMIN" || r === "ROOT") {
      return "ADMIN";
    }
    if (r === "VIEWER" || r === "READONLY" || r === "READ_ONLY") {
      return "VIEWER";
    }
    if (r === "USER" || r === "MEMBER" || r === "STANDARD") {
      return "USER";
    }
  }
  if (typeof value === "number") {
    if (value === 1) return "ADMIN";
    if (value === 0) return "USER";
  }
  return "USER";
}

function stringifyJwtClaim(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/** Strip accidental `Bearer ` prefix when tokens are copied into JSON or storage. */
export function stripBearerPrefix(token: string): string {
  const s = token.trim();
  if (s.toLowerCase().startsWith("bearer ")) {
    return s.slice(7).trim();
  }
  return s;
}

/**
 * Maps common API shapes (camelCase, lowercase enums, alternate keys) to AuthUser.
 */
export function normalizeAuthUser(input: unknown): AuthUser | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const o = input as LooseUser;

  const idRaw = o.id ?? o.userId ?? o.sub;
  const id =
    typeof idRaw === "string"
      ? idRaw.trim()
      : typeof idRaw === "number" || typeof idRaw === "boolean"
        ? String(idRaw)
        : "";

  const emailRaw = o.email ?? o.mail;
  const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";

  const usernameRaw = o.username ?? o.userName;
  const username =
    typeof usernameRaw === "string" && usernameRaw.trim().length > 0 ? usernameRaw.trim() : undefined;

  const roleRaw = o.role ?? o.userRole ?? o.type ?? o.privilege;

  const status = parseUserStatus(o.status ?? o.userStatus ?? o.accountStatus);

  if (!id) {
    return null;
  }
  if (!email) {
    return null;
  }

  if (o.isAdmin === true || o.admin === true) {
    return {
      id,
      email,
      role: "ADMIN" as const,
      ...(username ? { username } : {}),
      ...(status ? { status } : {}),
    };
  }

  return {
    id,
    email,
    role: normalizeRole(roleRaw),
    ...(username ? { username } : {}),
    ...(status ? { status } : {}),
  };
}

export function isAdminUser(user: AuthUser | null | undefined): boolean {
  return user?.role === "ADMIN";
}

export function isViewerUser(user: AuthUser | null | undefined): boolean {
  return user?.role === "VIEWER";
}

/**
 * When HttpOnly cookies hide the JWT, UI still needs a stable AuthUser (role defaults until `/auth/me` or similar exists).
 */
export function minimalAuthUserFromEmail(email: string): AuthUser {
  const trimmed = email.trim().toLowerCase();
  const compact = Array.from(trimmed)
    .map((c) => c.charCodeAt(0).toString(16))
    .join("")
    .slice(0, 28);
  const id =
    compact.length >= 8 ? compact : `u-${trimmed.replace(/[^a-z0-9]+/gi, "-").slice(0, 24) || "session"}`;
  return {
    id,
    email: trimmed,
    role: "USER",
  };
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return atob(padded);
}

/**
 * Best-effort decode of JWT payload for UI (role/sub/email). Not verified — same as any client JWT read.
 * Access tokens often omit `email`; `fallbackEmail` or a synthetic placeholder is used.
 */
export function authUserFromAccessToken(token: string, fallbackEmail?: string): AuthUser | null {
  try {
    const raw = stripBearerPrefix(token);
    const parts = raw.split(".");
    if (parts.length < 2) {
      return null;
    }
    const json = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;

    const id =
      stringifyJwtClaim(
        json.sub ?? json.userId ?? json.id ?? json.uid ?? json.user_id ?? json.uuid,
      ) ||
      stringifyJwtClaim(json["nameIdentifier"]) ||
      stringifyJwtClaim(json["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"]);
    if (!id) {
      return null;
    }

    let email =
      stringifyJwtClaim(
        json.email ?? json.preferred_username ?? json.username ?? json.unique_name ?? json.upn,
      ) || (fallbackEmail?.trim() ? fallbackEmail.trim().toLowerCase() : "");

    if (!email) {
      email = `user-${id.slice(0, 24)}@session.local`;
    }

    const rolesArray = Array.isArray(json.roles) ? json.roles[0] : json.roles;
    const statusFromJwt = parseUserStatus(json.status ?? json.userStatus ?? json.accountStatus);

    if (json.isAdmin === true || json.admin === true) {
      return {
        id,
        email,
        role: "ADMIN" as const,
        ...(statusFromJwt ? { status: statusFromJwt } : {}),
      };
    }
    return {
      id,
      email,
      role: normalizeRole(
        json.role ??
        json.userRole ??
        json.privilege ??
        rolesArray ??
        json["https://example.com/role"] ??
        json["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"],
      ),
      ...(statusFromJwt ? { status: statusFromJwt } : {}),
    };
  } catch {
    return null;
  }
}

function stringifyId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * Prefer **`user`** object or root **`role` / `email` / `userId`** from auth JSON.
 * Does **not** read HttpOnly cookies. Optional JWT in **`accessToken`** body field is decoded only when present.
 */
export function resolveAuthUserFromCredentialResponse(payload: unknown, fallbackEmail: string): AuthUser {
  const emailFallback = fallbackEmail.trim().toLowerCase() || "user@session.local";

  if (!payload || typeof payload !== "object") {
    return minimalAuthUserFromEmail(emailFallback);
  }

  const r = payload as LooseUser;

  const usernameFlatRawEarly = r.username ?? r.userName;
  const usernameFlatEarly =
    typeof usernameFlatRawEarly === "string" && usernameFlatRawEarly.trim().length > 0
      ? usernameFlatRawEarly.trim()
      : undefined;

  const nested = normalizeAuthUser(r.user ?? null);
  if (nested) {
    if (usernameFlatEarly && !nested.username?.trim()) {
      return { ...nested, username: usernameFlatEarly };
    }
    return nested;
  }

  const id = stringifyId(r.userId ?? r.id ?? r.sub);
  const emailRaw = r.email ?? r.mail;
  const email =
    typeof emailRaw === "string" && emailRaw.trim()
      ? emailRaw.trim().toLowerCase()
      : emailFallback;

  const roleRaw = r.role ?? r.userRole ?? r.privilege;
  const statusFlat = parseUserStatus(r.status ?? r.userStatus ?? r.accountStatus);

  const usernameFlat = usernameFlatEarly;

  if (id && email) {
    return {
      id,
      email,
      role: normalizeRole(roleRaw),
      ...(usernameFlat ? { username: usernameFlat } : {}),
      ...(statusFlat ? { status: statusFlat } : {}),
    };
  }

  if (roleRaw != null) {
    const base = minimalAuthUserFromEmail(emailFallback);
    return {
      ...base,
      role: normalizeRole(roleRaw),
      ...(usernameFlat ? { username: usernameFlat } : {}),
      ...(statusFlat ? { status: statusFlat } : {}),
    };
  }

  const token =
    typeof r.accessToken === "string"
      ? r.accessToken
      : typeof r.newAccessToken === "string"
        ? r.newAccessToken
        : undefined;
  if (token?.trim()) {
    const fromJwt = authUserFromAccessToken(token.trim(), emailFallback);
    if (fromJwt) {
      return {
        ...fromJwt,
        ...(usernameFlat ? { username: usernameFlat } : {}),
      };
    }
  }

  return {
    ...minimalAuthUserFromEmail(emailFallback),
    ...(usernameFlat ? { username: usernameFlat } : {}),
  };
}

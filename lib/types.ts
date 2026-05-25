export type UserRole = "ADMIN" | "USER" | "VIEWER";

export type UserStatus = "WAITING" | "APPROVED" | "REJECTED";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  username?: string;
  status?: UserStatus;
}

export interface AuthTokens {
  accessToken: string;
  csrfToken?: string;
}

export interface SignInResponse {
  message: string | undefined;
  accessToken: string;
  user?: AuthUser;
  role?: UserRole;
}

export interface FolderFile {
  id: string;
  filename: string;
  createdAt: string;
  /** Server order within the folder (lower first). Omitted on older APIs. */
  sortOrder?: number;
}

export interface Folder {
  id: string;
  foldername: string;
  lock?: boolean;
  /** Shelf spine color (hex). Set on create; persisted when the API supports it. */
  spineColor?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Server sort index (lowest first). */
  order?: number;
  /** @deprecated prefer `order` if present */
  sortOrder?: number;
  files: FolderFile[];
}

export interface FileDetails {
  id: string;
  filename: string;
  folderId: string;
  createdAt: string;
  content?: string[];
  fileUrl?: string;
}

/** GET `/files/pdf/:fileId` — presigned S3 URL for viewer and downloads. */
export interface PdfPresignedUrlResponse {
  url: string;
  filename?: string;
  /** Presigned URL lifetime in seconds from the backend (e.g. 300). */
  expiresIn?: number;
}

export interface SearchResult {
  id: string; // unique result row id
  fileId: string;
  filename: string;
  page: number;
  snippet: string;
}

export interface AppUser {
  id: string;
  email: string;
  role: UserRole;
  /** Display / login handle — aligned with POST signup payloads. */
  username?: string;
  status?: UserStatus;
  password?: string;
  passwordHash?: string;
  refreshToken?: string;
  accessToken?: string;
  createdAt?: string;
  /** OAuth / SSO hints from API (admin listings, profile). */
  authProvider?: string;
  provider?: string;
  oauthProvider?: string;
  signInProvider?: string;
  googleId?: string;
  googleSub?: string;
  /** When false, account has no local password (e.g. OAuth-only). */
  hasLocalPassword?: boolean;
}

export interface BookmarkItem {
  id: string;
  fileId: string;
  page: number;
  color?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Backend `Highlight` row — text the user marked on a specific page of a file. */
export interface HighlightItem {
  id: string;
  fileId: string;
  page: number;
  /** Selected text (verbatim). Used both for display in lists and for visual restoration on the page. */
  text: string;
  /**
   * Palette key. Server stores it as a string so the catalog can grow without a migration;
   * the frontend normalizes anything outside `HIGHLIGHT_COLOR_OPTIONS` back to "yellow".
   */
  color?: string | null;
  /** Inclusive 0-based offset of the highlight start within the page's plain text (`Content.content`). */
  startOffset?: number | null;
  /** Exclusive end offset paired with `startOffset`. */
  endOffset?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Backend page note row (`GET|POST /notes/:fileId`, `GET|PATCH|DELETE /notes/:fileId/:noteId`). `page` is 1-based. */
export interface NoteItem {
  id: string;
  fileId: string;
  /** 1-based page index in the reader UI. */
  page: number;
  body: string;
  createdAt: string;
  updatedAt: string;
}

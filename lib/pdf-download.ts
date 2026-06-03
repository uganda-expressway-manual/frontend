import { getPdfViewerPresignedUrl } from "@/lib/api";

/**
 * Trigger a direct browser download of the PDF via a temporary `<a>` element.
 *
 * The browser fetches the bytes itself — no `fetch()` from JS, no `Blob`, no
 * `URL.createObjectURL`, no RAM cost on the client. Throws when the backend fails to
 * mint a presigned URL; callers should surface to the user.
 *
 * Backend contract: the presigned URL must be signed with `ResponseContentDisposition`
 * so S3 returns `Content-Disposition: attachment; filename="..."`. Without that header
 * the browser would ignore the `download` attribute on cross-origin URLs and open the
 * PDF inline in a new tab.
 */
export async function triggerDirectDownload(
  fileId: string,
  fallbackFilename?: string,
  signal?: AbortSignal,
): Promise<void> {
  const { url, filename } = await getPdfViewerPresignedUrl(fileId, signal, { download: true });

  const baseName = filename?.trim() || fallbackFilename?.trim() || `file-${fileId}`;
  const downloadName = baseName.toLowerCase().endsWith(".pdf") ? baseName : `${baseName}.pdf`;

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = downloadName;
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}

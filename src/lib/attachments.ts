/**
 * Helpers for links to uploaded attachments.
 *
 * Used by the two places that offer a "Download" button:
 * stock/_components/document-viewer.tsx and stock-entry-detail.tsx.
 */

/**
 * Turns an attachment URL into one the browser will save rather than display.
 *
 * The HTML `download` attribute only works when the file is served from the
 * same origin. Attachments now live on blob storage, which is a different
 * origin, so the browser ignores it and simply opens the file instead. Blob
 * storage answers that with `?download=1`, which makes it send the file back as
 * an attachment. Older entries still hold a same-origin "/uploads/..." path,
 * where the plain attribute already works — those are returned untouched.
 */
export function toDownloadUrl(fileUrl: string): string {
  if (!fileUrl.startsWith("http")) return fileUrl;
  return fileUrl.includes("?") ? `${fileUrl}&download=1` : `${fileUrl}?download=1`;
}

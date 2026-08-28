/**
 * Working out what a stored attachment URL refers to.
 *
 * Called by: src/lib/actions/stock.ts (recording, viewing and deleting
 * attachments).
 *
 * Attachments live in a PRIVATE Vercel Blob store, which matters in two ways.
 * The URL kept in `StockEntryAttachment.fileUrl` is not directly fetchable —
 * opening it without a signature gets you nothing — and the blob's own
 * `pathname` is the handle everything else needs, so it is recovered from that
 * URL rather than stored a second time in its own column.
 *
 * Three shapes of URL exist in the database:
 *
 *   https://<store>.private.blob.vercel-storage.com/stock/invoice-abc.pdf
 *   https://<store>.public.blob.vercel-storage.com/stock/invoice-abc.pdf   (older)
 *   /uploads/stock/1234-ab12.pdf                                           (oldest)
 *
 * The last predates blob storage entirely and points at a local file that no
 * longer exists on a serverless host. It is recognised only so the code can say
 * so plainly instead of failing in a confusing way.
 */

/** Any URL served by our own blob store, private or public. */
const BLOB_HOST = /^https:\/\/[a-z0-9-]+\.(private|public)\.blob\.vercel-storage\.com\//i;

/** True when this came from our blob store and not from somewhere on the web. */
export function isBlobUrl(fileUrl: string): boolean {
  return BLOB_HOST.test(fileUrl);
}

/** True for an attachment saved back when files were written to local disk. */
export function isLegacyLocalUpload(fileUrl: string): boolean {
  return fileUrl.startsWith("/uploads/");
}

/**
 * The blob's pathname — "stock/invoice-abc.pdf" — which is what signing needs.
 * Null for anything that is not one of our blob URLs.
 */
export function blobPathnameOf(fileUrl: string): string | null {
  if (!isBlobUrl(fileUrl)) return null;
  try {
    // decodeURIComponent because a filename with a space arrives percent-encoded
    // in the URL but must be signed in its plain form.
    return decodeURIComponent(new URL(fileUrl).pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
}

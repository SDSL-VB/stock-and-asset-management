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

/**
 * Our own store's id, which is also its host name ("store_vABc…" is served at
 * https://vabc….private.blob.vercel-storage.com). From BLOB_STORE_ID, or from
 * the read-write token ("vercel_blob_rw_<id>_<secret>"). Null when neither is
 * set, as on a copy with no file storage.
 */
function ownStoreHost(): string | null {
  const id =
    process.env.BLOB_STORE_ID?.replace(/^store_/, "") ??
    process.env.BLOB_READ_WRITE_TOKEN?.match(/^vercel_blob_rw_([A-Za-z0-9]+)_/)?.[1];
  return id ? id.toLowerCase() : null;
}

/**
 * True only for a file in OUR blob store — not another Vercel store, and not
 * anywhere else on the web. Without the store pinned, anyone could record an
 * attachment pointing at a file of their choosing.
 */
export function isBlobUrl(fileUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    return false;
  }
  const match = url.protocol === "https:" && url.hostname.match(/^([a-z0-9-]+)\.(private|public)\.blob\.vercel-storage\.com$/i);
  if (!match) return false;
  const own = ownStoreHost();
  return own === null || match[1].toLowerCase() === own;
}

/**
 * The same file however its address was written: scheme, host and path only,
 * with any "?…" or "#…" dropped. Attachments are compared by this, so a copy
 * recorded with an extra query string cannot pass for a different file — or
 * be used to delete someone else's.
 */
export function canonicalBlobUrl(fileUrl: string): string {
  try {
    const url = new URL(fileUrl);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return fileUrl;
  }
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

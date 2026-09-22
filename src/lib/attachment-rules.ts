import { prisma } from "@/lib/prisma";
import { PERMISSIONS, resolveStockScope } from "@/lib/rbac/permissions";
import { isStockVisible } from "@/lib/stock-visibility";

/**
 * Who may add a document to a stock entry, and what documents are allowed.
 *
 * Called by: the upload route (src/app/api/upload/route.ts), which hands out
 * upload tokens, and the actions that record an upload afterwards
 * (checkAttachmentUpload / recordStockAttachment in stock.ts,
 * recordDeliveryAttachment in deliveries.ts). One rule, so the token and the
 * record can never disagree.
 *
 *   the entry   still editable (draft or sent back), visible to the person as
 *               on the stock list, and either theirs or they hold stock.edit —
 *               nobody attaches an invoice to somebody else's entry to satisfy
 *               its "required documents"
 *   the type    one of the configured attachment types; its size and file-type
 *               limits apply. An unknown type is refused rather than let
 *               through with no limits at all.
 */

type Person = {
  id: string;
  role: string;
  permissions: string[];
  departmentId?: string | null;
  locationId?: string | null;
};

export async function attachRefusal(user: Person, stockEntryId: string): Promise<string | null> {
  if (!user.permissions.includes(PERMISSIONS.STOCK_CREATE) && !user.permissions.includes(PERMISSIONS.STOCK_EDIT)) {
    return "You do not have permission to add attachments";
  }
  const entry = await prisma.stockEntry.findUnique({
    where: { id: stockEntryId },
    include: { issues: { select: { quantity: true, departmentId: true } } },
  });
  if (!entry || !isStockVisible(entry, user, resolveStockScope(user))) return "Stock entry not found";
  if (entry.status !== "DRAFT" && entry.status !== "REJECTED") return "Cannot upload to submitted or approved entries";
  if (entry.createdById !== user.id && !user.permissions.includes(PERMISSIONS.STOCK_EDIT)) {
    return "You can only add documents to entries you booked in";
  }
  return null;
}

/** Used only when no attachment types are configured at all. */
const FALLBACK = {
  maxSizeBytes: 10 * 1024 * 1024,
  allowed: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
};

/** The limits for an attachment type, or a refusal when it is not a known one. */
export async function typeLimits(
  name: string
): Promise<{ error: string } | { maxSizeBytes: number; allowed: string[] }> {
  const config = await prisma.attachmentTypeConfig.findFirst({ where: { name, isActive: true } });
  if (config) {
    return {
      maxSizeBytes: config.maxSizeBytes,
      allowed: Array.isArray(config.allowedMimeTypes) ? (config.allowedMimeTypes as string[]) : [],
    };
  }
  const configured = await prisma.attachmentTypeConfig.count({ where: { isActive: true } });
  return configured === 0 ? FALLBACK : { error: `"${name}" is not one of the document types` };
}

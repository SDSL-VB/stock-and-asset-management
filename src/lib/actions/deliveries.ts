"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requirePermission, requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, resolveStockScope } from "@/lib/rbac/permissions";
import { isStockVisible } from "@/lib/stock-visibility";
import { nextReference } from "@/lib/reference-numbers";
import { canonicalBlobUrl, isBlobUrl } from "@/lib/blob-urls";
import { attachRefusal, typeLimits } from "@/lib/attachment-rules";
import { checkOrderLineCapacity } from "@/lib/procurement-delivery";
import { approveStockEntry, rejectStockEntry, submitStockEntry } from "./stock";
import { logActivity } from "@/lib/activity-log";
import { rackField } from "@/lib/validations/stock";
import { normalizeRack } from "@/lib/racks";

/**
 * FLOW: a delivery — several products that arrived together, booked in at once.
 *
 *   1. createDelivery         the vendor, invoice number and site once, then a
 *                             line per product — any categories, each with its
 *                             own quantity, price and (optionally) the order
 *                             line it arrived against. Every line becomes an
 *                             ordinary DRAFT stock entry, all sharing one DLV-
 *                             number.
 *   2. recordDeliveryAttachment
 *                             one upload (the invoice) is attached to every line,
 *                             so each entry carries its documents exactly as a
 *                             single entry would.
 *   3. submitDelivery         submits every draft line: the same checks as a
 *                             single entry (documents, what an order is still
 *                             owed), one by one.
 *   4. approveDelivery        signs off every line waiting at its current step.
 *      sendBackDelivery       or sends them all back to their author with a reason.
 *
 * Why lines stay separate entries: availability, moving stock into a
 * department, builds, dispatch, write-offs and purchase-order delivery all work
 * per entry. A delivery only groups them for the four steps above, so none of
 * that had to change — and any single line can still be opened, edited while a
 * draft, or approved on its own page.
 */

const lineSchema = z.object({
  productId: z.string().min(1, "Every line needs a product"),
  quantity: z.number().int("Whole units only").positive("Every quantity must be at least 1"),
  unitPrice: z.number().positive("Every line needs a unit price above zero"),
  batchNumber: z.string().trim().max(60, "Batch number is too long").optional(),
  // Where this line is put away — each item may go to a different rack
  rackLocation: rackField,
  purchaseOrderLineId: z.string().optional(),
});

const deliverySchema = z.object({
  vendorId: z.string().min(1, "Pick the vendor"),
  invoiceNumber: z.string().trim().max(60).optional(),
  locationId: z.string().min(1, "Pick the site the goods arrived at"),
  lines: z.array(lineSchema).min(1, "Add at least one item").max(100, "Book at most 100 items at once"),
});

export async function createDelivery(data: unknown) {
  const user = await requirePermission(PERMISSIONS.STOCK_CREATE);

  const parsed = deliverySchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { vendorId, invoiceNumber, locationId, lines } = parsed.data;

  const [vendor, location, products] = await Promise.all([
    prisma.vendor.findUnique({ where: { id: vendorId } }),
    prisma.location.findUnique({ where: { id: locationId }, select: { id: true, isActive: true } }),
    prisma.product.findMany({
      where: { id: { in: lines.map((l) => l.productId) } },
      select: { id: true, name: true, code: true, isActive: true },
    }),
  ]);
  if (!vendor || !vendor.isActive) return { error: "Selected vendor not found" };
  if (!location || !location.isActive) return { error: "Selected site not found" };
  // Goods are booked in at your own site, unless you see every site
  if (resolveStockScope(user) !== "all" && locationId !== user.locationId) {
    return { error: "You can only book goods in at your own site" };
  }
  const productById = new Map(products.map((p) => [p.id, p]));
  const retired = lines.find((l) => !productById.get(l.productId)?.isActive);
  if (retired) return { error: "One of the products is not in the catalog any more" };

  // An order line is checked against everything claimed from it in THIS
  // delivery too, so two lines cannot each take the whole outstanding amount.
  const claimed = new Map<string, number>();
  for (const line of lines) {
    if (!line.purchaseOrderLineId) continue;
    const total = (claimed.get(line.purchaseOrderLineId) ?? 0) + line.quantity;
    claimed.set(line.purchaseOrderLineId, total);
    const problem = await checkOrderLineCapacity(line.purchaseOrderLineId, line.productId, total);
    if (problem) return { error: `${productById.get(line.productId)?.name}: ${problem}` };
  }

  // The batch is only accepted from someone allowed to set one
  const canSetBatch = user.permissions.includes(PERMISSIONS.STOCK_BATCH_EDIT);

  const delivery = await prisma.$transaction(async (tx) => {
    const created = await tx.delivery.create({
      data: { deliveryNumber: await nextReference("DLV", tx) },
    });
    for (const line of lines) {
      const product = productById.get(line.productId)!;
      await tx.stockEntry.create({
        data: {
          // The transaction client, so each line sees the numbers before it
          entryNumber: await nextReference("SE", tx),
          deliveryId: created.id,
          productId: product.id,
          itemName: product.name,
          itemCode: product.code,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          totalPrice: line.quantity * line.unitPrice,
          invoiceNumber: invoiceNumber || null,
          locationId,
          batchNumber: canSetBatch ? line.batchNumber || null : null,
          rackLocation: normalizeRack(line.rackLocation),
          purchaseOrderLineId: line.purchaseOrderLineId || null,
          vendorId: vendor.id,
          supplierName: vendor.name,
          status: "DRAFT",
          createdById: user.id,
        },
      });
    }
    return created;
  });

  await logActivity(
    "CREATED",
    "StockEntry",
    delivery.id,
    `Booked in delivery ${delivery.deliveryNumber} from ${vendor.name}: ${lines.length} item${lines.length === 1 ? "" : "s"}`
  );

  revalidatePath("/stock");
  if (lines.some((l) => l.purchaseOrderLineId)) revalidatePath("/procurement");
  return { success: true, deliveryId: delivery.id, deliveryNumber: delivery.deliveryNumber };
}

/** One delivery with the lines this person may see; null when they see none. */
export async function getDelivery(id: string) {
  const user = await requireAnyPermission([PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_CREATE]);

  const delivery = await prisma.delivery.findUnique({
    where: { id },
    include: {
      entries: {
        orderBy: { entryNumber: "asc" },
        include: {
          product: { select: { code: true, name: true, unit: true, category: { select: { name: true } } } },
          location: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          purchaseOrderLine: { select: { purchaseOrder: { select: { poNumber: true } } } },
          attachments: {
            select: { id: true, fileName: true, fileUrl: true, mimeType: true, attachmentType: true, createdAt: true },
            orderBy: { createdAt: "asc" },
          },
          approvals: { select: { stepOrder: true, stepLabel: true, status: true }, orderBy: { stepOrder: "asc" } },
          // What the visibility rule needs to judge department holdings
          issues: { select: { departmentId: true, quantity: true } },
        },
      },
    },
  });
  if (!delivery) return null;

  // Each line is judged exactly as the entry would be on its own page
  const scope = resolveStockScope(user);
  const entries = delivery.entries.filter((e) => isStockVisible(e, user, scope));
  if (entries.length === 0) return null;

  // The same upload sits on every line; show each file once
  const files = new Map<string, (typeof entries)[number]["attachments"][number]>();
  for (const entry of entries) for (const a of entry.attachments) if (!files.has(a.fileUrl)) files.set(a.fileUrl, a);

  return { id: delivery.id, deliveryNumber: delivery.deliveryNumber, createdAt: delivery.createdAt, entries, files: [...files.values()] };
}

/** Attach one uploaded file (an invoice, say) to every editable line. */
export async function recordDeliveryAttachment(input: {
  deliveryId: string;
  attachmentType: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
}) {
  const user = await requireAnyPermission([PERMISSIONS.STOCK_CREATE, PERMISSIONS.STOCK_EDIT]);

  // Only ever accept a URL that came from our own blob store
  if (!isBlobUrl(input.fileUrl)) return { error: "That file did not come from our storage" };

  const entries = await prisma.stockEntry.findMany({
    where: { deliveryId: input.deliveryId, status: { in: ["DRAFT", "REJECTED"] } },
    select: { id: true },
  });
  if (entries.length === 0) return { error: "Nothing in this delivery can take documents any more" };
  // Every line it lands on must be one this person may add documents to
  for (const e of entries) {
    const refusal = await attachRefusal(user, e.id);
    if (refusal) return { error: refusal };
  }
  if ("error" in (await typeLimits(input.attachmentType))) return { error: "That is not one of the document types" };

  const delivery = await prisma.delivery.findUnique({ where: { id: input.deliveryId }, select: { deliveryNumber: true } });
  await prisma.stockEntryAttachment.createMany({
    data: entries.map((e) => ({
      fileName: input.fileName,
      fileUrl: canonicalBlobUrl(input.fileUrl),
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      attachmentType: input.attachmentType,
      stockEntryId: e.id,
      uploadedById: user.id,
    })),
  });

  await logActivity(
    "CREATED",
    "StockEntryAttachment",
    input.deliveryId,
    `Attached ${input.fileName} to delivery ${delivery?.deliveryNumber} (${entries.length} item${entries.length === 1 ? "" : "s"})`
  );

  revalidatePath(`/stock/delivery/${input.deliveryId}`);
  revalidatePath("/stock");
  return { success: true };
}

/** Take a file off every editable line of the delivery. */
export async function removeDeliveryAttachment(deliveryId: string, fileUrl: string) {
  const user = await requireAnyPermission([PERMISSIONS.STOCK_CREATE, PERMISSIONS.STOCK_EDIT]);
  fileUrl = canonicalBlobUrl(fileUrl);

  const rows = await prisma.stockEntryAttachment.findMany({
    where: { fileUrl, stockEntry: { deliveryId, status: { in: ["DRAFT", "REJECTED"] } } },
    select: { id: true, uploadedById: true, fileName: true },
  });
  if (rows.length === 0) return { error: "That file is not on any line that can still change" };
  if (rows.some((r) => r.uploadedById !== user.id) && resolveStockScope(user) !== "all") {
    return { error: "You can only remove files you uploaded" };
  }

  await prisma.stockEntryAttachment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });

  // The stored file goes only when nothing points at it any more
  const stillUsed = await prisma.stockEntryAttachment.count({ where: { fileUrl } });
  if (stillUsed === 0 && fileUrl.startsWith("http")) {
    const { del } = await import("@vercel/blob");
    try {
      await del(fileUrl);
    } catch {
      // Already gone, or no token locally — the rows are what matter
    }
  }

  await logActivity("DELETED", "StockEntryAttachment", deliveryId, `Removed ${rows[0].fileName} from a delivery`);
  revalidatePath(`/stock/delivery/${deliveryId}`);
  return { success: true };
}

/**
 * Submit every draft line this person booked in — and every line that was sent
 * back, which returns to draft first (the same thing saving an edit does). On a
 * delivery the fix is often just a better invoice, attached once for all.
 */
export async function submitDelivery(deliveryId: string) {
  const user = await requirePermission(PERMISSIONS.STOCK_CREATE);

  const mine = { deliveryId, createdById: user.id };
  await prisma.stockEntry.updateMany({
    where: { ...mine, status: "REJECTED" },
    data: { status: "DRAFT" },
  });
  const drafts = await prisma.stockEntry.findMany({
    where: { ...mine, status: "DRAFT" },
    select: { id: true, itemName: true },
    orderBy: { entryNumber: "asc" },
  });
  if (drafts.length === 0) return { error: "Nothing here is waiting to be submitted" };

  // The same checks a single entry gets, line by line. A line that fails stays
  // a draft and is named; the rest go ahead.
  const failed: string[] = [];
  for (const entry of drafts) {
    const res = await submitStockEntry(entry.id);
    if (res && "error" in res && res.error) failed.push(`${entry.itemName}: ${res.error}`);
  }

  revalidatePath(`/stock/delivery/${deliveryId}`);
  if (failed.length === drafts.length) return { error: failed[0] };
  return { success: true, submitted: drafts.length - failed.length, failed };
}

/** The first step still waiting on each submitted line. */
async function waitingSteps(deliveryId: string) {
  const entries = await prisma.stockEntry.findMany({
    where: { deliveryId, status: "SUBMITTED" },
    select: {
      id: true,
      itemName: true,
      approvals: { where: { status: "PENDING" }, select: { stepOrder: true }, orderBy: { stepOrder: "asc" }, take: 1 },
    },
    orderBy: { entryNumber: "asc" },
  });
  return entries.filter((e) => e.approvals.length > 0).map((e) => ({ id: e.id, itemName: e.itemName, stepOrder: e.approvals[0].stepOrder }));
}

/**
 * Sign off every line waiting for approval. Each goes through the single-entry
 * approval, so the same rules hold — the site the goods arrived at, and nobody
 * approving their own entry.
 */
export async function approveDelivery(deliveryId: string, comments?: string) {
  await requirePermission(PERMISSIONS.STOCK_APPROVE);

  const waiting = await waitingSteps(deliveryId);
  if (waiting.length === 0) return { error: "Nothing here is waiting for approval" };

  const failed: string[] = [];
  for (const line of waiting) {
    const res = await approveStockEntry(line.id, line.stepOrder, comments);
    if (res && "error" in res && res.error) failed.push(`${line.itemName}: ${res.error}`);
  }

  revalidatePath(`/stock/delivery/${deliveryId}`);
  if (failed.length === waiting.length) return { error: failed[0] };
  return { success: true, approved: waiting.length - failed.length, failed };
}

/** Send every waiting line back to its author, with one reason. */
export async function sendBackDelivery(deliveryId: string, reason: string) {
  await requirePermission(PERMISSIONS.STOCK_APPROVE);
  if (!reason.trim()) return { error: "Say what needs fixing" };

  const waiting = await waitingSteps(deliveryId);
  if (waiting.length === 0) return { error: "Nothing here is waiting for approval" };

  const failed: string[] = [];
  for (const line of waiting) {
    const res = await rejectStockEntry(line.id, line.stepOrder, reason.trim());
    if (res && "error" in res && res.error) failed.push(`${line.itemName}: ${res.error}`);
  }

  revalidatePath(`/stock/delivery/${deliveryId}`);
  if (failed.length === waiting.length) return { error: failed[0] };
  return { success: true, sentBack: waiting.length - failed.length, failed };
}

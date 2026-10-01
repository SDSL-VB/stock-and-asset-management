"use server";

import { prisma } from "@/lib/prisma";
import { directEntryRefusal } from "@/lib/made-products";
import { approvalRefusal } from "@/lib/review-rules";
import { findApprovalFlow, NO_FLOW_CONFIGURED } from "@/lib/approval-flow";
import type { ProductKind } from "@prisma/client";
import { SERVICEABLE_KINDS } from "@/lib/vocabulary";
import { nextReference } from "@/lib/reference-numbers";
import {
  requireAnyPermission,
  requirePermission,
  requireAuth,
  resolveStockScope,
} from "@/lib/rbac/check";
import { stockCandidatesWhere, isStockVisible, maySeeEntryMoney, crossSiteRefusal } from "@/lib/stock-visibility";
import {
  availableQuantity,
  availabilityInclude,
  committingDispatchItemsWhere,
  committingBuildConsumptionsWhere,
  centralWriteOffsWhere,
} from "@/lib/stock-availability";
import {
  PERMISSIONS,
  STOCK_ENTRIES_PAGE_PERMISSIONS,
} from "@/lib/rbac/permissions";
import {
  createStockEntrySchema,
  updateStockEntrySchema,
  moveStockToDepartmentSchema,
} from "@/lib/validations/stock";
import { raiseClientDispatchForEntry } from "./client-dispatch";
import { checkOrderLineCapacity, syncPurchaseOrderFromEntry } from "@/lib/procurement-delivery";
import { logActivity } from "@/lib/activity-log";
import { isBlobUrl, isLegacyLocalUpload, blobPathnameOf, canonicalBlobUrl } from "@/lib/blob-urls";
import { attachRefusal, typeLimits } from "@/lib/attachment-rules";
import { issueSignedToken, presignUrl } from "@vercel/blob";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { syncBomWatches } from "@/lib/low-stock-bom";
import { normalizeRack } from "@/lib/racks";
import { lockEntries } from "@/lib/stock-locks";
import { hideMoney } from "@/lib/hide-money";
import { entryDecided, entrySubmitted } from "@/lib/notifications/events";

/**
 * FLOW: goods arriving — booked in, submitted, approved, then moved.
 *
 *   1. createStockEntry      an operator records what turned up, as a DRAFT.
 *                            Fresh stock, or booked against a purchase order
 *                            line, which fills in product, vendor and site.
 *   2. submitStockEntry      required documents are checked, the approval flow
 *                            is snapshotted onto the entry, status → SUBMITTED.
 *                            This is the moment goods count as DELIVERED against
 *                            an order.
 *   3. approveStockEntry     someone holding stock.approve, at the site the
 *                            goods arrived at, signs it off → APPROVED. Stock
 *                            is now real and available.
 *      rejectStockEntry      or sends it back to DRAFT with a reason, which
 *                            also re-opens any order that auto-closed.
 *   4. moveStockToDepartment approved central stock moves into a department,
 *                            as stock or as an asset. The same StockIssue a
 *                            transfer request produces.
 *
 * Everything before step 3 is reversible by editing. After it, stock moves by
 * issue, dispatch or build, never by changing the entry.
 */

/**
 * Goods are booked in at your own site, unless you see every site — and only
 * at a site still in use.
 */
async function bookingSiteRefusal(
  user: Awaited<ReturnType<typeof requireAuth>>,
  locationId: string | null
): Promise<string | null> {
  if (resolveStockScope(user) !== "all" && locationId !== user.locationId) {
    return "You can only book goods in at your own site";
  }
  if (!locationId) return null;
  const site = await prisma.location.findUnique({ where: { id: locationId }, select: { isActive: true } });
  return site?.isActive ? null : "That site is not in use";
}

/** A caller's own site, inherited from their department. Null for admins. */
async function getCallerLocationId(user: {
  departmentId?: string | null;
}): Promise<string | null> {
  if (!user.departmentId) return null;
  const department = await prisma.department.findUnique({
    where: { id: user.departmentId },
    select: { locationId: true },
  });
  return department?.locationId ?? null;
}

export async function getStockEntries() {
  const user = await requireAnyPermission(STOCK_ENTRIES_PAGE_PERMISSIONS);

  // How much stock this person may see, and the query that narrows to it.
  // The query is deliberately loose; isStockVisible finishes the job below.
  const scope = resolveStockScope(user);

  const entries = await prisma.stockEntry.findMany({
    where: stockCandidatesWhere(user, scope),
    include: {
      // kind and category id are what the stock list filters on — "raw
      // materials at Hyderabad, received against an order" is three fields.
      product: {
        select: {
          id: true,
          code: true,
          name: true,
          kind: true,
          category: { select: { id: true, name: true } },
        },
      },
      serviceClient: { select: { name: true } },
      location: { select: { id: true, name: true, code: true } },
      client: { select: { id: true, name: true, city: true, gstNumber: true, address: true } },
      warranty: true,
      department: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      issues: { select: { id: true, departmentId: true, quantity: true, department: { select: { name: true } } } },
      // The other three things that draw stock down. Without them the list
      // shows the quantity that ARRIVED and calls it what is here, so goods
      // dispatched to another site are counted at both ends at once.
      transferRequests: { where: { status: "PENDING" }, select: { quantity: true } },
      dispatchItems: { where: committingDispatchItemsWhere, select: { quantity: true } },
      buildConsumptions: { where: committingBuildConsumptionsWhere, select: { quantity: true } },
      // The fifth drawdown. Central write-offs only — a department's losses
      // come off its own holding, never off the entry as well.
      writeOffs: { where: centralWriteOffsWhere, select: { quantity: true, status: true } },
      attachments: { select: { id: true, fileName: true, fileUrl: true, mimeType: true, attachmentType: true }, orderBy: { createdAt: "asc" } },
      // Booked in with other items on one invoice — the list links to it
      delivery: { select: { id: true, deliveryNumber: true } },
      _count: { select: { attachments: true, approvals: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const visible = entries.filter((entry) => isStockVisible(entry, user, scope));
  // Prices leave the server only for those allowed to see them — decided per
  // entry, because an author sees the price they typed while it is theirs
  return visible.map((entry) => (maySeeEntryMoney(entry, user) ? entry : hideMoney(entry)));
}

export async function getStockEntryById(id: string) {
  const user = await requireAnyPermission(STOCK_ENTRIES_PAGE_PERMISSIONS);

  const entry = await prisma.stockEntry.findUnique({
    where: { id },
    include: {
      product: { select: { id: true, code: true, name: true, kind: true, category: { select: { id: true, name: true } } } },
      location: { select: { id: true, name: true, code: true } },
      client: { select: { id: true, name: true, city: true, gstNumber: true, address: true } },
      // The client a service item came from
      serviceClient: { select: { name: true, city: true } },
      warranty: true,
      department: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      approvedBy: { select: { id: true, name: true } },
      attachments: {
        include: { uploadedBy: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
      approvals: {
        include: { approver: { select: { id: true, name: true } } },
        orderBy: { stepOrder: "asc" },
      },
      issues: {
        include: {
          department: { select: { id: true, name: true } },
          issuedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      // What else has drawn this entry down — see availableQuantity. The page
      // used to subtract issues alone, so an entry whose goods had all been
      // dispatched still offered them to be moved again.
      dispatchItems: { where: committingDispatchItemsWhere, select: { quantity: true } },
      buildConsumptions: { where: committingBuildConsumptionsWhere, select: { quantity: true } },
      // The fifth drawdown: stock written off as damaged or lost. Only central
      // write-offs (stockIssueId null) touch this entry's figures — a
      // department's losses come off its own holding. Fetched in full here
      // because the detail page lists them, not just counts them.
      writeOffs: {
        where: centralWriteOffsWhere,
        include: { raisedBy: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
      transferRequests: {
        include: {
          department: { select: { id: true, name: true } },
          requestedBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      delivery: { select: { id: true, deliveryNumber: true } },
      // Set only on stock that arrived from another site, so the entry can say
      // which consignment brought it rather than looking like a fresh purchase.
      sourceDispatchItem: {
        select: {
          id: true,
          dispatch: {
            select: {
              id: true,
              dispatchNumber: true,
              receivedAt: true,
              originLocation: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!entry) return null;

  // Not visible is reported as not existing, so the detail page cannot be used
  // to confirm that an entry exists at another site.
  if (!isStockVisible(entry, user, resolveStockScope(user))) return null;
  return maySeeEntryMoney(entry, user) ? entry : hideMoney(entry);
}

/**
 * The service half of an entry, checked. A service item names the client it
 * came from, is something that can be serviced (made here or bought whole,
 * never raw material — see SERVICEABLE_KINDS), and does not also ship straight
 * to a client. An ordinary entry carries no service client.
 */
async function serviceFields(
  forService: boolean | undefined,
  serviceClientId: string | undefined,
  isDirectToClient: boolean | undefined,
  productKind: ProductKind
): Promise<
  { forService: boolean; serviceClientId: string | null; serviceClientName: string | null } | { error: string }
> {
  if (!forService) return { forService: false, serviceClientId: null, serviceClientName: null };
  if (isDirectToClient) {
    return { error: "A service item comes in from a client — it cannot also ship straight to one" };
  }
  if (!SERVICEABLE_KINDS.includes(productKind)) {
    return { error: "Raw material cannot come in for service — pick a finished or ready product" };
  }
  const client = serviceClientId
    ? await prisma.client.findUnique({
        where: { id: serviceClientId },
        select: { id: true, name: true, isActive: true },
      })
    : null;
  if (!client || !client.isActive) return { error: "Select the client this came from" };
  return { forService: true, serviceClientId: client.id, serviceClientName: client.name };
}

export async function createStockEntry(data: unknown) {
  const user = await requirePermission(PERMISSIONS.STOCK_CREATE);

  const parsed = createStockEntrySchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const {
    productId,
    quantity,
    unitPrice,
    locationId,
    isDirectToClient,
    clientId,
    vendorId,
    batchNumber,
    rackLocation,
    supplierName: _sn,
    clientName: _cn,
    clientLocation: _cl,
    forService,
    serviceClientId,
    isAsset: requestedAsset,
    ...rest
  } = parsed.data;
  // Whether goods are an asset is the Stock Manager's call (stock.classify);
  // anyone else books them in as stock
  const isAsset = user.permissions.includes(PERMISSIONS.STOCK_CLASSIFY) ? requestedAsset ?? false : false;

  // Goods that ship straight to a client never reach a warehouse, so the form
  // does not ask where they arrived. They still belong to a site for the books,
  // and the creator's own site is the only sensible answer.
  const effectiveLocationId = isDirectToClient
    ? locationId || (await getCallerLocationId(user))
    : locationId ?? null;

  const siteRefusal = await bookingSiteRefusal(user, effectiveLocationId);
  if (siteRefusal) return { error: siteRefusal };

  // The batch is only accepted from someone allowed to set one
  const canSetBatch = user.permissions.includes(PERMISSIONS.STOCK_BATCH_EDIT);
  const effectiveBatch = canSetBatch ? batchNumber?.trim() || null : undefined;

  // A service item comes from a client, not a vendor, so it has no vendor
  const vendor = forService
    ? null
    : await prisma.vendor.findUnique({ where: { id: vendorId ?? "" } });
  if (!forService && (!vendor || !vendor.isActive)) {
    return { error: "Selected vendor not found" };
  }

  // Client name and city are snapshotted from the master so a later rename
  // never rewrites history.
  const client =
    isDirectToClient && clientId
      ? await prisma.client.findUnique({ where: { id: clientId } })
      : null;
  if (isDirectToClient && !client) {
    return { error: "Selected client not found" };
  }

  // Item name and code are always taken from the catalog, never from the client
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || !product.isActive) {
    return { error: "Selected product not found in the catalog" };
  }

  const service = await serviceFields(forService, serviceClientId, isDirectToClient, product.kind);
  if ("error" in service) return service;
  if (!service.forService) {
    const madeRefusal = await directEntryRefusal(user, [product.id]);
    if (madeRefusal) return { error: madeRefusal };
  }

  // Booked against a purchase order, if the operator said so. Checked rather
  // than trusted: the line has to be live, for this product, and still owed
  // enough — otherwise an order silently over-receives.
  if (rest.purchaseOrderLineId) {
    const problem = await checkOrderLineCapacity(
      rest.purchaseOrderLineId,
      productId,
      quantity
    );
    if (problem) return { error: problem };
  }

  const totalPrice = quantity * unitPrice;
  const entryNumber = await nextReference("SE");

  const entry = await prisma.stockEntry.create({
    data: {
      entryNumber,
      ...rest,
      productId,
      itemName: product.name,
      itemCode: product.code,
      quantity,
      unitPrice,
      totalPrice,
      locationId: effectiveLocationId,
      ...(effectiveBatch !== undefined ? { batchNumber: effectiveBatch } : {}),
      rackLocation: normalizeRack(rackLocation),
      // For a service item the "supplier" is the client it came from, and
      // there is no vendor invoice
      vendorId: vendor?.id ?? null,
      supplierName: vendor?.name ?? service.serviceClientName ?? "",
      ...(forService ? { invoiceNumber: null } : {}),
      clientId: client?.id ?? null,
      clientName: client?.name ?? null,
      clientLocation: client?.city ?? null,
      forService: service.forService,
      serviceClientId: service.serviceClientId,
      isAsset,
      status: "DRAFT",
      createdById: user.id,
      customFields: rest.customFields ? JSON.parse(JSON.stringify(rest.customFields)) : undefined,
    },
  });

  await logActivity(
    "CREATED",
    "StockEntry",
    entry.id,
    `Created stock entry ${entry.entryNumber} for ${entry.itemName}`
  );

  revalidatePath("/stock");
  if (entry.purchaseOrderLineId) revalidatePath("/procurement");
  return { success: true, entry };
}

export async function updateStockEntry(id: string, data: unknown) {
  const user = await requireAnyPermission([PERMISSIONS.STOCK_EDIT, PERMISSIONS.STOCK_CREATE]);

  const entry = await prisma.stockEntry.findUnique({ where: { id } });
  if (!entry) return { error: "Stock entry not found" };

  // Only allow editing DRAFT or REJECTED entries
  if (entry.status !== "DRAFT" && entry.status !== "REJECTED") {
    return { error: "Only draft or rejected entries can be edited" };
  }

  // Only the creator (or someone whose stock scope covers everything) can edit
  const hasFullScope = resolveStockScope(user) === "all";
  if (entry.createdById !== user.id && !hasFullScope) {
    return { error: "You can only edit your own entries" };
  }

  // Somebody who cannot see this entry's price was shown no price to edit, so
  // the one that is validated and saved is the stored one — never whatever the
  // form happened to hold.
  const seesMoney = maySeeEntryMoney(entry, user);
  const input = seesMoney || typeof data !== "object" || data === null
    ? data
    : { ...(data as Record<string, unknown>), unitPrice: entry.unitPrice };

  const parsed = updateStockEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const {
    productId,
    quantity,
    unitPrice: submittedPrice,
    locationId,
    isDirectToClient,
    clientId,
    vendorId,
    batchNumber,
    rackLocation,
    supplierName: _sn,
    clientName: _cn,
    clientLocation: _cl,
    forService,
    serviceClientId,
    isAsset: requestedAsset,
    ...rest
  } = parsed.data;
  // Whether goods are an asset is the Stock Manager's call (stock.classify);
  // anyone else books them in as stock
  const isAsset = user.permissions.includes(PERMISSIONS.STOCK_CLASSIFY) ? requestedAsset ?? false : false;

  // A price this person cannot see is a price they cannot change. The form
  // they were given showed it masked as 0, so saving it would have written ₹0
  // over the real figure — keep what is stored instead.
  const unitPrice = seesMoney ? submittedPrice : entry.unitPrice;

  // Goods that ship straight to a client never reach a warehouse, so the form
  // does not ask where they arrived. They still belong to a site for the books,
  // and the creator's own site is the only sensible answer.
  const effectiveLocationId = isDirectToClient
    ? locationId || (await getCallerLocationId(user))
    : locationId ?? null;
  if (effectiveLocationId !== entry.locationId) {
    const siteRefusal = await bookingSiteRefusal(user, effectiveLocationId);
    if (siteRefusal) return { error: siteRefusal };
  }

  // The batch is only accepted from someone allowed to set one
  const canSetBatch = user.permissions.includes(PERMISSIONS.STOCK_BATCH_EDIT);
  const effectiveBatch = canSetBatch ? batchNumber?.trim() || null : undefined;

  // A service item comes from a client, not a vendor, so it has no vendor
  const vendor = forService
    ? null
    : await prisma.vendor.findUnique({ where: { id: vendorId ?? "" } });
  if (!forService && (!vendor || !vendor.isActive)) {
    return { error: "Selected vendor not found" };
  }

  // Client name and city are snapshotted from the master so a later rename
  // never rewrites history.
  const client =
    isDirectToClient && clientId
      ? await prisma.client.findUnique({ where: { id: clientId } })
      : null;
  if (isDirectToClient && !client) {
    return { error: "Selected client not found" };
  }

  // Item name and code are always taken from the catalog, never from the client
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || !product.isActive) {
    return { error: "Selected product not found in the catalog" };
  }

  const service = await serviceFields(forService, serviceClientId, isDirectToClient, product.kind);
  if ("error" in service) return service;
  // Switching an entry to a made product (or out of service stock) is booking
  // it in directly, so the same rule applies
  if (!service.forService && (product.id !== entry.productId || entry.forService)) {
    const madeRefusal = await directEntryRefusal(user, [product.id]);
    if (madeRefusal) return { error: madeRefusal };
  }

  // The same check as creating one. Editing used to accept the order line
  // straight from the form and validate none of it, so a rejected entry for 5
  // could be edited to 500 against the same line and resubmitted.
  if (rest.purchaseOrderLineId) {
    const problem = await checkOrderLineCapacity(
      rest.purchaseOrderLineId,
      productId,
      quantity,
      id
    );
    if (problem) return { error: problem };
  }

  const totalPrice = quantity * unitPrice;

  const updated = await prisma.stockEntry.update({
    where: { id },
    data: {
      ...rest,
      productId,
      itemName: product.name,
      itemCode: product.code,
      quantity,
      unitPrice,
      totalPrice,
      locationId: effectiveLocationId,
      ...(effectiveBatch !== undefined ? { batchNumber: effectiveBatch } : {}),
      rackLocation: normalizeRack(rackLocation),
      // For a service item the "supplier" is the client it came from, and
      // there is no vendor invoice
      vendorId: vendor?.id ?? null,
      supplierName: vendor?.name ?? service.serviceClientName ?? "",
      ...(forService ? { invoiceNumber: null } : {}),
      clientId: client?.id ?? null,
      clientName: client?.name ?? null,
      clientLocation: client?.city ?? null,
      forService: service.forService,
      serviceClientId: service.serviceClientId,
      isAsset,
      status: "DRAFT", // Reset to DRAFT if it was REJECTED
      rejectionReason: null,
      customFields: rest.customFields ? JSON.parse(JSON.stringify(rest.customFields)) : undefined,
    },
  });

  await logActivity(
    "UPDATED",
    "StockEntry",
    updated.id,
    `Updated stock entry ${updated.entryNumber}`
  );

  revalidatePath("/stock");
  revalidatePath(`/stock/${id}`);
  return { success: true, entry: updated };
}

export async function submitStockEntry(id: string) {
  const user = await requirePermission(PERMISSIONS.STOCK_CREATE);

  const entry = await prisma.stockEntry.findUnique({ where: { id } });
  if (!entry) return { error: "Stock entry not found" };

  if (entry.status !== "DRAFT") {
    return { error: "Only draft entries can be submitted" };
  }

  if (entry.createdById !== user.id) {
    return { error: "You can only submit your own entries" };
  }
  // A draft saved before its product gained a bill of materials
  if (entry.source === "PURCHASED" && !entry.forService && entry.productId) {
    const madeRefusal = await directEntryRefusal(user, [entry.productId]);
    if (madeRefusal) return { error: madeRefusal };
  }

  // Check required attachments. Not for a service item: those documents are
  // a vendor's (an invoice), and a service item came from a client.
  const requiredTypes = entry.forService
    ? []
    : await prisma.attachmentTypeConfig.findMany({
        where: { isRequired: true, isActive: true },
        select: { name: true },
      });

  if (requiredTypes.length > 0) {
    const attachments = await prisma.stockEntryAttachment.findMany({
      where: { stockEntryId: id },
      select: { attachmentType: true },
    });
    const uploadedTypes = new Set(attachments.map((a) => a.attachmentType));
    const missing = requiredTypes.filter((rt) => !uploadedTypes.has(rt.name));
    if (missing.length > 0) {
      return {
        error: `Required documents missing: ${missing.map((m) => m.name).join(", ")}. Please upload them before submitting.`,
      };
    }
  }

  // Submitting is the moment the goods start counting as delivered, so it is
  // also the last moment the order can refuse them. Two drafts could otherwise
  // each claim the whole outstanding quantity — the check on create passed for
  // both, because a draft counts as nothing until now.
  // productId is optional on the model for entries that predate the catalog;
  // anything booked against an order has one, since the form requires it.
  if (entry.purchaseOrderLineId && entry.productId) {
    const problem = await checkOrderLineCapacity(
      entry.purchaseOrderLineId,
      entry.productId,
      entry.quantity,
      entry.id
    );
    if (problem) return { error: problem };
  }

  const flow = await findApprovalFlow(entry.departmentId);
  if (!flow) {
    return { error: NO_FLOW_CONFIGURED };
  }

  // Raise what you may approve, and it is approved: someone who could press
  // Approve on this entry right now — the permission, and the entry at their
  // site and department — signs every step on submitting, recorded as the
  // approver. Anyone else's entry waits for its approvers as usual.
  const approvesOwn = approvalRefusal(entry, user) === null;

  // Snapshot the flow steps into approval records. A rejected entry that is
  // edited and resubmitted still has the previous round's approval rows, so
  // clear them first — the new submission starts a fresh approval cycle.
  await prisma.$transaction([
    prisma.stockApproval.deleteMany({ where: { stockEntryId: id } }),
    prisma.stockEntry.update({
      where: { id },
      data: approvesOwn
        ? { status: "APPROVED", approvedById: user.id }
        : { status: "SUBMITTED" },
    }),
    prisma.stockApproval.createMany({
      data: flow.steps.map((step) => ({
        stockEntryId: id,
        stepOrder: step.stepOrder,
        stepLabel: step.stepLabel,
        approverRoleId: step.approverRoleId,
        ...(approvesOwn
          ? { status: "APPROVED" as const, approverUserId: user.id, comments: "Approved on raising" }
          : { status: "PENDING" as const }),
      })),
    }),
  ]);

  await logActivity(
    approvesOwn ? "APPROVED" : "SUBMITTED",
    "StockEntry",
    id,
    approvesOwn
      ? `Submitted and approved stock entry ${entry.entryNumber} (raised by an approver)`
      : `Submitted stock entry ${entry.entryNumber} for approval`
  );

  // Submitting is the point the goods count as delivered, so this may be the
  // arrival that completes the order.
  if (entry.purchaseOrderLineId) {
    await syncPurchaseOrderFromEntry(entry.purchaseOrderLineId);
  }

  if (approvesOwn) {
    // Exactly what a final approval does — see approveStockEntry
    await raiseClientDispatchForEntry(id, user.id);
    after(() => syncBomWatches().catch((e) => console.error("Low-stock BOM sync failed:", e)));
    revalidatePath("/dashboard");
  } else {
    await entrySubmitted(entry);
  }

  revalidatePath("/stock");
  revalidatePath(`/stock/${id}`);
  return { success: true, approved: approvesOwn };
}


export async function approveStockEntry(id: string, stepOrder: number, comments?: string) {
  const user = await requireAnyPermission([PERMISSIONS.STOCK_APPROVE, PERMISSIONS.STOCK_SERVICE_APPROVE]);

  const entry = await prisma.stockEntry.findUnique({
    where: { id },
    include: { approvals: { orderBy: { stepOrder: "asc" } } },
  });

  if (!entry) return { error: "Stock entry not found" };
  if (entry.status !== "SUBMITTED") return { error: "Entry is not pending approval" };

  const refusal = approvalRefusal(entry, user);
  if (refusal) return { error: refusal };

  const approval = entry.approvals.find((a) => a.stepOrder === stepOrder);
  if (!approval) return { error: "Approval step not found" };
  if (approval.status !== "PENDING") return { error: "This step has already been processed" };
  // Steps are signed off in order — a later step cannot jump an earlier one
  if (entry.approvals.some((a) => a.stepOrder < stepOrder && a.status !== "APPROVED")) {
    return { error: "An earlier approval step is still waiting" };
  }

  await prisma.stockApproval.update({
    where: { id: approval.id },
    data: {
      status: "APPROVED",
      approverUserId: user.id,
      comments: comments || undefined,
    },
  });

  // Check if all steps are now approved
  const remainingPending = entry.approvals.filter(
    (a) => a.id !== approval.id && a.status === "PENDING"
  );

  if (remainingPending.length === 0) {
    await prisma.stockEntry.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedById: user.id,
      },
    });

    // Goods bought to go straight to a customer book in here and must then
    // leave again — without this they sit in stock and appear nowhere outgoing.
    await raiseClientDispatchForEntry(id, user.id);
    await entryDecided(entry, true);
  }

  await logActivity(
    "APPROVED",
    "StockEntry",
    id,
    `Approved step ${stepOrder} of stock entry ${entry.entryNumber}`
  );

  // Approving does not change how much has arrived — submitted already counted
  // — but the order is re-checked anyway, so its status is never left resting
  // on a status the entry has since moved on from.
  if (entry.purchaseOrderLineId) {
    await syncPurchaseOrderFromEntry(entry.purchaseOrderLineId);
  }

  // Approved stock of a BOM component means this site uses it — watch it here.
  // After the response, so approving is not held up by it.
  after(() => syncBomWatches().catch((e) => console.error("Low-stock BOM sync failed:", e)));

  revalidatePath("/stock");
  revalidatePath(`/stock/${id}`);
  revalidatePath("/dashboard");
  return { success: true };
}

/**
 * Rebuilds the approval steps of an entry that is waiting for approval but has
 * none recorded, so it can be signed off normally.
 *
 * Why this exists: the steps are snapshotted onto the entry when it is
 * submitted, and never again. An entry that reached SUBMITTED without that
 * snapshot — a status changed directly in the database, an interrupted
 * submission — has nothing to approve, so the Approve card renders for nobody,
 * and it cannot be edited, resubmitted or rejected either. It is stuck for
 * good, and no amount of granting permissions or editing the approval flow
 * reaches it, because neither is consulted after submission.
 *
 * Deliberately narrow: only an entry with NO steps at all, and only for someone
 * who would be allowed to approve it anyway — so this can never be used to wipe
 * a half-finished approval or to reach another site's goods.
 */
export async function rebuildApprovalSteps(id: string) {
  const user = await requireAnyPermission([PERMISSIONS.STOCK_APPROVE, PERMISSIONS.STOCK_SERVICE_APPROVE]);

  const entry = await prisma.stockEntry.findUnique({
    where: { id },
    include: { approvals: { select: { id: true } } },
  });

  if (!entry) return { error: "Stock entry not found" };
  if (entry.status !== "SUBMITTED") return { error: "Entry is not pending approval" };
  if (entry.approvals.length > 0) {
    return { error: "This entry already has approval steps" };
  }

  const refusal = approvalRefusal(entry, user);
  if (refusal) return { error: refusal };

  const flow = await findApprovalFlow(entry.departmentId);
  if (!flow) return { error: NO_FLOW_CONFIGURED };

  await prisma.stockApproval.createMany({
    data: flow.steps.map((step) => ({
      stockEntryId: id,
      stepOrder: step.stepOrder,
      stepLabel: step.stepLabel,
      approverRoleId: step.approverRoleId,
      status: "PENDING" as const,
    })),
  });

  await logActivity(
    "UPDATED",
    "StockEntry",
    id,
    `Rebuilt the approval steps of ${entry.entryNumber} from the "${flow.name}" flow`
  );

  revalidatePath("/stock");
  revalidatePath(`/stock/${id}`);
  revalidatePath("/dashboard");
  return { success: true, steps: flow.steps.length };
}

export async function rejectStockEntry(id: string, stepOrder: number, reason: string, comments?: string) {
  const user = await requireAnyPermission([PERMISSIONS.STOCK_APPROVE, PERMISSIONS.STOCK_SERVICE_APPROVE]);

  const entry = await prisma.stockEntry.findUnique({
    where: { id },
    include: { approvals: { orderBy: { stepOrder: "asc" } } },
  });

  if (!entry) return { error: "Stock entry not found" };
  if (entry.status !== "SUBMITTED") return { error: "Entry is not pending approval" };

  // Whoever books the entry back in has to know what to fix. The form asks for
  // one, but a server action is a real endpoint that can be called without it.
  if (!reason.trim()) return { error: "Rejection reason is required" };

  const refusal = approvalRefusal(entry, user);
  if (refusal) return { error: refusal };

  const approval = entry.approvals.find((a) => a.stepOrder === stepOrder);
  if (!approval) return { error: "Approval step not found" };
  if (approval.status !== "PENDING") return { error: "This step has already been processed" };

  await prisma.$transaction([
    prisma.stockApproval.update({
      where: { id: approval.id },
      data: {
        status: "REJECTED",
        approverUserId: user.id,
        comments: comments || undefined,
      },
    }),
    prisma.stockEntry.update({
      where: { id },
      data: {
        status: "REJECTED",
        rejectionReason: reason,
      },
    }),
  ]);

  await logActivity(
    "REJECTED",
    "StockEntry",
    id,
    `Rejected stock entry ${entry.entryNumber}: ${reason}`
  );

  // The goods are no longer delivered, so an order that closed itself when this
  // entry was submitted has to open again — otherwise the outstanding units
  // become invisible and nobody chases the vendor for them.
  if (entry.purchaseOrderLineId) {
    await syncPurchaseOrderFromEntry(entry.purchaseOrderLineId);
  }

  await entryDecided(entry, false, reason);

  revalidatePath("/stock");
  revalidatePath(`/stock/${id}`);
  revalidatePath("/dashboard");
  return { success: true };
}

/** How long a signed link to a document stays usable. */
const ATTACHMENT_LINK_MINUTES = 10;

/**
 * A temporary, signed link to one attachment, or an error explaining why not.
 *
 * Called by the three places a document is shown: document-viewer.tsx,
 * quick-docs-dialog.tsx and the download button in stock-entry-detail.tsx.
 *
 * Attachments live in a PRIVATE blob store, so `fileUrl` on its own fetches
 * nothing — which is the point. A link has to be signed for each viewing, and
 * the signature expires, so a URL copied out of the page stops working rather
 * than becoming a permanent public handle on an invoice.
 *
 * Permission is the same question as "may you see the entry": whoever can open
 * the stock entry can read its documents, and the scope rules that hide other
 * departments' stock hide their paperwork with it.
 */
export async function getAttachmentViewUrl(attachmentId: string) {
  const user = await requireAnyPermission(STOCK_ENTRIES_PAGE_PERMISSIONS);

  const attachment = await prisma.stockEntryAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      fileName: true,
      fileUrl: true,
      mimeType: true,
      stockEntry: {
        select: {
          status: true,
          forService: true,
          quantity: true,
          departmentId: true,
          locationId: true,
          createdById: true,
          issues: { select: { departmentId: true, quantity: true } },
        },
      },
    },
  });
  if (!attachment) return { error: "Attachment not found" };

  // Exactly the rule getStockEntryById applies, so a document can never be
  // reachable by someone who cannot reach the entry it belongs to.
  if (!isStockVisible(attachment.stockEntry, user, resolveStockScope(user))) {
    return { error: "Attachment not found" };
  }

  if (isLegacyLocalUpload(attachment.fileUrl)) {
    return {
      error:
        "This document was uploaded before files moved to cloud storage and is no longer available. Please upload it again.",
    };
  }

  const pathname = blobPathnameOf(attachment.fileUrl);
  if (!pathname) return { error: "That file did not come from our storage" };

  try {
    const validUntil = Date.now() + ATTACHMENT_LINK_MINUTES * 60 * 1000;
    const signed = await issueSignedToken({
      pathname,
      operations: ["get"],
      validUntil,
    });
    const { presignedUrl } = await presignUrl(signed, {
      operation: "get",
      pathname,
      access: "private",
      validUntil,
    });
    return {
      url: presignedUrl,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { error: `Could not open that document: ${message}` };
  }
}

/**
 * Whether blob storage is usable, and if not, why — in words a person can act on.
 *
 * Returns null when everything looks right.
 *
 * The shape of the token matters as much as its presence. A read-write token
 * reads `vercel_blob_rw_<storeId>_<secret>`, and the SDK pulls the store id
 * straight out of it by splitting on underscores. Give it anything else — a
 * Vercel account token, a truncated paste, a placeholder — and it will happily
 * build a request with an empty store id, which Vercel's API rejects without
 * CORS headers. The browser then reports a *CORS error*, which says nothing at
 * all about the real problem. Hence checking the shape here.
 */
function describeStorageProblem(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (!token) {
    return "File storage is not set up on this deployment (BLOB_READ_WRITE_TOKEN is missing). Everything else works — only uploads are affected.";
  }

  const parts = token.split("_");
  const looksRight =
    token.startsWith("vercel_blob_rw_") && parts.length >= 5 && parts[3].length > 0;

  if (!looksRight) {
    return "The BLOB_READ_WRITE_TOKEN on this deployment is not a Blob store token (it should look like vercel_blob_rw_…). Create a Blob store in Vercel and use Connect Project rather than adding the variable by hand, then redeploy.";
  }

  return null;
}

/**
 * Answers "may I upload this, and will it work?" BEFORE the browser starts.
 *
 * Called by stock/_components/file-upload.tsx as its first step.
 *
 * This exists for one reason: the Blob client cannot show you why an upload was
 * refused. When /api/upload declines to issue a token, @vercel/blob throws away
 * the response body and reports a flat "Failed to retrieve the client token" —
 * so a missing permission, a submitted entry, a file too large and an
 * unconfigured storage account all looked identical.
 *
 * So the same questions are asked here first, where the answer can be a
 * sentence. /api/upload still asks them again when it issues the token; that
 * remains the real gate, because anything a browser is told it may do, a browser
 * may lie about. This is for the human.
 */
export async function checkAttachmentUpload(input: {
  stockEntryId: string;
  attachmentType: string;
  fileSize: number;
  mimeType: string;
}): Promise<{ error: string } | { ok: true }> {
  const user = await requireAuth();

  // Configuration, not the user's fault — so say so plainly rather than letting
  // it surface as a mysterious storage error a minute later.
  const storageProblem = describeStorageProblem();
  if (storageProblem) return { error: storageProblem };

  const refusal = await attachRefusal(user, input.stockEntryId);
  if (refusal) return { error: refusal };

  const limits = await typeLimits(input.attachmentType);
  if ("error" in limits) return limits;
  if (input.fileSize > limits.maxSizeBytes) {
    const mb = Math.round(limits.maxSizeBytes / 1024 / 1024);
    return { error: `That file is larger than the ${mb}MB limit for ${input.attachmentType}` };
  }
  if (limits.allowed.length > 0 && !limits.allowed.includes(input.mimeType)) {
    return {
      error: `${input.attachmentType} accepts ${limits.allowed.join(", ")} — not ${input.mimeType || "that file type"}`,
    };
  }

  return { ok: true };
}

/**
 * Records an attachment the browser has just uploaded to Blob storage.
 *
 * Called by stock/_components/file-upload.tsx, straight after the upload
 * finishes. The bytes never come through the server — /api/upload only issued
 * the token that allowed the browser to send them — so this is the step that
 * puts the row in the database.
 *
 * It re-checks everything rather than trusting the caller: the URL arrives from
 * the browser, and a browser can say anything. The permission, the entry's
 * status and the file's origin are all verified again here.
 */
export async function recordStockAttachment(input: {
  stockEntryId: string;
  attachmentType: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
}) {
  const user = await requireAnyPermission([
    PERMISSIONS.STOCK_CREATE,
    PERMISSIONS.STOCK_EDIT,
  ]);

  // Only ever accept a URL that came from our own blob store. Without this,
  // anyone could point an attachment at any address on the internet.
  if (!isBlobUrl(input.fileUrl)) {
    return { error: "That file did not come from our storage" };
  }

  const refusal = await attachRefusal(user, input.stockEntryId);
  if (refusal) return { error: refusal };
  if ("error" in (await typeLimits(input.attachmentType))) return { error: "That is not one of the document types" };
  const entry = await prisma.stockEntry.findUniqueOrThrow({
    where: { id: input.stockEntryId },
    select: { entryNumber: true },
  });

  const attachment = await prisma.stockEntryAttachment.create({
    data: {
      fileName: input.fileName,
      fileUrl: canonicalBlobUrl(input.fileUrl),
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      attachmentType: input.attachmentType,
      stockEntryId: input.stockEntryId,
      uploadedById: user.id,
    },
  });

  await logActivity(
    "CREATED",
    "StockEntryAttachment",
    attachment.id,
    `Attached ${input.fileName} to ${entry.entryNumber}`
  );

  revalidatePath("/stock");
  revalidatePath(`/stock/${input.stockEntryId}`);
  return { success: true, attachment };
}

export async function deleteAttachment(attachmentId: string) {
  const user = await requireAnyPermission([PERMISSIONS.STOCK_CREATE, PERMISSIONS.STOCK_EDIT]);

  const attachment = await prisma.stockEntryAttachment.findUnique({
    where: { id: attachmentId },
    include: { stockEntry: { select: { entryNumber: true, createdById: true, status: true } } },
  });

  if (!attachment) return { error: "Attachment not found" };

  if (attachment.uploadedById !== user.id && resolveStockScope(user) !== "all") {
    return { error: "You can only delete your own attachments" };
  }

  if (attachment.stockEntry.status !== "DRAFT" && attachment.stockEntry.status !== "REJECTED") {
    return { error: "Cannot delete attachments from submitted or approved entries" };
  }

  // Remove the stored file. Entries created before uploads moved to blob
  // storage still hold a "/uploads/..." path pointing at a local file that no
  // longer exists on a serverless host; there is nothing to delete for those.
  // A file uploaded once for a whole delivery is shared by every line, so it
  // stays while any other line still points at it.
  const sharedWith = await prisma.stockEntryAttachment.count({
    where: { fileUrl: attachment.fileUrl, id: { not: attachmentId } },
  });
  if (attachment.fileUrl.startsWith("http") && sharedWith === 0) {
    const { del } = await import("@vercel/blob");
    try {
      await del(attachment.fileUrl);
    } catch {
      // Already gone, or the token is missing locally. The database row is the
      // thing that matters, so carry on and delete it either way.
    }
  }

  await prisma.stockEntryAttachment.delete({ where: { id: attachmentId } });

  await logActivity(
    "DELETED",
    "StockEntryAttachment",
    attachmentId,
    `Deleted attachment ${attachment.fileName} from ${attachment.stockEntry.entryNumber}`
  );

  revalidatePath("/stock");
  revalidatePath(`/stock/${attachment.stockEntryId}`);
  return { success: true };
}

export async function getStockEntryStats() {
  const user = await requireAnyPermission(STOCK_ENTRIES_PAGE_PERMISSIONS);

  // Counted in memory rather than with SQL COUNTs, because the numbers have to
  // match the list exactly — and the list's last rule ("central stock at my
  // site that still has quantity left") is not expressible as a query.
  const scope = resolveStockScope(user);
  const entries = await prisma.stockEntry.findMany({
    where: stockCandidatesWhere(user, scope),
    select: {
      status: true,
      forService: true,
      quantity: true,
      departmentId: true,
      locationId: true,
      createdById: true,
      issues: { select: { departmentId: true, quantity: true } },
    },
  });

  const visible = entries.filter((entry) => isStockVisible(entry, user, scope));
  const count = (status: string) => visible.filter((e) => e.status === status).length;

  return {
    total: visible.length,
    drafts: count("DRAFT"),
    submitted: count("SUBMITTED"),
    approved: count("APPROVED"),
    rejected: count("REJECTED"),
  };
}

// Move approved stock from central stock into a department (the "second transaction").
// Partial moves are allowed; the remaining quantity stays in stock.
export async function moveStockToDepartment(stockEntryId: string, data: unknown) {
  const user = await requirePermission(PERMISSIONS.STOCK_MOVE);

  const parsed = moveStockToDepartmentSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const entry = await prisma.stockEntry.findUnique({
    where: { id: stockEntryId },
    // This copy used to leave out pending transfer requests, so moving stock
    // directly could take units somebody had already asked for and was waiting
    // on. The shared include counts all four drawdowns.
    include: {
      ...availabilityInclude,
      // The visibility rule also needs which department each issue went to
      issues: { select: { quantity: true, departmentId: true } },
    },
  });
  // Only stock you can see can be moved — as on the stock list
  if (!entry || !isStockVisible(entry, user, resolveStockScope(user))) return { error: "Stock entry not found" };

  if (entry.status !== "APPROVED") {
    return { error: "Only approved stock can be moved to a department" };
  }
  if (entry.forService) {
    return { error: "Service stock is held apart and cannot be moved into a department" };
  }

  const department = await prisma.department.findUnique({
    where: { id: parsed.data.departmentId },
  });
  if (!department || !department.isActive) {
    return { error: "Department not found or inactive" };
  }
  // Central stock is where stock comes FROM; a central-stock department is
  // never somewhere to move it to
  if (department.isCentralStock) {
    return { error: "That is central stock itself — pick the department the stock is going to" };
  }
  // Within the stock's own site, unless this person may move across sites
  const crossSite = crossSiteRefusal(entry, department, user);
  if (crossSite) return { error: crossSite };

  // Dispatched quantity has left the building too — it is not movable
  const remaining = availableQuantity(entry);
  if (parsed.data.quantity > remaining) {
    return {
      error: `Only ${remaining} of ${entry.quantity} units remain in stock for this entry`,
    };
  }

  const issueNumber = await nextReference("SI");

  // The check above gives a quick answer; the real one is here, with the entry
  // locked, so two moves at the same moment cannot both take the last units
  const issue = await prisma.$transaction(async (tx) => {
    await lockEntries(tx, [stockEntryId]);
    const fresh = await tx.stockEntry.findUniqueOrThrow({ where: { id: stockEntryId }, include: availabilityInclude });
    if (parsed.data.quantity > availableQuantity(fresh)) return null;
    return tx.stockIssue.create({
      data: {
        issueNumber,
        stockEntryId,
        departmentId: parsed.data.departmentId,
        quantity: parsed.data.quantity,
        // Lands as the entry is classified, unless the mover may classify
        isAsset: user.permissions.includes(PERMISSIONS.STOCK_CLASSIFY)
          ? parsed.data.isAsset ?? entry.isAsset
          : entry.isAsset,
        notes: parsed.data.notes?.trim() || null,
        issuedById: user.id,
      },
      include: { department: { select: { name: true } } },
    });
  });
  if (!issue) return { error: "Someone else has just taken some of that stock — check what is left and try again" };

  await logActivity(
    "ISSUED",
    "StockIssue",
    issue.id,
    `Moved ${issue.quantity} × ${entry.itemName} (${entry.entryNumber}) to ${issue.department.name}`
  );

  revalidatePath("/stock");
  revalidatePath(`/stock/${stockEntryId}`);
  revalidatePath("/dashboard");
  return { success: true, issue };
}

export async function getFieldConfigs() {
  await requireAuth();
  return prisma.stockEntryFieldConfig.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: "asc" },
  });
}

export async function getAttachmentTypeConfigs() {
  await requireAuth();
  return prisma.attachmentTypeConfig.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Classify central stock as an asset, or back as stock — the Stock Manager's
 * call (stock.classify), made while approving or once the goods are received.
 * Booking-in and dispatch never set it. What a department later receives
 * follows this.
 */
export async function setEntryAsset(entryId: string, isAsset: boolean) {
  const user = await requirePermission(PERMISSIONS.STOCK_CLASSIFY);
  if (typeof isAsset !== "boolean") return { error: "Say whether it is an asset" };

  const entry = await prisma.stockEntry.findUnique({
    where: { id: entryId },
    include: { issues: { select: { quantity: true, departmentId: true } } },
  });
  // Only what they may see, at their own site unless they see every site
  if (!entry || !isStockVisible(entry, user, resolveStockScope(user))) return { error: "Stock entry not found" };
  if (resolveStockScope(user) !== "all" && entry.locationId !== user.locationId) {
    return { error: "That stock is at another site" };
  }
  if (entry.status !== "SUBMITTED" && entry.status !== "APPROVED") {
    return { error: "Only stock waiting for approval or already approved can be classified" };
  }
  if (entry.departmentId !== null) return { error: "That stock already belongs to a department" };
  if (entry.forService) return { error: "Service stock is held apart and is never an asset" };

  await prisma.stockEntry.update({ where: { id: entryId }, data: { isAsset } });
  await logActivity(
    "UPDATED",
    "StockEntry",
    entryId,
    `Classified ${entry.entryNumber} (${entry.itemName}) as ${isAsset ? "an asset" : "stock"}`
  );
  revalidatePath(`/stock/${entryId}`);
  revalidatePath("/stock");
  revalidatePath("/assets");
  return { success: true };
}

"use server";

import { prisma } from "@/lib/prisma";
import { nextReference } from "@/lib/reference-numbers";
import {
  requireAnyPermission,
  requirePermission,
  requireSignedIn,
  resolveStockScope,
} from "@/lib/rbac/check";
import { stockCandidatesWhere, isStockVisible } from "@/lib/stock-visibility";
import {
  availableQuantity,
  availabilityInclude,
  committingDispatchItemsWhere,
  committingBuildConsumptionsWhere,
} from "@/lib/stock-availability";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  createStockEntrySchema,
  updateStockEntrySchema,
  moveStockToDepartmentSchema,
} from "@/lib/validations/stock";
import { raiseClientDispatchForEntry } from "./client-dispatch";
import { checkOrderLineCapacity, syncPurchaseOrderFromEntry } from "./procurement";
import { logActivity } from "./activity";
import { isBlobUrl, isLegacyLocalUpload, blobPathnameOf } from "@/lib/blob-urls";
import { issueSignedToken, presignUrl } from "@vercel/blob";
import { revalidatePath } from "next/cache";

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
  const user = await requireAnyPermission([PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_CREATE]);

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
      attachments: { select: { id: true, fileName: true, fileUrl: true, mimeType: true, attachmentType: true }, orderBy: { createdAt: "asc" } },
      _count: { select: { attachments: true, approvals: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return entries.filter((entry) => isStockVisible(entry, user, scope));
}

export async function getStockEntryById(id: string) {
  const user = await requireAnyPermission([PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_CREATE]);

  const entry = await prisma.stockEntry.findUnique({
    where: { id },
    include: {
      product: { select: { id: true, code: true, name: true, category: { select: { id: true, name: true } } } },
      location: { select: { id: true, name: true, code: true } },
      client: { select: { id: true, name: true, city: true, gstNumber: true, address: true } },
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
      transferRequests: {
        include: {
          department: { select: { id: true, name: true } },
          requestedBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
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
  return isStockVisible(entry, user, resolveStockScope(user)) ? entry : null;
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
    supplierName: _sn,
    clientName: _cn,
    clientLocation: _cl,
    ...rest
  } = parsed.data;

  // Goods that ship straight to a client never reach a warehouse, so the form
  // does not ask where they arrived. They still belong to a site for the books,
  // and the creator's own site is the only sensible answer.
  const effectiveLocationId = isDirectToClient
    ? locationId || (await getCallerLocationId(user))
    : locationId ?? null;

  // The batch is only accepted from someone allowed to set one
  const canSetBatch = user.permissions.includes(PERMISSIONS.STOCK_BATCH_EDIT);
  const effectiveBatch = canSetBatch ? batchNumber?.trim() || null : undefined;

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || !vendor.isActive) {
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
      vendorId: vendor.id,
      supplierName: vendor.name,
      clientId: client?.id ?? null,
      clientName: client?.name ?? null,
      clientLocation: client?.city ?? null,
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

  const parsed = updateStockEntrySchema.safeParse(data);
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
    supplierName: _sn,
    clientName: _cn,
    clientLocation: _cl,
    ...rest
  } = parsed.data;

  // Goods that ship straight to a client never reach a warehouse, so the form
  // does not ask where they arrived. They still belong to a site for the books,
  // and the creator's own site is the only sensible answer.
  const effectiveLocationId = isDirectToClient
    ? locationId || (await getCallerLocationId(user))
    : locationId ?? null;

  // The batch is only accepted from someone allowed to set one
  const canSetBatch = user.permissions.includes(PERMISSIONS.STOCK_BATCH_EDIT);
  const effectiveBatch = canSetBatch ? batchNumber?.trim() || null : undefined;

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || !vendor.isActive) {
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
      vendorId: vendor.id,
      supplierName: vendor.name,
      clientId: client?.id ?? null,
      clientName: client?.name ?? null,
      clientLocation: client?.city ?? null,
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

const NO_FLOW_CONFIGURED = "No approval flow configured. Contact an administrator.";

/**
 * The approval flow that governs an entry: its department's own, or the
 * company default. Returns null when there is nothing usable to snapshot.
 *
 * Shared by submitting and by rebuilding a lost snapshot, so the two can never
 * disagree about which steps an entry should have.
 *
 * Worth knowing: the steps are copied onto the entry as VALUES, not as links to
 * this flow. Editing the flow afterwards therefore never changes an entry that
 * is already in flight — which is deliberate, and also why changing the flow
 * cannot rescue an entry whose snapshot is missing. Rebuilding it can.
 */
async function findApprovalFlow(departmentId: string | null) {
  const flow = await prisma.approvalFlowConfig.findFirst({
    where: {
      isActive: true,
      OR: [{ departmentId }, { departmentId: null }],
    },
    include: { steps: { orderBy: { stepOrder: "asc" } } },
    // Prefer a department's own flow over the company default. `nulls: "last"`
    // is what makes that true: Postgres puts NULLs FIRST on a plain DESC, so
    // the default flow used to win and a department's own flow was ignored.
    orderBy: { departmentId: { sort: "desc", nulls: "last" } },
  });

  return flow && flow.steps.length > 0 ? flow : null;
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

  // Check required attachments
  const requiredTypes = await prisma.attachmentTypeConfig.findMany({
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

  // Snapshot the flow steps into approval records. A rejected entry that is
  // edited and resubmitted still has the previous round's approval rows, so
  // clear them first — the new submission starts a fresh approval cycle.
  await prisma.$transaction([
    prisma.stockApproval.deleteMany({ where: { stockEntryId: id } }),
    prisma.stockEntry.update({
      where: { id },
      data: { status: "SUBMITTED" },
    }),
    prisma.stockApproval.createMany({
      data: flow.steps.map((step) => ({
        stockEntryId: id,
        stepOrder: step.stepOrder,
        stepLabel: step.stepLabel,
        approverRoleId: step.approverRoleId,
        status: "PENDING",
      })),
    }),
  ]);

  await logActivity(
    "SUBMITTED",
    "StockEntry",
    id,
    `Submitted stock entry ${entry.entryNumber} for approval`
  );

  // Submitting is the point the goods count as delivered, so this may be the
  // arrival that completes the order.
  if (entry.purchaseOrderLineId) {
    await syncPurchaseOrderFromEntry(entry.purchaseOrderLineId);
  }

  revalidatePath("/stock");
  revalidatePath(`/stock/${id}`);
  return { success: true };
}

/**
 * Why this person may not act on this entry, or null if they may.
 *
 * Authority is `stock.approve` — a permission, never a role name. What narrows
 * it is WHERE the goods are:
 *
 *   department  an entry already in a department is that department's business
 *   site        central stock belongs to the site it arrived at
 *
 * The site rule is the one that was missing. Central stock has no department,
 * so the department check passed by default and any approver anywhere could
 * sign off another city's goods.
 */
function approvalRefusal(
  entry: { departmentId: string | null; locationId: string | null },
  user: { departmentId?: string | null; locationId?: string | null; role: string; permissions: string[] }
): string | null {
  // Seeing every site means being able to approve at every site
  if (resolveStockScope(user) === "all") return null;

  if (entry.departmentId !== null && entry.departmentId !== user.departmentId) {
    return "That entry belongs to another department";
  }

  // An entry with no location predates locations, so nobody is shut out of it
  if (entry.locationId !== null && entry.locationId !== user.locationId) {
    return "Those goods arrived at another site, so someone there has to approve them";
  }

  return null;
}

export async function approveStockEntry(id: string, stepOrder: number, comments?: string) {
  const user = await requirePermission(PERMISSIONS.STOCK_APPROVE);

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
  const user = await requirePermission(PERMISSIONS.STOCK_APPROVE);

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
  const user = await requirePermission(PERMISSIONS.STOCK_APPROVE);

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
  const user = await requireAnyPermission([
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.STOCK_CREATE,
  ]);

  const attachment = await prisma.stockEntryAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      fileName: true,
      fileUrl: true,
      mimeType: true,
      stockEntry: {
        select: {
          status: true,
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
  const user = await requireSignedIn();

  const canUpload =
    user.permissions?.includes(PERMISSIONS.STOCK_CREATE) ||
    user.permissions?.includes(PERMISSIONS.STOCK_EDIT);
  if (!canUpload) return { error: "You do not have permission to add attachments" };

  // Configuration, not the user's fault — so say so plainly rather than letting
  // it surface as a mysterious storage error a minute later.
  const storageProblem = describeStorageProblem();
  if (storageProblem) return { error: storageProblem };

  const entry = await prisma.stockEntry.findUnique({
    where: { id: input.stockEntryId },
    select: { status: true },
  });
  if (!entry) return { error: "Stock entry not found" };
  if (entry.status !== "DRAFT" && entry.status !== "REJECTED") {
    return { error: "Cannot upload to submitted or approved entries" };
  }

  const config = await prisma.attachmentTypeConfig.findUnique({
    where: { name: input.attachmentType },
  });
  if (config) {
    if (input.fileSize > config.maxSizeBytes) {
      const mb = Math.round(config.maxSizeBytes / 1024 / 1024);
      return { error: `That file is larger than the ${mb}MB limit for ${input.attachmentType}` };
    }
    const allowed = Array.isArray(config.allowedMimeTypes)
      ? (config.allowedMimeTypes as string[])
      : [];
    if (allowed.length > 0 && !allowed.includes(input.mimeType)) {
      return {
        error: `${input.attachmentType} accepts ${allowed.join(", ")} — not ${input.mimeType || "that file type"}`,
      };
    }
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

  const entry = await prisma.stockEntry.findUnique({
    where: { id: input.stockEntryId },
    select: { status: true, entryNumber: true },
  });
  if (!entry) return { error: "Stock entry not found" };
  if (entry.status !== "DRAFT" && entry.status !== "REJECTED") {
    return { error: "Cannot upload to submitted or approved entries" };
  }

  const attachment = await prisma.stockEntryAttachment.create({
    data: {
      fileName: input.fileName,
      fileUrl: input.fileUrl,
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
  if (attachment.fileUrl.startsWith("http")) {
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
  const user = await requireAnyPermission([
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.STOCK_CREATE,
    PERMISSIONS.STOCK_APPROVE,
  ]);

  // Counted in memory rather than with SQL COUNTs, because the numbers have to
  // match the list exactly — and the list's last rule ("central stock at my
  // site that still has quantity left") is not expressible as a query.
  const scope = resolveStockScope(user);
  const entries = await prisma.stockEntry.findMany({
    where: stockCandidatesWhere(user, scope),
    select: {
      status: true,
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
    include: availabilityInclude,
  });
  if (!entry) return { error: "Stock entry not found" };

  if (entry.status !== "APPROVED") {
    return { error: "Only approved stock can be moved to a department" };
  }

  const department = await prisma.department.findUnique({
    where: { id: parsed.data.departmentId },
  });
  if (!department || !department.isActive) {
    return { error: "Department not found or inactive" };
  }

  // Dispatched quantity has left the building too — it is not movable
  const remaining = availableQuantity(entry);
  if (parsed.data.quantity > remaining) {
    return {
      error: `Only ${remaining} of ${entry.quantity} units remain in stock for this entry`,
    };
  }

  const issueNumber = await nextReference("SI");

  const issue = await prisma.stockIssue.create({
    data: {
      issueNumber,
      stockEntryId,
      departmentId: parsed.data.departmentId,
      quantity: parsed.data.quantity,
      isAsset: parsed.data.isAsset ?? entry.isAsset,
      notes: parsed.data.notes?.trim() || null,
      issuedById: user.id,
    },
    include: { department: { select: { name: true } } },
  });

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
  return prisma.stockEntryFieldConfig.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: "asc" },
  });
}

export async function getAttachmentTypeConfigs() {
  return prisma.attachmentTypeConfig.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
}

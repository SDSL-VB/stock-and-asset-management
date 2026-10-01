"use server";

import { prisma } from "@/lib/prisma";
import { nextReference } from "@/lib/reference-numbers";
import {
  requirePermission,
  requireAnyPermission,
  resolveStockScope,
} from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  availableQuantity,
  availabilityInclude,
  issueDrawdownsInclude,
  heldByIssue,
  availableFromIssue,
  round,
} from "@/lib/stock-availability";
import { stockCandidatesWhere, isStockVisible, crossSiteRefusal, NO_SITE } from "@/lib/stock-visibility";
import {
  transferDecisionRefusal,
  transferDecidableWhere,
  transferDepartmentRefusal,
  transferDepartmentWhere,
} from "@/lib/review-rules";
import {
  createTransferRequestSchema,
  rejectRequestSchema,
} from "@/lib/validations/request";
import { logActivity } from "@/lib/activity-log";
import { revalidatePath } from "next/cache";
import { transferDecided, transferRequested, transferNeedsDepartment } from "@/lib/notifications/events";

/**
 * Assets are not a separate registry: everything arrives in central stock as
 * plain stock, and the movement into a department decides what it becomes.
 * A department's assets are therefore its StockIssues carrying isAsset.
 *
 * Visibility follows the same scope tiers as stock — `all` reaches every
 * location, `location` its own site, `department` its own department — and
 * monetary worth stays behind stock.value.view, so a central stock manager sees
 * every asset at their site without ever seeing what it cost.
 */
export async function getAssetHoldings() {
  const user = await requireAnyPermission([PERMISSIONS.ASSETS_VIEW, PERMISSIONS.ASSETS_REPORT_VIEW]);

  const scope = resolveStockScope(user);
  const where: Record<string, unknown> = { isAsset: true };

  if (!user.permissions.includes(PERMISSIONS.ASSETS_VIEW)) {
    // The assets report alone: what came out of this site's central stock,
    // wherever it went — unless they see every site
    if (scope !== "all") where.stockEntry = { locationId: user.locationId ?? NO_SITE };
  } else if (scope === "department") {
    // No department on record sees none, never all
    where.departmentId = user.departmentId ?? NO_SITE;
  } else if (scope === "location") {
    where.department = { locationId: user.locationId ?? NO_SITE };
  } else if (scope === "own") {
    where.issuedById = user.id;
  }
  // scope === "all" sees every location

  const issues = await prisma.stockIssue.findMany({
    where,
    include: {
      // Losses charged against this holding. What the department still has is
      // the issued quantity less its approved write-offs — see heldByIssue().
      ...issueDrawdownsInclude,
      department: {
        select: { id: true, name: true, location: { select: { id: true, name: true } } },
      },
      issuedBy: { select: { id: true, name: true } },
      stockEntry: {
        select: {
          id: true,
          entryNumber: true,
          itemCode: true,
          itemName: true,
          unitPrice: true,
          supplierName: true,
          product: { select: { category: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const canSeeValue = user.permissions.includes(PERMISSIONS.STOCK_VALUE_VIEW);

  return issues.map((issue) => ({
    id: issue.id,
    issueNumber: issue.issueNumber,
    // What the department actually still has, not what it was originally
    // handed. A holding entirely written off reports zero rather than
    // continuing to claim goods that no longer exist.
    quantity: heldByIssue(issue),
    /** How much of it is still free to write off, after anything pending */
    availableToWriteOff: availableFromIssue(issue),
    // Approved write-offs only — what builds used is not a loss
    writtenOff: round(
      issue.writeOffs.filter((w) => w.status === "APPROVED").reduce((sum, w) => sum + w.quantity, 0)
    ),
    receivedAt: issue.createdAt,
    itemCode: issue.stockEntry.itemCode,
    itemName: issue.stockEntry.itemName,
    categoryName: issue.stockEntry.product?.category.name ?? null,
    vendorName: issue.stockEntry.supplierName,
    entryId: issue.stockEntry.id,
    entryNumber: issue.stockEntry.entryNumber,
    departmentId: issue.department.id,
    departmentName: issue.department.name,
    locationName: issue.department.location?.name ?? null,
    issuedByName: issue.issuedBy.name,
    // Monetary worth is its own permission — null rather than 0 when withheld
    unitPrice: canSeeValue ? issue.stockEntry.unitPrice : null,
    // Valued on what is still held, so a write-off takes its worth off the
    // books at the same moment it takes the units off.
    value: canSeeValue ? round(heldByIssue(issue) * issue.stockEntry.unitPrice) : null,
  }));
}

/**
 * Approved central stock with quantity still available, for the "New Asset"
 * picker.
 *
 * Gated on assets.create — turning stock into a department's holding is its own
 * capability. The move it leads to still needs stock.move, which the dependency
 * map declares, so the two are always granted together and the button never
 * appears to someone the action would refuse.
 *
 * Only central stock is offered: something already sitting in a department is
 * not available to be turned into an asset elsewhere.
 */
export async function getCentralStockForAssets() {
  const user = await requirePermission(PERMISSIONS.ASSETS_CREATE);

  const scope = resolveStockScope(user);
  // Service stock is held apart and never becomes a department's asset; and
  // only stock the Stock Manager classified as an asset, unless they classify
  const where: Record<string, unknown> = {
    status: "APPROVED",
    departmentId: null,
    forService: false,
    ...(user.permissions.includes(PERMISSIONS.STOCK_CLASSIFY) ? {} : { isAsset: true }),
  };

  // Their own site only; someone limited to a site with none on record sees none
  if (scope !== "all") {
    where.locationId = user.locationId ?? NO_SITE;
  }

  const entries = await prisma.stockEntry.findMany({
    where,
    select: {
      id: true,
      entryNumber: true,
      itemCode: true,
      itemName: true,
      quantity: true,
      locationId: true,
      location: { select: { name: true } },
      ...availabilityInclude,
    },
    orderBy: { createdAt: "desc" },
  });

  return entries
    .map((e) => ({
      id: e.id,
      entryNumber: e.entryNumber,
      itemCode: e.itemCode,
      itemName: e.itemName,
      locationId: e.locationId,
      locationName: e.location?.name ?? null,
      available: availableQuantity(e),
    }))
    .filter((e) => e.available > 0);
}

/**
 * How a single department's holdings split between consumable stock and
 * assets. Used on the department detail page.
 */
export async function getDepartmentHoldingSplit(departmentId: string) {
  await requirePermission(PERMISSIONS.DEPARTMENTS_VIEW);

  const issues = await prisma.stockIssue.findMany({
    where: { departmentId },
    // What it still holds — less write-offs and what its builds used — not
    // the raw quantity that once moved in
    select: { isAsset: true, quantity: true, ...issueDrawdownsInclude },
  });

  return issues.reduce(
    (acc, i) => {
      const held = heldByIssue(i);
      if (held <= 0) return acc;
      if (i.isAsset) {
        acc.assetLines += 1;
        acc.assetQuantity = round(acc.assetQuantity + held);
      } else {
        acc.stockLines += 1;
        acc.stockQuantity = round(acc.stockQuantity + held);
      }
      return acc;
    },
    { assetLines: 0, assetQuantity: 0, stockLines: 0, stockQuantity: 0 }
  );
}

/* ========================================================================= */
/* Transfer requests — asking for stock instead of taking it                 */
/* ========================================================================= */

/**
 * FLOW: transfer — a member asks, their manager decides, and approval is what
 * moves the stock.
 *
 *   1. createTransferRequest   member picks central stock and a quantity
 *   2. approveTransferRequest  their manager agrees → a StockIssue is created,
 *                              which IS the movement; nothing else to do
 *      rejectTransferRequest   or declines, with a reason
 *
 * Someone holding stock.move skips all of this and moves it directly; the two
 * paths meet at the same StockIssue.
 */

/** Ask for approved central stock to be moved into a department. */
export async function createTransferRequest(stockEntryId: string, data: unknown) {
  const user = await requirePermission(PERMISSIONS.ASSETS_TRANSFER_REQUEST);

  const parsed = createTransferRequestSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const entry = await prisma.stockEntry.findUnique({
    where: { id: stockEntryId },
    include: {
      ...availabilityInclude,
      // The visibility rule needs which department each issue went to
      issues: { select: { quantity: true, departmentId: true } },
    },
  });
  // Only stock you can see can be asked for — as on the stock list
  if (!entry || !isStockVisible(entry, user, resolveStockScope(user))) return { error: "Stock entry not found" };
  if (entry.status !== "APPROVED") {
    return { error: "Transfers can only be requested for approved stock" };
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

  const available = availableQuantity(entry);
  if (parsed.data.quantity > available) {
    const issued = entry.issues.reduce((sum, i) => sum + i.quantity, 0);
    const pending = entry.transferRequests.reduce((sum, r) => sum + r.quantity, 0);
    const dispatched = entry.dispatchItems.reduce((sum, d) => sum + d.quantity, 0);
    return {
      error: `Only ${available} unit${available === 1 ? "" : "s"} available (${issued} already moved, ${pending} in pending requests, ${dispatched} dispatched)`,
    };
  }

  // Step 1 is done on asking when the asker may agree for this department, or
  // may allocate the stock outright (the Stock Manager, Accounts)
  const target = { departmentId: department.id, siteId: department.locationId };
  const mayDecide = transferDecisionRefusal(user, target) === null;
  const departmentAgreed = mayDecide || transferDepartmentRefusal(user, target) === null;

  const request = await prisma.stockTransferRequest.create({
    data: {
      requestNumber: await nextReference("TR"),
      ...(departmentAgreed ? { departmentApprovedById: user.id, departmentApprovedAt: new Date() } : {}),
      stockEntryId,
      departmentId: parsed.data.departmentId,
      quantity: parsed.data.quantity,
      // As the Stock Manager classified the entry, unless the asker may classify
      isAsset: user.permissions.includes(PERMISSIONS.STOCK_CLASSIFY)
        ? parsed.data.isAsset ?? entry.isAsset
        : entry.isAsset,
      notes: parsed.data.notes?.trim() || null,
      requestedById: user.id,
    },
    include: { department: { select: { name: true } } },
  });

  await logActivity(
    "REQUESTED",
    "StockTransferRequest",
    request.id,
    `Requested transfer of ${request.quantity} × ${entry.itemName} (${entry.entryNumber}) to ${request.department.name}`
  );

  // Ask for what you may approve, and it is approved — through the approve
  // action itself, so every check it makes still applies
  if (mayDecide) {
    const approval = await approveTransferRequest(request.id);
    if ("success" in approval && approval.success) {
      revalidatePath("/assets");
      revalidatePath(`/stock/${stockEntryId}`);
      return { success: true, request, approved: true };
    }
  }

  const notice = { requestNumber: request.requestNumber, itemName: entry.itemName, requestedById: user.id };
  if (departmentAgreed) await transferRequested({ ...notice, locationId: department.locationId });
  else await transferNeedsDepartment({ ...notice, departmentId: department.id });
  revalidatePath("/assets");
  revalidatePath(`/stock/${stockEntryId}`);
  return { success: true, request, approved: false };
}

/**
 * Transfer requests the caller may see: everything with full scope, otherwise
 * their department's incoming ones plus anything they asked for themselves.
 */
export async function getTransferRequests() {
  const user = await requireAnyPermission([
    PERMISSIONS.ASSETS_TRANSFER_REQUEST,
    PERMISSIONS.ASSETS_TRANSFER_APPROVE,
    PERMISSIONS.ASSETS_TRANSFER_DEPARTMENT,
  ]);

  // What they may decide or agree, plus whatever they asked for themselves. An
  // empty filter means "everything" — and Prisma reads `{}` inside an OR as
  // matching nothing, so it is never put there.
  const filters = [transferDecidableWhere(user), transferDepartmentWhere(user), { requestedById: user.id }];
  const where = filters.some((f) => Object.keys(f).length === 0) ? {} : { OR: filters };

  const requests = await prisma.stockTransferRequest.findMany({
    where,
    include: {
      stockEntry: {
        select: {
          id: true,
          entryNumber: true,
          itemCode: true,
          itemName: true,
          quantity: true,
          issues: { select: { quantity: true } },
        },
      },
      department: { select: { id: true, name: true, locationId: true } },
      requestedBy: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  // The actions' own rules, so no button is offered that they refuse
  return requests.map((r) => {
    const waitingOnDepartment = r.status === "PENDING" && !r.departmentApprovedAt;
    return {
      ...r,
      waitingOnDepartment,
      canAgree: waitingOnDepartment && transferDepartmentRefusal(user, r) === null,
      canDecide:
        r.status === "PENDING" &&
        !waitingOnDepartment &&
        transferDecisionRefusal(user, { departmentId: r.departmentId, siteId: r.department.locationId }) === null,
    };
  });
}

/**
 * Agree to a transfer, which IS the movement — approving creates the StockIssue
 * that takes the stock out of central and puts it into the department.
 *
 * Only into your own department, unless you see every site.
 */
export async function approveTransferRequest(id: string) {
  const user = await requirePermission(PERMISSIONS.ASSETS_TRANSFER_APPROVE);

  const request = await prisma.stockTransferRequest.findUnique({
    where: { id },
    include: {
      // All four drawdowns. Counting only issues, as this once did, let a
      // transfer be approved for stock already sitting on a consignment.
      stockEntry: { include: availabilityInclude },
      department: { select: { id: true, name: true, isCentralStock: true, locationId: true } },
    },
  });
  if (!request) return { error: "Transfer request not found" };
  if (request.status !== "PENDING") return { error: "This request has already been processed" };
  if (!request.departmentApprovedAt) return { error: "The receiving department has not agreed this request yet" };
  // A request raised before central-stock departments were refused as targets
  if (request.department.isCentralStock) {
    return { error: "That request moves stock into central stock itself — reject it instead" };
  }

  const refusal = transferDecisionRefusal(user, {
    departmentId: request.departmentId,
    siteId: request.department.locationId,
  });
  if (refusal) return { error: refusal };

  const entry = request.stockEntry;
  if (entry.status !== "APPROVED") {
    return { error: "The stock entry is no longer approved" };
  }

  // This request is itself one of the pending ones counted above, so add it
  // back before asking whether there is room for it.
  const free = availableQuantity(entry) + request.quantity;
  if (request.quantity > free) {
    return {
      error: `Only ${free} unit${free === 1 ? "" : "s"} are still free — the rest is already moved, dispatched or committed to a build`,
    };
  }

  const issueNumber = await nextReference("SI");
  // Claimed first, conditionally, so approving twice at the same moment moves
  // the stock once. (A pending request already holds its quantity back from
  // everyone else, so nothing else can take it in between.)
  const approved = await prisma.$transaction(async (tx) => {
    const claimed = await tx.stockTransferRequest.updateMany({
      where: { id, status: "PENDING", departmentApprovedAt: { not: null } },
      data: { status: "APPROVED", reviewedById: user.id },
    });
    if (claimed.count !== 1) return false;
    await tx.stockIssue.create({
      data: {
        issueNumber,
        stockEntryId: request.stockEntryId,
        departmentId: request.departmentId,
        quantity: request.quantity,
        isAsset: request.isAsset,
        notes: `Transfer request ${request.requestNumber}${request.notes ? ` — ${request.notes}` : ""}`,
        // Goods coming back on a call-back stay linked to it, for rework
        callBackId: request.callBackId,
        issuedById: user.id,
      },
    });
    return true;
  });
  if (!approved) return { error: "This request has just been answered by someone else" };

  await logActivity(
    "APPROVED",
    "StockTransferRequest",
    id,
    `Approved transfer ${request.requestNumber}: ${request.quantity} × ${entry.itemName} to ${request.department.name} as ${request.isAsset ? "an asset" : "stock"}`
  );

  await transferDecided({ requestNumber: request.requestNumber, itemName: entry.itemName, requestedById: request.requestedById }, true);
  revalidatePath("/assets");
  revalidatePath(`/stock/${request.stockEntryId}`);
  revalidatePath("/stock");
  revalidatePath("/dashboard");
  return { success: true };
}

/**
 * Step 1: the receiving department agrees. Whoever may also approve it moves
 * the stock at once — one approval when one person holds both steps.
 */
export async function agreeTransferRequest(id: string) {
  const user = await requirePermission(PERMISSIONS.ASSETS_TRANSFER_DEPARTMENT);

  const request = await prisma.stockTransferRequest.findUnique({
    where: { id },
    include: {
      stockEntry: { select: { itemName: true } },
      department: { select: { name: true, locationId: true } },
    },
  });
  if (!request) return { error: "Transfer request not found" };
  if (request.status !== "PENDING" || request.departmentApprovedAt) {
    return { error: "This request has already been processed" };
  }
  const refusal = transferDepartmentRefusal(user, request);
  if (refusal) return { error: refusal };

  const claimed = await prisma.stockTransferRequest.updateMany({
    where: { id, status: "PENDING", departmentApprovedAt: null },
    data: { departmentApprovedById: user.id, departmentApprovedAt: new Date() },
  });
  if (claimed.count !== 1) return { error: "This request has just been answered by someone else" };

  await logActivity(
    "APPROVED",
    "StockTransferRequest",
    id,
    `Agreed transfer ${request.requestNumber} for ${request.department.name}`
  );

  if (transferDecisionRefusal(user, { departmentId: request.departmentId, siteId: request.department.locationId }) === null) {
    const approval = await approveTransferRequest(id);
    if ("success" in approval && approval.success) return { success: true, moved: true };
  }
  await transferRequested({
    requestNumber: request.requestNumber,
    itemName: request.stockEntry.itemName,
    requestedById: request.requestedById,
    locationId: request.department.locationId,
  });
  revalidatePath("/assets");
  revalidatePath("/dashboard");
  return { success: true, moved: false };
}

/**
 * Decline a transfer, with a reason the asker can read — at the department
 * step by whoever may agree it, or at either step by whoever may approve it.
 */
export async function rejectTransferRequest(id: string, data: unknown) {
  const user = await requireAnyPermission([PERMISSIONS.ASSETS_TRANSFER_APPROVE, PERMISSIONS.ASSETS_TRANSFER_DEPARTMENT]);

  const request = await prisma.stockTransferRequest.findUnique({
    where: { id },
    include: {
      stockEntry: { select: { entryNumber: true, itemName: true } },
      department: { select: { locationId: true } },
    },
  });
  if (!request) return { error: "Transfer request not found" };
  if (request.status !== "PENDING") return { error: "This request has already been processed" };

  const refusal = transferDecisionRefusal(user, {
    departmentId: request.departmentId,
    siteId: request.department.locationId,
  });
  const departmentRefusal = request.departmentApprovedAt ? refusal : transferDepartmentRefusal(user, request);
  if (refusal && departmentRefusal) return { error: refusal };

  const parsed = rejectRequestSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const declined = await prisma.stockTransferRequest.updateMany({
    where: { id, status: "PENDING" },
    data: {
      status: "REJECTED",
      reviewedById: user.id,
      reviewNote: parsed.data.reviewNote.trim(),
    },
  });
  if (declined.count !== 1) return { error: "This request has just been answered by someone else" };

  await logActivity(
    "REJECTED",
    "StockTransferRequest",
    id,
    `Rejected transfer ${request.requestNumber} (${request.stockEntry.entryNumber})`
  );

  await transferDecided(
    { requestNumber: request.requestNumber, itemName: request.stockEntry.itemName, requestedById: request.requestedById },
    false,
    parsed.data.reviewNote.trim()
  );
  revalidatePath("/assets");
  revalidatePath(`/stock/${request.stockEntryId}`);
  return { success: true };
}

/**
 * Approved stock with quantity still free, for the "ask for a transfer" picker.
 *
 * Filtered by the caller's stock scope BOTH in the query and after it — the
 * query alone cannot express "central stock at my own site", which is how a
 * department-scoped person was once offered another city's holdings.
 */
export async function getTransferableEntries() {
  const user = await requirePermission(PERMISSIONS.ASSETS_TRANSFER_REQUEST);

  const scope = resolveStockScope(user);

  const entries = await prisma.stockEntry.findMany({
    // Service stock never moves into a department
    where: { status: "APPROVED", forService: false, ...stockCandidatesWhere(user, scope) },
    select: {
      id: true,
      entryNumber: true,
      itemCode: true,
      itemName: true,
      quantity: true,
      status: true,
      forService: true,
      departmentId: true,
      locationId: true,
      createdById: true,
      ...availabilityInclude,
      // Overrides the shared one: the visibility rule also needs to know WHICH
      // department each issue went to, not just how much left.
      issues: { select: { departmentId: true, quantity: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return entries
    .filter((e) => isStockVisible(e, user, scope))
    .map((e) => ({
      id: e.id,
      entryNumber: e.entryNumber,
      itemCode: e.itemCode,
      itemName: e.itemName,
      locationId: e.locationId,
      available: availableQuantity(e),
    }))
    .filter((e) => e.available > 0);
}

/** Pending transfers waiting on this person, for the dashboard review queue. */
export async function getReviewableTransfers() {
  const user = await requireAnyPermission([PERMISSIONS.ASSETS_TRANSFER_APPROVE, PERMISSIONS.ASSETS_TRANSFER_DEPARTMENT]);

  // Waiting on their department step, or agreed and waiting on their approval
  const transfers = await prisma.stockTransferRequest.findMany({
    where: {
      status: "PENDING",
      OR: [
        { departmentApprovedAt: null, ...transferDepartmentWhere(user) },
        { departmentApprovedAt: { not: null }, ...transferDecidableWhere(user) },
      ],
    },
    take: 10,
    orderBy: { createdAt: "desc" },
    include: {
      stockEntry: { select: { itemName: true } },
      department: { select: { name: true } },
      requestedBy: { select: { name: true } },
    },
  });

  return transfers.map((r) => ({
    kind: "TRANSFER" as const,
    id: r.id,
    title: `${r.quantity} × ${r.stockEntry.itemName}`,
    subtitle: `${r.requestNumber} · to ${r.department.name} · ${r.requestedBy.name}`,
    href: "/assets",
  }));
}

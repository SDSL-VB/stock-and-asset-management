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
} from "@/lib/stock-availability";
import { stockCandidatesWhere, isStockVisible } from "@/lib/stock-visibility";
import { SELF_APPROVAL_REFUSAL } from "@/lib/review-rules";
import {
  createTransferRequestSchema,
  rejectRequestSchema,
} from "@/lib/validations/request";
import { logActivity } from "./activity";
import { revalidatePath } from "next/cache";

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
  const user = await requirePermission(PERMISSIONS.ASSETS_VIEW);

  const scope = resolveStockScope(user);
  const where: Record<string, unknown> = { isAsset: true };

  if (scope === "department" && user.departmentId) {
    where.departmentId = user.departmentId;
  } else if (scope === "location" && user.locationId) {
    where.department = { locationId: user.locationId };
  } else if (scope === "own") {
    where.issuedById = user.id;
  }
  // scope === "all" sees every location

  const issues = await prisma.stockIssue.findMany({
    where,
    include: {
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
    quantity: issue.quantity,
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
    value: canSeeValue ? issue.quantity * issue.stockEntry.unitPrice : null,
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
  const where: Record<string, unknown> = { status: "APPROVED", departmentId: null };

  if (scope !== "all" && user.locationId) {
    where.locationId = user.locationId;
  }

  const entries = await prisma.stockEntry.findMany({
    where,
    select: {
      id: true,
      entryNumber: true,
      itemCode: true,
      itemName: true,
      quantity: true,
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
    select: { isAsset: true, quantity: true },
  });

  return issues.reduce(
    (acc, i) => {
      if (i.isAsset) {
        acc.assetLines += 1;
        acc.assetQuantity += i.quantity;
      } else {
        acc.stockLines += 1;
        acc.stockQuantity += i.quantity;
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
    },
  });
  if (!entry) return { error: "Stock entry not found" };
  if (entry.status !== "APPROVED") {
    return { error: "Transfers can only be requested for approved stock" };
  }

  const department = await prisma.department.findUnique({
    where: { id: parsed.data.departmentId },
  });
  if (!department || !department.isActive) {
    return { error: "Department not found or inactive" };
  }

  const available = availableQuantity(entry);
  if (parsed.data.quantity > available) {
    const issued = entry.issues.reduce((sum, i) => sum + i.quantity, 0);
    const pending = entry.transferRequests.reduce((sum, r) => sum + r.quantity, 0);
    const dispatched = entry.dispatchItems.reduce((sum, d) => sum + d.quantity, 0);
    return {
      error: `Only ${available} unit${available === 1 ? "" : "s"} available (${issued} already moved, ${pending} in pending requests, ${dispatched} dispatched)`,
    };
  }

  const request = await prisma.stockTransferRequest.create({
    data: {
      requestNumber: await nextReference("TR"),
      stockEntryId,
      departmentId: parsed.data.departmentId,
      quantity: parsed.data.quantity,
      isAsset: parsed.data.isAsset ?? entry.isAsset,
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

  revalidatePath("/assets");
  revalidatePath(`/stock/${stockEntryId}`);
  return { success: true, request };
}

/**
 * Transfer requests the caller may see: everything with full scope, otherwise
 * their department's incoming ones plus anything they asked for themselves.
 */
export async function getTransferRequests() {
  const user = await requireAnyPermission([
    PERMISSIONS.ASSETS_TRANSFER_REQUEST,
    PERMISSIONS.ASSETS_TRANSFER_APPROVE,
  ]);

  const canApprove = user.permissions.includes(PERMISSIONS.ASSETS_TRANSFER_APPROVE);

  let where: Record<string, unknown> = {};
  if (resolveStockScope(user) !== "all") {
    where =
      canApprove && user.departmentId
        ? { OR: [{ departmentId: user.departmentId }, { requestedById: user.id }] }
        : { requestedById: user.id };
  }

  return prisma.stockTransferRequest.findMany({
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
      department: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
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
      department: { select: { id: true, name: true } },
    },
  });
  if (!request) return { error: "Transfer request not found" };
  if (request.status !== "PENDING") return { error: "This request has already been processed" };

  if (resolveStockScope(user) !== "all" && request.departmentId !== user.departmentId) {
    return { error: "You can only approve transfers into your own department" };
  }
  if (request.requestedById === user.id) {
    return { error: SELF_APPROVAL_REFUSAL };
  }

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

  await prisma.$transaction([
    prisma.stockIssue.create({
      data: {
        issueNumber: await nextReference("SI"),
        stockEntryId: request.stockEntryId,
        departmentId: request.departmentId,
        quantity: request.quantity,
        isAsset: request.isAsset,
        notes: `Transfer request ${request.requestNumber}${request.notes ? ` — ${request.notes}` : ""}`,
        issuedById: user.id,
      },
    }),
    prisma.stockTransferRequest.update({
      where: { id },
      data: { status: "APPROVED", reviewedById: user.id },
    }),
  ]);

  await logActivity(
    "APPROVED",
    "StockTransferRequest",
    id,
    `Approved transfer ${request.requestNumber}: ${request.quantity} × ${entry.itemName} to ${request.department.name} as ${request.isAsset ? "an asset" : "stock"}`
  );

  revalidatePath("/assets");
  revalidatePath(`/stock/${request.stockEntryId}`);
  revalidatePath("/stock");
  revalidatePath("/dashboard");
  return { success: true };
}

/** Decline a transfer, with a reason the asker can read. */
export async function rejectTransferRequest(id: string, data: unknown) {
  const user = await requirePermission(PERMISSIONS.ASSETS_TRANSFER_APPROVE);

  const request = await prisma.stockTransferRequest.findUnique({
    where: { id },
    include: { stockEntry: { select: { entryNumber: true } } },
  });
  if (!request) return { error: "Transfer request not found" };
  if (request.status !== "PENDING") return { error: "This request has already been processed" };

  if (resolveStockScope(user) !== "all" && request.departmentId !== user.departmentId) {
    return { error: "You can only reject transfers into your own department" };
  }
  if (request.requestedById === user.id) {
    return { error: SELF_APPROVAL_REFUSAL };
  }

  const parsed = rejectRequestSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await prisma.stockTransferRequest.update({
    where: { id },
    data: {
      status: "REJECTED",
      reviewedById: user.id,
      reviewNote: parsed.data.reviewNote.trim(),
    },
  });

  await logActivity(
    "REJECTED",
    "StockTransferRequest",
    id,
    `Rejected transfer ${request.requestNumber} (${request.stockEntry.entryNumber})`
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
    where: { status: "APPROVED", ...stockCandidatesWhere(user, scope) },
    select: {
      id: true,
      entryNumber: true,
      itemCode: true,
      itemName: true,
      quantity: true,
      status: true,
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
      available: availableQuantity(e),
    }))
    .filter((e) => e.available > 0);
}

/** Pending transfers waiting on this person, for the dashboard review queue. */
export async function getReviewableTransfers() {
  const user = await requirePermission(PERMISSIONS.ASSETS_TRANSFER_APPROVE);

  const seesEverySite = resolveStockScope(user) === "all";
  if (!seesEverySite && !user.departmentId) return [];

  const transfers = await prisma.stockTransferRequest.findMany({
    where: {
      status: "PENDING",
      ...(seesEverySite ? {} : { departmentId: user.departmentId! }),
      // Never your own ask
      requestedById: { not: user.id },
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

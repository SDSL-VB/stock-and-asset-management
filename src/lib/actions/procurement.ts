"use server";

import { prisma } from "@/lib/prisma";
import { nextReference } from "@/lib/reference-numbers";
import { requirePermission, requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, resolveStockScope } from "@/lib/rbac/permissions";
import {
  createIntentSchema,
  reviewIntentSchema,
  createPurchaseOrderSchema,
  closePurchaseOrderSchema,
  procurementFlowSchema,
} from "@/lib/validations/procurement";
import { deliveredEntriesWhere } from "@/lib/procurement-delivery";
import { logActivity } from "./activity";
import { revalidatePath } from "next/cache";

/**
 * FLOW: purchase — a need, an order, deliveries, and a close.
 *
 *   1. createIntent            anyone with the key says what they need. It
 *                              records the department asking automatically.
 *   2. approveIntent           a buyer verifies it is worth ordering → APPROVED.
 *                              (Switchable off entirely in Configuration.)
 *      rejectIntent/cancel     or declines it, or the asker withdraws it.
 *   3. createPurchaseOrder     one or more verified needs become an order to a
 *                              single vendor, with agreed prices. The needs flip
 *                              to ORDERED so nothing is ordered twice.
 *   4. (a stock entry arrives) see stock.ts — booking goods against a line is
 *                              what "delivered" means.
 *   5. syncPurchaseOrderFromEntry
 *                              closes the order when the last unit is booked in,
 *                              and re-opens it if that delivery is rejected.
 *      closePurchaseOrder      or someone closes it short, which is a decision
 *                              and is never undone automatically.
 */

/**
 * Procurement: a stated need, an order placed against it, and goods arriving.
 *
 * The one idea worth holding on to is that **nothing records how much is still
 * outstanding**. A line's delivered quantity is the sum of the stock entries
 * pointing at it, so a part delivery needs no bookkeeping beyond entering the
 * goods that actually turned up — and there is no second number to drift.
 */

/* ------------------------------------------------------------------------- */
/* The configurable step                                                     */
/* ------------------------------------------------------------------------- */

/** One rule for the company, like the bill-of-materials flow. */
export async function getProcurementFlow() {
  const config = await prisma.procurementFlowConfig.findUnique({
    where: { id: "singleton" },
    include: { approverRole: { select: { id: true, name: true } } },
  });

  return {
    requiresApproval: config?.requiresApproval ?? true,
    approverRoleId: config?.approverRoleId ?? null,
    approverRoleName: config?.approverRole?.name ?? null,
  };
}

export async function updateProcurementFlow(data: unknown) {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_CONFIG);

  const parsed = procurementFlowSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { requiresApproval, approverRoleId } = parsed.data;

  await prisma.procurementFlowConfig.upsert({
    where: { id: "singleton" },
    update: { requiresApproval, approverRoleId: approverRoleId || null, updatedById: user.id },
    create: {
      id: "singleton",
      requiresApproval,
      approverRoleId: approverRoleId || null,
      updatedById: user.id,
    },
  });

  await logActivity(
    "UPDATED",
    "ProcurementFlowConfig",
    "singleton",
    requiresApproval
      ? "Needs must now be verified before an order can be raised"
      : "Orders can now be raised without verifying the need first"
  );

  revalidatePath("/configure");
  revalidatePath("/procurement");
  return { success: true };
}

/* ------------------------------------------------------------------------- */
/* Intents — "we need this"                                                  */
/* ------------------------------------------------------------------------- */

export async function createIntent(data: unknown) {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_INTENT_CREATE);

  const parsed = createIntentSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { productId, quantity, vendorId, locationId, neededBy, notes } = parsed.data;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { name: true, isActive: true },
  });
  if (!product || !product.isActive) {
    return { error: "That product is not in the catalog" };
  }

  const intent = await prisma.purchaseIntent.create({
    data: {
      intentNumber: await nextReference("PI"),
      productId,
      quantity,
      vendorId: vendorId || null,
      // Who needs it is who asked, not something they choose
      departmentId: user.departmentId ?? null,
      locationId: locationId || user.locationId || null,
      neededBy: neededBy ? new Date(neededBy) : null,
      notes: notes?.trim() || null,
      requestedById: user.id,
    },
  });

  await logActivity(
    "CREATED",
    "PurchaseIntent",
    intent.id,
    `Raised ${intent.intentNumber} — needs ${quantity} × ${product.name}`
  );

  revalidatePath("/procurement");
  return { success: true, intent };
}

/** Intents the caller may see: their own, their department's, or all. */
export async function getIntents() {
  const user = await requireAnyPermission([
    PERMISSIONS.PROCUREMENT_INTENT_VIEW,
    PERMISSIONS.PROCUREMENT_INTENT_CREATE,
  ]);

  const seesAll =
    resolveStockScope(user) === "all" ||
    user.permissions.includes(PERMISSIONS.PROCUREMENT_INTENT_APPROVE);

  const intents = await prisma.purchaseIntent.findMany({
    where: seesAll
      ? {}
      : {
          OR: [
            { requestedById: user.id },
            ...(user.departmentId ? [{ departmentId: user.departmentId }] : []),
          ],
        },
    include: {
      product: { select: { code: true, name: true, unit: true } },
      vendor: { select: { name: true } },
      department: { select: { name: true } },
      location: { select: { name: true } },
      requestedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      orderLines: {
        select: { purchaseOrder: { select: { id: true, poNumber: true, status: true } } },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  return intents.map((i) => ({
    ...i,
    order: i.orderLines[0]?.purchaseOrder ?? null,
  }));
}

export async function approveIntent(id: string, data: unknown = {}) {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_INTENT_APPROVE);

  const parsed = reviewIntentSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const intent = await prisma.purchaseIntent.findUnique({
    where: { id },
    include: { product: { select: { name: true } } },
  });
  if (!intent) return { error: "That need no longer exists" };
  if (intent.status !== "PENDING") {
    return { error: `This has already been ${intent.status.toLowerCase()}` };
  }

  await prisma.purchaseIntent.update({
    where: { id },
    data: {
      status: "APPROVED",
      reviewNote: parsed.data.reviewNote?.trim() || null,
      reviewedById: user.id,
      reviewedAt: new Date(),
    },
  });

  await logActivity(
    "APPROVED",
    "PurchaseIntent",
    id,
    `Verified ${intent.intentNumber} — ${intent.quantity} × ${intent.product.name} can be ordered`
  );

  revalidatePath("/procurement");
  return { success: true };
}

export async function rejectIntent(id: string, data: unknown) {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_INTENT_APPROVE);

  const parsed = reviewIntentSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const intent = await prisma.purchaseIntent.findUnique({
    where: { id },
    include: { product: { select: { name: true } } },
  });
  if (!intent) return { error: "That need no longer exists" };
  if (intent.status !== "PENDING") {
    return { error: `This has already been ${intent.status.toLowerCase()}` };
  }

  await prisma.purchaseIntent.update({
    where: { id },
    data: {
      status: "REJECTED",
      reviewNote: parsed.data.reviewNote?.trim() || null,
      reviewedById: user.id,
      reviewedAt: new Date(),
    },
  });

  await logActivity(
    "REJECTED",
    "PurchaseIntent",
    id,
    `Declined ${intent.intentNumber} for ${intent.quantity} × ${intent.product.name}`
  );

  revalidatePath("/procurement");
  return { success: true };
}

/** Withdraw a need you raised, while nobody has acted on it. */
export async function cancelIntent(id: string) {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_INTENT_CREATE);

  const intent = await prisma.purchaseIntent.findUnique({
    where: { id },
    include: { product: { select: { name: true } } },
  });
  if (!intent) return { error: "That need no longer exists" };
  if (intent.status !== "PENDING" && intent.status !== "APPROVED") {
    return { error: "Only a need nobody has ordered against can be withdrawn" };
  }
  if (intent.requestedById !== user.id && resolveStockScope(user) !== "all") {
    return { error: "Only the person who raised this can withdraw it" };
  }

  await prisma.purchaseIntent.update({
    where: { id },
    data: { status: "CANCELLED", reviewedById: user.id, reviewedAt: new Date() },
  });

  await logActivity(
    "CANCELLED",
    "PurchaseIntent",
    id,
    `Withdrew ${intent.intentNumber} for ${intent.quantity} × ${intent.product.name}`
  );

  revalidatePath("/procurement");
  return { success: true };
}

/**
 * Needs that can go onto an order.
 *
 * When the verification step is switched off, a need is orderable the moment it
 * is raised — there is nobody to wait for.
 */
export async function getOrderableIntents() {
  await requirePermission(PERMISSIONS.PROCUREMENT_PO_CREATE);

  const { requiresApproval } = await getProcurementFlow();
  const statuses = requiresApproval
    ? (["APPROVED"] as const)
    : (["APPROVED", "PENDING"] as const);

  const intents = await prisma.purchaseIntent.findMany({
    where: { status: { in: [...statuses] } },
    include: {
      product: { select: { id: true, code: true, name: true, unit: true } },
      vendor: { select: { id: true, name: true } },
      department: { select: { name: true } },
      location: { select: { id: true, name: true } },
      requestedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return intents.map((i) => ({
    id: i.id,
    intentNumber: i.intentNumber,
    quantity: i.quantity,
    productId: i.product.id,
    productCode: i.product.code,
    productName: i.product.name,
    unit: i.product.unit,
    vendorId: i.vendor?.id ?? null,
    vendorName: i.vendor?.name ?? null,
    locationId: i.location?.id ?? null,
    departmentName: i.department?.name ?? null,
    requestedByName: i.requestedBy.name,
    neededBy: i.neededBy,
  }));
}

/* ------------------------------------------------------------------------- */
/* Purchase orders                                                           */
/* ------------------------------------------------------------------------- */

export async function createPurchaseOrder(data: unknown) {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_PO_CREATE);

  const parsed = createPurchaseOrderSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { vendorId, locationId, expectedDate, notes, lines } = parsed.data;

  const [vendor, location] = await Promise.all([
    prisma.vendor.findUnique({ where: { id: vendorId }, select: { name: true, isActive: true } }),
    prisma.location.findUnique({ where: { id: locationId }, select: { name: true } }),
  ]);
  if (!vendor || !vendor.isActive) return { error: "That vendor is not on the list" };
  if (!location) return { error: "That site no longer exists" };

  // A need can only be ordered once — otherwise two orders quietly cover the
  // same request and twice the goods arrive.
  const intentIds = lines.map((l) => l.intentId).filter((v): v is string => Boolean(v));
  if (intentIds.length > 0) {
    const alreadyOrdered = await prisma.purchaseIntent.findMany({
      where: { id: { in: intentIds }, status: { in: ["ORDERED", "REJECTED", "CANCELLED"] } },
      select: { intentNumber: true, status: true },
    });
    if (alreadyOrdered.length > 0) {
      const first = alreadyOrdered[0];
      return {
        error: `${first.intentNumber} is already ${first.status.toLowerCase()} — refresh and try again`,
      };
    }
  }

  const poNumber = await nextReference("PO");

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.purchaseOrder.create({
      data: {
        poNumber,
        vendorId,
        locationId,
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        notes: notes?.trim() || null,
        createdById: user.id,
        lines: {
          create: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            intentId: l.intentId || null,
            notes: l.notes?.trim() || null,
          })),
        },
      },
    });

    if (intentIds.length > 0) {
      await tx.purchaseIntent.updateMany({
        where: { id: { in: intentIds } },
        data: { status: "ORDERED" },
      });
    }

    return created;
  });

  const total = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  await logActivity(
    "CREATED",
    "PurchaseOrder",
    order.id,
    `Raised ${order.poNumber} to ${vendor.name} for ${location.name} — ${lines.length} line${lines.length === 1 ? "" : "s"}, ₹${total.toFixed(2)}`
  );

  revalidatePath("/procurement");
  revalidatePath("/stock");
  return { success: true, order };
}

/** Shape one order, with delivered and outstanding derived per line. */
function shapeOrder(
  order: {
    id: string;
    poNumber: string;
    status: string;
    expectedDate: Date | null;
    notes: string | null;
    closeReason: string | null;
    createdAt: Date;
    closedAt: Date | null;
    vendor: { id: string; name: string };
    location: { id: string; name: string };
    createdBy: { name: string };
    closedBy: { name: string } | null;
    lines: {
      id: string;
      quantity: number;
      unitPrice: number;
      notes: string | null;
      product: { id: string; code: string; name: string; unit: string };
      intent: { intentNumber: string } | null;
      stockEntries: { quantity: number }[];
    }[];
  },
  canSeeValue: boolean
) {
  const lines = order.lines.map((l) => {
    const delivered = l.stockEntries.reduce((sum, e) => sum + e.quantity, 0);
    return {
      id: l.id,
      productId: l.product.id,
      productCode: l.product.code,
      productName: l.product.name,
      unit: l.product.unit,
      quantity: l.quantity,
      delivered,
      outstanding: Math.max(0, l.quantity - delivered),
      // Prices are a commercial detail, not a receiving detail
      unitPrice: canSeeValue ? l.unitPrice : null,
      lineTotal: canSeeValue ? l.quantity * l.unitPrice : null,
      intentNumber: l.intent?.intentNumber ?? null,
      notes: l.notes,
    };
  });

  const outstanding = lines.reduce((sum, l) => sum + l.outstanding, 0);

  return {
    id: order.id,
    poNumber: order.poNumber,
    status: order.status as "OPEN" | "CLOSED" | "CANCELLED",
    vendorId: order.vendor.id,
    vendorName: order.vendor.name,
    locationId: order.location.id,
    locationName: order.location.name,
    expectedDate: order.expectedDate,
    notes: order.notes,
    closeReason: order.closeReason,
    createdAt: order.createdAt,
    closedAt: order.closedAt,
    createdByName: order.createdBy.name,
    closedByName: order.closedBy?.name ?? null,
    lines,
    outstanding,
    /** Nothing left to come, whatever the stored status says */
    fullyDelivered: outstanding === 0,
    /** Some but not all — the state the operator cares about */
    partiallyDelivered:
      outstanding > 0 && lines.some((l) => l.delivered > 0),
    total: canSeeValue
      ? lines.reduce((sum, l) => sum + (l.lineTotal ?? 0), 0)
      : null,
  };
}

const orderInclude = {
  vendor: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
  closedBy: { select: { name: true } },
  lines: {
    include: {
      product: { select: { id: true, code: true, name: true, unit: true } },
      intent: { select: { intentNumber: true } },
      stockEntries: { where: deliveredEntriesWhere, select: { quantity: true } },
    },
  },
} as const;

/**
 * Every order the caller may see.
 *
 * Location narrows, as everywhere: someone attached to a site sees the orders
 * coming to that site. Prices are stripped unless they hold the value key.
 */
export async function getPurchaseOrders() {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_PO_VIEW);
  const canSeeValue = user.permissions.includes(PERMISSIONS.PROCUREMENT_VALUE_VIEW);

  const seesEverySite = resolveStockScope(user) === "all";
  const orders = await prisma.purchaseOrder.findMany({
    where: seesEverySite || !user.locationId ? {} : { locationId: user.locationId },
    include: orderInclude,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  return orders.map((order) => shapeOrder(order, canSeeValue));
}

/**
 * Lines still expecting goods, for the stock entry form.
 *
 * Gated on stock entry rather than procurement: the person booking a delivery
 * in needs to find the order it belongs to, without being let into the rest of
 * procurement. Prices are deliberately not returned.
 */
export async function getOpenOrderLines() {
  const user = await requireAnyPermission([
    PERMISSIONS.STOCK_CREATE,
    PERMISSIONS.PROCUREMENT_PO_VIEW,
  ]);

  const seesAll = resolveStockScope(user) === "all";
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      status: "OPEN",
      ...(seesAll || !user.locationId ? {} : { locationId: user.locationId }),
    },
    include: {
      vendor: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      lines: {
        include: {
          product: {
            select: {
              id: true,
              code: true,
              name: true,
              unit: true,
              category: { select: { id: true, name: true } },
            },
          },
          stockEntries: { where: deliveredEntriesWhere, select: { quantity: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows = [];
  for (const order of orders) {
    for (const line of order.lines) {
      const delivered = line.stockEntries.reduce((sum, e) => sum + e.quantity, 0);
      const outstanding = line.quantity - delivered;
      if (outstanding <= 0) continue;
      rows.push({
        lineId: line.id,
        orderId: order.id,
        poNumber: order.poNumber,
        vendorId: order.vendor.id,
        vendorName: order.vendor.name,
        locationId: order.location.id,
        locationName: order.location.name,
        productId: line.product.id,
        productCode: line.product.code,
        productName: line.product.name,
        unit: line.product.unit,
        categoryId: line.product.category.id,
        categoryName: line.product.category.name,
        ordered: line.quantity,
        delivered,
        outstanding,
      });
    }
  }
  return rows;
}

/**
 * Close an order once nothing more is coming.
 *
 * Called automatically when the last outstanding unit is booked in, and by hand
 * when a vendor simply will not supply the rest — which is why the reason is
 * kept. Closing short does not pretend the goods arrived: the line still shows
 * what was ordered against what came.
 */
export async function closePurchaseOrder(id: string, data: unknown = {}) {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_PO_CLOSE);

  const parsed = closePurchaseOrderSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: orderInclude,
  });
  if (!order) return { error: "That order no longer exists" };
  if (order.status !== "OPEN") {
    return { error: `This order is already ${order.status.toLowerCase()}` };
  }

  const shaped = shapeOrder(order, true);

  await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: "CLOSED",
      closeReason: parsed.data.closeReason?.trim() || null,
      closedById: user.id,
      closedAt: new Date(),
    },
  });

  await logActivity(
    "UPDATED",
    "PurchaseOrder",
    id,
    shaped.fullyDelivered
      ? `Closed ${order.poNumber} — everything delivered`
      : `Closed ${order.poNumber} short with ${shaped.outstanding} unit${shaped.outstanding === 1 ? "" : "s"} outstanding${parsed.data.closeReason ? `: ${parsed.data.closeReason.trim()}` : ""}`
  );

  revalidatePath("/procurement");
  return { success: true };
}

/** Withdraw an order nothing has arrived against. */
export async function cancelPurchaseOrder(id: string, data: unknown = {}) {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_PO_CLOSE);

  const parsed = closePurchaseOrderSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: orderInclude,
  });
  if (!order) return { error: "That order no longer exists" };
  if (order.status !== "OPEN") {
    return { error: `This order is already ${order.status.toLowerCase()}` };
  }

  const shaped = shapeOrder(order, true);
  if (shaped.lines.some((l) => l.delivered > 0)) {
    return {
      error:
        "Some of this order has already arrived — close it instead, so what was delivered stays on the record",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: "CANCELLED",
        closeReason: parsed.data.closeReason?.trim() || null,
        closedById: user.id,
        closedAt: new Date(),
      },
    });

    // The needs behind it were never met, so they go back to being needs
    const intentIds = order.lines
      .map((l) => l.intentId)
      .filter((v): v is string => Boolean(v));
    if (intentIds.length > 0) {
      await tx.purchaseIntent.updateMany({
        where: { id: { in: intentIds }, status: "ORDERED" },
        data: { status: "APPROVED" },
      });
    }
  });

  await logActivity(
    "CANCELLED",
    "PurchaseOrder",
    id,
    `Cancelled ${order.poNumber}${parsed.data.closeReason ? `: ${parsed.data.closeReason.trim()}` : ""}`
  );

  revalidatePath("/procurement");
  return { success: true };
}

/**
 * Whether a line can take this many more units, or why not.
 *
 * Returns an error message, or null when the delivery fits. Called from every
 * point where the booked quantity can change — creating an entry, editing one,
 * and submitting it — because outstanding is DERIVED, and a check at only one
 * of those three leaves the other two as ways round it.
 *
 * `excludeEntryId` skips an entry's own contribution, so editing a submitted
 * delivery is measured against everything except itself.
 */
export async function checkOrderLineCapacity(
  purchaseOrderLineId: string,
  productId: string,
  quantity: number,
  excludeEntryId?: string
): Promise<string | null> {
  const line = await prisma.purchaseOrderLine.findUnique({
    where: { id: purchaseOrderLineId },
    include: {
      purchaseOrder: { select: { poNumber: true, status: true } },
      stockEntries: {
        where: {
          ...deliveredEntriesWhere,
          ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
        },
        select: { quantity: true },
      },
    },
  });

  if (!line) return "That purchase order line no longer exists";
  if (line.purchaseOrder.status !== "OPEN") {
    return `${line.purchaseOrder.poNumber} is already ${line.purchaseOrder.status.toLowerCase()}`;
  }
  if (line.productId !== productId) {
    return "That order line is for a different product";
  }

  const delivered = line.stockEntries.reduce((sum, e) => sum + e.quantity, 0);
  const outstanding = line.quantity - delivered;
  if (quantity > outstanding) {
    return `${line.purchaseOrder.poNumber} is only owed ${outstanding} more — enter ${outstanding} or less, or raise a separate entry`;
  }

  return null;
}

/**
 * Bring an order's status back in line with what has actually arrived.
 *
 * Called whenever a delivery against it changes: created, submitted, approved
 * or rejected. Two directions:
 *
 *   fully delivered and open   → close it, and say so on the record
 *   not fully delivered and
 *   closed AUTOMATICALLY       → open it again
 *
 * `closedById` is what tells the two kinds of closure apart. A person closing
 * an order short has made a decision and it stands, even if a late delivery
 * turns up; an automatic close is only ever a statement about arithmetic, so
 * when the arithmetic changes it has to be withdrawn. Without that second
 * direction, submitting a delivery closed the order and rejecting the same
 * delivery left it closed with nothing delivered against it.
 */
export async function syncPurchaseOrderFromEntry(purchaseOrderLineId: string) {
  const line = await prisma.purchaseOrderLine.findUnique({
    where: { id: purchaseOrderLineId },
    select: { purchaseOrderId: true },
  });
  if (!line) return;

  const order = await prisma.purchaseOrder.findUnique({
    where: { id: line.purchaseOrderId },
    include: orderInclude,
  });
  if (!order) return;

  const shaped = shapeOrder(order, true);

  if (order.status === "OPEN" && shaped.fullyDelivered) {
    await prisma.purchaseOrder.update({
      where: { id: order.id },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    await logActivity(
      "UPDATED",
      "PurchaseOrder",
      order.id,
      `${order.poNumber} closed automatically — everything ordered has arrived`
    );
    revalidatePath("/procurement");
    return;
  }

  const closedAutomatically = order.status === "CLOSED" && order.closedById === null;
  if (closedAutomatically && !shaped.fullyDelivered) {
    await prisma.purchaseOrder.update({
      where: { id: order.id },
      data: { status: "OPEN", closedAt: null, closeReason: null },
    });
    await logActivity(
      "UPDATED",
      "PurchaseOrder",
      order.id,
      `${order.poNumber} re-opened — ${shaped.outstanding} unit${shaped.outstanding === 1 ? "" : "s"} still owed after a delivery was withdrawn`
    );
    revalidatePath("/procurement");
  }
}

/** Vendors and sites for the order form. */
export async function getPurchaseOrderFormData() {
  await requirePermission(PERMISSIONS.PROCUREMENT_PO_CREATE);

  const [vendors, locations] = await Promise.all([
    prisma.vendor.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.location.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return { vendors, locations };
}

/** Catalog for stating a need — raw materials are what gets bought in. */
export async function getIntentFormData() {
  await requirePermission(PERMISSIONS.PROCUREMENT_INTENT_CREATE);

  const [products, vendors, locations] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        unit: true,
        kind: true,
        category: { select: { name: true } },
      },
      orderBy: [{ category: { name: "asc" } }, { code: "asc" }],
    }),
    prisma.vendor.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.location.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    products: products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      unit: p.unit,
      kind: p.kind,
      categoryName: p.category.name,
    })),
    vendors,
    locations,
  };
}

/**
 * Pending needs waiting on this person, for the dashboard review queue.
 */
export async function getReviewableIntents() {
  await requirePermission(PERMISSIONS.PROCUREMENT_INTENT_APPROVE);

  const intents = await prisma.purchaseIntent.findMany({
    where: { status: "PENDING" },
    include: {
      product: { select: { name: true, unit: true } },
      department: { select: { name: true } },
      requestedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return intents.map((i) => ({
    kind: "PURCHASE_INTENT" as const,
    id: i.id,
    title: `${i.quantity} ${i.product.unit} · ${i.product.name}`,
    subtitle: `${i.intentNumber} · ${i.requestedBy.name}${i.department ? ` (${i.department.name})` : ""}`,
    href: "/procurement",
  }));
}
